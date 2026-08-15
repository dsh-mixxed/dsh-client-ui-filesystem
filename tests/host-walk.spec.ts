/**
 * Host half: the pure tree walker (bounds, skip policy, fault isolation,
 * abort), Config validation, and the route handler's session resolution and
 * uniform error paths — driven with fake readers and fake req/res.
 */
import { describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { FsDirEntry, FsTarget, FsTargetKey } from '@deepseek-ai/dsh-fs'
import { makeTreeHandler, resolveConfig, type TreeRouteDeps } from '../src/index.ts'
import { walkTree, type FsReader } from '../src/walk.ts'
import type { TreeResponse } from '../src/wire.ts'

/** One in-memory directory node. */
interface FakeNode {
  type: 'file' | 'directory' | 'other'
  children?: Map<string, FakeNode>
}

/** The fake root target key; child keys accumulate '/'-joined segments below it. */
const ROOT_KEY = '/proj'

/** In-memory tree keyed by '/'-joined relative paths; `failAt` dirs throw on listDir. */
function fakeFs(spec: Record<string, 'file' | 'directory' | 'other'>, failAt: string[] = []): FsReader {
  const root: FakeNode = { type: 'directory', children: new Map() }
  for (const [path, type] of Object.entries(spec)) {
    const parts = path.split('/')
    let node = root
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index]!
      const last = index === parts.length - 1
      let child = node.children!.get(part)
      if (child === undefined) {
        child = { type: last ? type : 'directory', children: new Map() }
        node.children!.set(part, child)
      }
      node = child
    }
    node.type = type
  }
  const listDir = vi.fn(async (target: FsTarget): Promise<FsDirEntry[]> => {
    const key = String(target.targetKey)
    if (failAt.includes(key)) throw new Error(`cannot list ${key}`)
    const rel = key === ROOT_KEY ? '' : key.slice(ROOT_KEY.length + 1)
    const node = findNode(root, rel)
    if (node === undefined || node.type !== 'directory') throw new Error(`not a directory: ${key}`)
    return [...(node.children?.entries() ?? [])]
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([name, child]) => ({
        name,
        type: child.type,
        target: { targetKey: `${key}/${name}` as FsTargetKey, displayPath: `${key}/${name}` },
      }))
  })
  return {
    resolve: async (path: string): Promise<FsTarget> => ({
      targetKey: ROOT_KEY as FsTargetKey,
      displayPath: path,
    }),
    listDir,
  }
}

function findNode(node: FakeNode, rel: string): FakeNode | undefined {
  if (rel === '') return node
  let current = node
  for (const part of rel.split('/')) {
    if (part === '') continue
    const child = current.children?.get(part)
    if (child === undefined) return undefined
    current = child
  }
  return current
}

const DEFAULT_OPTIONS = { maxDepth: 6, maxEntries: 2000, skipHidden: true, skipPatterns: ['node_modules', '.git'] }

describe('resolveConfig', () => {
  it('applies defaults to an absent config', () => {
    expect(resolveConfig()).toEqual(DEFAULT_OPTIONS)
    expect(resolveConfig({ maxDepth: 3 })).toEqual({ ...DEFAULT_OPTIONS, maxDepth: 3 })
    expect(resolveConfig({ skipHidden: false })).toEqual({ ...DEFAULT_OPTIONS, skipHidden: false })
    expect(resolveConfig({ skipPatterns: ['vendor'] })).toEqual({ ...DEFAULT_OPTIONS, skipPatterns: ['vendor'] })
  })

  it('throws on invalid bounds and patterns', () => {
    for (const bad of [{ maxDepth: 0 }, { maxDepth: -1 }, { maxDepth: 1.5 }, { maxDepth: '4' as never }]) {
      expect(() => resolveConfig(bad)).toThrow(/maxDepth/)
    }
    for (const bad of [{ maxEntries: 0 }, { maxEntries: -2 }, { maxEntries: 2.5 }]) {
      expect(() => resolveConfig(bad)).toThrow(/maxEntries/)
    }
    expect(() => resolveConfig({ skipPatterns: 'node_modules' as never })).toThrow(/skipPatterns/)
    expect(() => resolveConfig({ skipPatterns: [42] as never })).toThrow(/skipPatterns/)
  })
})

