/**
 * Browser half: source registration and teardown (HMR safety), then the
 * source behavior contract driven directly on the captured source with real
 * ClientSessionContext projections — sessionId-addressed tree fetches, the
 * session-keyed cache (single-flight per key, scope-birth warm prewarm,
 * connection/reset clear), basename-prefix filtering, pick → plain-text
 * outcome, and the candidate cap. Direct driving is deliberate: this spec
 * owns only the source's own contract.
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ClientSessionContext, InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { apply, inject, type FileCandidate } from '../src/client/index.ts'
import type { FileEntry } from '../src/wire.ts'

type FetchResult = { ok: boolean; status: number; json: () => Promise<unknown> }

/** A fetch stub returning the given body; records every request URL. */
function treeFetch(entries: readonly FileEntry[], fail = false) {
  const urls: string[] = []
  const fetchMock = vi.fn(async (url: string): Promise<FetchResult> => {
    urls.push(String(url))
    if (fail) return { ok: false, status: 500, json: async () => ({ error: { code: 'boom', message: 'disk exploded' } }) }
    return { ok: true, status: 200, json: async () => ({ root: { name: 'proj' }, entries }) }
  })
  return { fetchMock, urls }
}

const TREE: readonly FileEntry[] = [
  { name: 'README.md', path: 'README.md', type: 'file' },
  { name: 'index.ts', path: 'src/index.ts', type: 'file' },
  { name: 'util', path: 'src/util', type: 'directory' },
  { name: 'a.ts', path: 'src/util/a.ts', type: 'file' },
  { name: 'Guide.md', path: 'docs/Guide.md', type: 'file' },
]

/** Boot the plugin over a fake inputTriggers face; returns the captured source and its ctx. */
async function bench(entries: readonly FileEntry[] = TREE, fail = false) {
  const ctx = new Context()
  let captured: InputTriggerSource | undefined
  let unregister: (() => void) | undefined
  ctx.provide('inputTriggers', {
    registerSource: (src: InputTriggerSource) => {
      captured = src
      return () => { unregister?.() }
    },
  })
  const { fetchMock, urls } = treeFetch(entries, fail)
  vi.stubGlobal('fetch', fetchMock)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, source: captured!, urls, fiber }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const sid = (id: string) => id as SessionId
const proj = (id: string): ClientSessionContext => ({ sessionId: sid(id) })
const req = (query: string, signal?: AbortSignal) =>
  ({ query, position: 'leading' as const, signal: signal ?? new AbortController().signal })

describe('apply', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['inputTriggers'])
  })

  it('registers the "@" filesystem source; disposal unregisters it (HMR safety)', async () => {
    const ctx = new Context()
    let unregister = false
    ctx.provide('inputTriggers', {
      registerSource: () => () => { unregister = true },
    })
    vi.stubGlobal('fetch', treeFetch(TREE).fetchMock)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await fiber.dispose()
    expect(unregister).toBe(true)
  })

  it('captures the source with the filesystem trigger contract', async () => {
    const { source } = await bench()
    expect(source.trigger).toBe('@')
    expect(source.name).toBe('filesystem')
    expect(source.order).toBe(1)
    expect(typeof source.warm).toBe('function')
    // No adjudication hooks: file references never enter command adjudication.
    expect(typeof source.matchSpace).toBe('undefined')
    expect(typeof source.matchEnter).toBe('undefined')
    expect(source.codec).toBeUndefined()
    expect(source.lexicon).toBeUndefined()
  })
})

describe('candidates: sessionId addressing and basename-prefix filtering', () => {
  it('fetches the tree once per session and filters by basename prefix', async () => {
    const { source, urls } = await bench()
    const items = await source.candidates(proj('s1'), req('in'))
    // Exact address: the host resolves the project root from the session.
    expect(urls).toEqual(['/plugin/ui-filesystem/tree?sessionId=s1'])
    // Basename prefix only — the path "src/index.ts" never matches "src".
    expect(items).toEqual([
      { name: 'index.ts', description: 'src/index.ts', path: 'src/index.ts' },
    ])
  })

  it('matches case-insensitively and sorts by path', async () => {
    const { source } = await bench()
    const items = await source.candidates(proj('s1'), req('g'))
    expect(items).toEqual([
      { name: 'Guide.md', description: 'docs/Guide.md', path: 'docs/Guide.md' },
    ])
    const all = await source.candidates(proj('s1'), req(''))
    expect((all as readonly FileCandidate[]).map(item => item.path)).toEqual([
      'README.md', 'docs/Guide.md', 'src/index.ts', 'src/util', 'src/util/a.ts',
    ])
  })

  it('matches directories as well as files', async () => {
    const { source } = await bench()
    const items = await source.candidates(proj('s1'), req('ut'))
    expect(items).toEqual([
      { name: 'util', description: 'src/util', path: 'src/util', },
    ])
  })

  it('returns nothing for path-shaped queries (only basename prefixes match)', async () => {
    const { source } = await bench()
    const items = await source.candidates(proj('s1'), req('src/'))
    expect(items).toEqual([])
  })

  it('caps the candidate list per query', async () => {
    const many: FileEntry[] = Array.from({ length: 80 }, (_, index) => ({
      name: `file-${String(index).padStart(2, '0')}.ts`,
      path: `src/file-${String(index).padStart(2, '0')}.ts`,
      type: 'file',
    }))
    const { source } = await bench(many)
    const items = await source.candidates(proj('s1'), req(''))
    expect(items).toHaveLength(50)
  })

  it('rejects on a failed response (the slash shell owns the menu-side fold)', async () => {
    const { source } = await bench(TREE, true)
    await expect(source.candidates(proj('s1'), req('')))
      .rejects.toThrow('boom: disk exploded')
  })
})