describe('walkTree', () => {
  const PROJECT: Record<string, 'file' | 'directory'> = {
    'README.md': 'file',
    'src/index.ts': 'file',
    'src/util/a.ts': 'file',
    'src/util/b.ts': 'file',
    'docs/guide.md': 'file',
    'docs/api/readme.md': 'file',
  }

  it("lists the tree depth-first with '/' relative paths", async () => {
    const fs = fakeFs(PROJECT)
    const entries = await walkTree(fs, '/proj', DEFAULT_OPTIONS)
    expect(entries.map(entry => entry.path)).toEqual([
      'README.md', 'docs', 'docs/api', 'docs/api/readme.md', 'docs/guide.md',
      'src', 'src/index.ts', 'src/util', 'src/util/a.ts', 'src/util/b.ts',
    ])
    expect(entries.find(entry => entry.path === 'src')?.type).toBe('directory')
    expect(entries.find(entry => entry.path === 'src/index.ts')?.type).toBe('file')
    expect(entries.every(entry => entry.name === entry.path.split('/').at(-1))).toBe(true)
  })

  it('skips hidden entries and configured patterns at every depth', async () => {
    const fs = fakeFs({
      ...PROJECT,
      '.env': 'file',
      '.git/config': 'file',
      'node_modules/lodash/index.js': 'file',
      'src/.hidden.ts': 'file',
    })
    const entries = await walkTree(fs, '/proj', DEFAULT_OPTIONS)
    expect(entries.map(entry => entry.path)).not.toContain('.env')
    expect(entries.map(entry => entry.path)).not.toContain('.git')
    expect(entries.map(entry => entry.path)).not.toContain('node_modules')
    expect(entries.map(entry => entry.path)).not.toContain('node_modules/lodash')
    expect(entries.map(entry => entry.path)).not.toContain('src/.hidden.ts')
    expect(entries).toHaveLength(10)
  })

  it('never lists symlinks and other entry types', async () => {
    const fs = fakeFs({ ...PROJECT, link: 'other' })
    const entries = await walkTree(fs, '/proj', DEFAULT_OPTIONS)
    expect(entries.map(entry => entry.path)).not.toContain('link')
    expect(entries).toHaveLength(10)
  })

  it('respects maxDepth: entries deeper than the cap are not listed nor descended', async () => {
    const fs = fakeFs(PROJECT)
    const entries = await walkTree(fs, '/proj', { ...DEFAULT_OPTIONS, maxDepth: 1 })
    expect(entries.map(entry => entry.path)).toEqual(['README.md', 'docs', 'src'])
    const listCalls = (fs.listDir as ReturnType<typeof vi.fn>).mock.calls
    // Root only: capped directories are not descended.
    expect(listCalls.map(call => String(call[0]!.targetKey))).toEqual([ROOT_KEY])
  })

  it('respects maxEntries and stops early', async () => {
    const fs = fakeFs(PROJECT)
    const entries = await walkTree(fs, '/proj', { ...DEFAULT_OPTIONS, maxEntries: 4 })
    expect(entries).toHaveLength(4)
    // The walk stopped descending once the cap was reached: 'src' was never listed.
    const listCalls = (fs.listDir as ReturnType<typeof vi.fn>).mock.calls
    expect(listCalls.map(call => String(call[0]!.targetKey))).not.toContain(`${ROOT_KEY}/src`)
  })

  it('skips an unreadable directory subtree and reports it, keeping the rest', async () => {
    const fs = fakeFs(PROJECT, [`${ROOT_KEY}/src`])
    const failures: Array<{ path: string; error: unknown }> = []
    const entries = await walkTree(fs, '/proj', DEFAULT_OPTIONS, failure => { failures.push(failure) })
    expect(failures.map(failure => failure.path)).toEqual(['src'])
    expect(failures[0]?.error).toBeInstanceOf(Error)
    expect(entries.map(entry => entry.path)).toEqual([
      'README.md', 'docs', 'docs/api', 'docs/api/readme.md', 'docs/guide.md', 'src',
    ])
  })

  it('returns partial results and stops walking once the signal aborts', async () => {
    const fs = fakeFs(PROJECT)
    const signal = { aborted: false }
    const listDir = fs.listDir as ReturnType<typeof vi.fn>
    listDir.mockImplementationOnce(async (target: FsTarget) => {
      signal.aborted = true
      return listDir.getMockImplementation()!(target)
    })
    const entries = await walkTree(fs, '/proj', { ...DEFAULT_OPTIONS, signal: signal as AbortSignal })
    // The abort hit before any child was pushed; the walk stopped after one listing.
    expect(entries).toHaveLength(0)
    expect(listDir).toHaveBeenCalledTimes(1)
  })

  it('returns empty without listing when the signal is already aborted', async () => {
    const fs = fakeFs(PROJECT)
    const aborted = new AbortController()
    aborted.abort()
    const entries = await walkTree(fs, '/proj', { ...DEFAULT_OPTIONS, signal: aborted.signal })
    expect(entries).toEqual([])
    expect(fs.listDir).not.toHaveBeenCalled()
  })
})

/** Minimal fake response capturing status and body. */
function fakeRes() {
  let status = 0
  let body = ''
  const res = {
    writeHead(code: number): void { status = code },
    end(text: string): void { body = text },
  }
  return {
    res: res as unknown as ServerResponse,
    get status() { return status },
    get body(): unknown { return JSON.parse(body) },
  }
}

function fakeReq(url: string, method = 'GET'): IncomingMessage {
  return { url, method } as unknown as IncomingMessage
}

/** Default route deps: one live session at /proj, one cwd-less session, one unknown id. */
function routeDeps(overrides: Partial<TreeRouteDeps> = {}): TreeRouteDeps {
  const sessions = {
    get: vi.fn((id: string) => id === 's1'
      ? { header: { cwd: '/proj' } }
      : id === 'cwdless'
        ? { header: {} }
        : undefined),
  }
  return {
    sessions,
    fs: fakeFs({
      'README.md': 'file',
      'src/index.ts': 'file',
      'src/util/a.ts': 'file',
    }),
    config: DEFAULT_OPTIONS,
    ...overrides,
  }
}

describe('tree route handler', () => {
  it('serves the bounded tree for a live session (200)', async () => {
    const deps = routeDeps()
    const handler = makeTreeHandler(deps)
    const res = fakeRes()
    await handler(fakeReq('/plugin/ui-filesystem/tree?sessionId=s1'), res.res)
    expect(res.status).toBe(200)
    const body = res.body as TreeResponse
    expect(body.root).toEqual({ name: 'proj' })
    expect(body.entries.map(entry => entry.path)).toEqual([
      'README.md', 'src', 'src/index.ts', 'src/util', 'src/util/a.ts',
    ])
    expect(deps.sessions.get).toHaveBeenCalledWith('s1')
  })

  it('rejects a missing sessionId (400)', async () => {
    const deps = routeDeps()
    const handler = makeTreeHandler(deps)
    const res = fakeRes()
    await handler(fakeReq('/plugin/ui-filesystem/tree'), res.res)
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ error: { code: 'missing-session' } })
    expect(deps.sessions.get).not.toHaveBeenCalled()
  })

  it('rejects an unknown session (404)', async () => {
    const deps = routeDeps()
    const handler = makeTreeHandler(deps)
    const res = fakeRes()
    await handler(fakeReq('/plugin/ui-filesystem/tree?sessionId=nope'), res.res)
    expect(res.status).toBe(404)
    expect(res.body).toMatchObject({ error: { code: 'session-not-found' } })
  })

  it('rejects a cwd-less session (400)', async () => {
    const deps = routeDeps()
    const handler = makeTreeHandler(deps)
    const res = fakeRes()
    await handler(fakeReq('/plugin/ui-filesystem/tree?sessionId=cwdless'), res.res)
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ error: { code: 'no-project-cwd' } })
  })

  it('rejects non-GET methods (405) and unknown routes (404)', async () => {
    const deps = routeDeps()
    const handler = makeTreeHandler(deps)
    const post = fakeRes()
    await handler(fakeReq('/plugin/ui-filesystem/tree?sessionId=s1', 'POST'), post.res)
    expect(post.status).toBe(405)
    expect(post.body).toMatchObject({ error: { code: 'method-not-allowed' } })
    const other = fakeRes()
    await handler(fakeReq('/plugin/ui-filesystem/other'), other.res)
    expect(other.status).toBe(404)
    expect(other.body).toMatchObject({ error: { code: 'not-found' } })
  })

  it('maps a walker failure to the uniform 400 body and reports it', async () => {
    const onRequestError = vi.fn()
    const deps = routeDeps({ onRequestError })
    deps.fs.resolve = async () => { throw new Error('disk exploded') }
    const handler = makeTreeHandler(deps)
    const res = fakeRes()
    await handler(fakeReq('/plugin/ui-filesystem/tree?sessionId=s1'), res.res)
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ error: { code: 'bad-request', message: 'Error: disk exploded' } })
    expect(onRequestError).toHaveBeenCalledWith(expect.any(Error))
  })

  it('normalizes a trailing-slash cwd for the root name', async () => {
    const deps = routeDeps()
    ;(deps.sessions.get as ReturnType<typeof vi.fn>).mockReturnValue({ header: { cwd: '/proj/' } })
    const handler = makeTreeHandler(deps)
    const res = fakeRes()
    await handler(fakeReq('/plugin/ui-filesystem/tree?sessionId=s1'), res.res)
    expect((res.body as TreeResponse).root.name).toBe('proj')
  })
})