describe('tree cache', () => {
  it('re-polls the settled snapshot on the same session locally: one fetch across keystrokes', async () => {
    const { source, urls } = await bench()
    await source.candidates(proj('s1'), req(''))
    const second = await source.candidates(proj('s1'), req('in'))
    expect(urls).toHaveLength(1)
    expect(second).toHaveLength(1)
    // A different session is its own key — one more fetch, not two.
    await source.candidates(proj('s2'), req(''))
    expect(urls).toEqual([
      '/plugin/ui-filesystem/tree?sessionId=s1',
      '/plugin/ui-filesystem/tree?sessionId=s2',
    ])
  })

  it('single-flight: concurrent candidates on one cold key share one fetch', async () => {
    const { source, urls } = await bench()
    const [a, b] = await Promise.all([
      source.candidates(proj('s1'), req('re')),
      source.candidates(proj('s1'), req('in')),
    ])
    expect(urls).toHaveLength(1)
    expect(a).toEqual([{ name: 'README.md', description: 'README.md', path: 'README.md' }])
    expect(b).toHaveLength(1)
  })

  it('an aborted caller yields empty but leaves the shared fetch warm', async () => {
    const { source, urls } = await bench()
    const aborted = new AbortController()
    aborted.abort()
    await expect(source.candidates(proj('s1'), req('in', aborted.signal))).resolves.toEqual([])
    // The fetch settled into the cache: the next caller pays zero RPC.
    await expect(source.candidates(proj('s1'), req('in'))).resolves.toHaveLength(1)
    expect(urls).toHaveLength(1)
  })

  it('a failed fetch retries once; a persistent failure rejects and does not poison the key', async () => {
    let failures = 2
    const { source, urls } = await bench(TREE, true)
    vi.stubGlobal('fetch', vi.fn(async (url: string): Promise<FetchResult> => {
      urls.push(String(url))
      if (failures > 0) {
        failures -= 1
        return { ok: false, status: 404, json: async () => ({ error: { code: 'session-not-found', message: 'not attached' } }) }
      }
      return { ok: true, status: 200, json: async () => ({ root: { name: 'proj' }, entries: TREE }) }
    }))
    // First call: two failed attempts (initial + one retry), then rejection.
    await expect(source.candidates(proj('s1'), req(''))).rejects.toThrow('session-not-found')
    expect(urls).toHaveLength(2)
    // The key was not poisoned: the next caller fetches fresh and succeeds.
    await expect(source.candidates(proj('s1'), req(''))).resolves.toHaveLength(5)
    expect(urls).toHaveLength(3)
  })

  it('a transient first failure recovers inside the same candidates call', async () => {
    let fail = true
    const { source, urls } = await bench(TREE, true)
    vi.stubGlobal('fetch', vi.fn(async (url: string): Promise<FetchResult> => {
      urls.push(String(url))
      if (fail) {
        fail = false
        return { ok: false, status: 404, json: async () => ({ error: { code: 'session-not-found', message: 'not attached' } }) }
      }
      return { ok: true, status: 200, json: async () => ({ root: { name: 'proj' }, entries: TREE }) }
    }))
    const items = await source.candidates(proj('s1'), req(''))
    // One failed attempt, one retry, then the settled tree serves the query.
    expect(urls).toHaveLength(2)
    expect(items).toHaveLength(5)
  })

  it('the scope-birth warm prewarms the session key fire-and-forget', async () => {
    const { source, urls } = await bench()
    source.warm!(proj('s1'))
    await vi.waitFor(() => { expect(urls).toHaveLength(1) })
    expect(urls[0]).toBe('/plugin/ui-filesystem/tree?sessionId=s1')
    // The prewarmed key serves candidates with zero further fetch.
    await expect(source.candidates(proj('s1'), req(''))).resolves.toHaveLength(5)
    expect(urls).toHaveLength(1)
    await source.candidates(proj('s2'), req(''))
    expect(urls).toHaveLength(2)
  })

  it('connection/reset clears every cached session', async () => {
    const { ctx, source, urls } = await bench()
    await source.candidates(proj('s1'), req(''))
    await source.candidates(proj('s2'), req(''))
    expect(urls).toHaveLength(2)
    ctx.emit('connection/reset')
    await source.candidates(proj('s1'), req(''))
    await source.candidates(proj('s2'), req(''))
    expect(urls).toHaveLength(4)
  })
})

describe('pick lands plain text', () => {
  it('onPick returns the literal @path text with a closing space', async () => {
    const { source } = await bench()
    const outcome = source.onPick({
      candidate: { name: 'index.ts', description: 'src/index.ts', path: 'src/index.ts' } as FileCandidate,
      session: proj('s1'),
      position: 'leading',
      via: 'menu',
      span: { start: 0, end: 4, draftRev: 7 },
    })
    expect(outcome).toEqual({ text: '@src/index.ts ' })
  })

  it('falls back to the candidate name when no path rides the candidate', async () => {
    const { source } = await bench()
    const outcome = source.onPick({
      candidate: { name: 'README.md' },
      session: proj('s1'),
      position: 'leading',
      via: 'menu',
      span: { start: 0, end: 1, draftRev: 3 },
    })
    expect(outcome).toEqual({ text: '@README.md ' })
  })
})
