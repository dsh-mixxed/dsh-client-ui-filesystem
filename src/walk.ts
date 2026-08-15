/**
 * Pure project-tree walker for the ui-filesystem host half. Walks the session
 * project root through an injected filesystem reader (the `ctx.fs` service in
 * production, fakes in tests) with depth/entry bounds, skip patterns, hidden
 * skipping, per-directory fault isolation, and abort support. Relative paths
 * accumulate from entry names — no string path comparison.
 * @module ui-filesystem/walk
 */

import type { FsDirEntry, FsTarget } from '@deepseek-ai/dsh-fs'
import type { FileEntry } from './wire.ts'

/** The filesystem surface the walker reads (a subset of `ctx.fs`). */
export interface FsReader {
  resolve(path: string, opts?: { readonly signal?: AbortSignal }): Promise<FsTarget>
  listDir(target: FsTarget, signal?: AbortSignal): Promise<readonly FsDirEntry[]>
}

/** Deployment-varying walk bounds, resolved from the plugin Config. */
export interface WalkOptions {
  /** Maximum path-segment depth of listed entries (directories at the cap are not descended). */
  readonly maxDepth: number
  /** Total entry cap; the walk stops when reached. */
  readonly maxEntries: number
  /** Skip dot-prefixed entries. */
  readonly skipHidden: boolean
  /** Basename exact-match skip patterns (e.g. node_modules, .git). */
  readonly skipPatterns: readonly string[]
  /** Aborts the walk between listings; the collected prefix is still returned. */
  readonly signal?: AbortSignal
}

/** One subtree that could not be listed (fault-isolated, reported to the caller). */
export interface WalkFailure {
  /** Relative path of the unreadable directory. */
  readonly path: string
  readonly error: unknown
}

/**
 * Recursively list the project tree under `cwd` in walk order.
 * @param fs - the filesystem reader.
 * @param cwd - absolute project root (the session header's cwd).
 * @param options - bounds and skip policy.
 * @param onError - per-directory failure sink (unreadable subtrees are skipped).
 * @returns the bounded tree entries.
 */
export async function walkTree(
  fs: FsReader,
  cwd: string,
  options: WalkOptions,
  onError?: (failure: WalkFailure) => void,
): Promise<readonly FileEntry[]> {
  const entries: FileEntry[] = []
  if (options.signal?.aborted) return entries
  const root = await fs.resolve(cwd, { signal: options.signal })
  await walkDir(fs, root, '', entries, options, onError)
  return entries
}

/** List one directory, push its children, and descend into directories within bounds. */
async function walkDir(
  fs: FsReader,
  target: FsTarget,
  rel: string,
  out: FileEntry[],
  options: WalkOptions,
  onError?: (failure: WalkFailure) => void,
): Promise<void> {
  if (options.signal?.aborted) return
  let children: readonly FsDirEntry[]
  try {
    children = await fs.listDir(target, options.signal)
  } catch (error) {
    onError?.({ path: rel === '' ? '.' : rel, error })
    return
  }
  for (const child of children) {
    if (out.length >= options.maxEntries) break
    if (options.signal?.aborted) return
    if (shouldSkip(child.name, options)) continue
    if (child.type !== 'file' && child.type !== 'directory') continue
    const path = rel === '' ? child.name : `${rel}/${child.name}`
    const depth = pathSegmentCount(path)
    if (depth > options.maxDepth) continue
    out.push({ name: child.name, path, type: child.type })
    if (child.type === 'directory' && depth < options.maxDepth) {
      await walkDir(fs, child.target, path, out, options, onError)
    }
  }
}

/** Count '/' segments of a relative path. */
function pathSegmentCount(path: string): number {
  let count = 1
  for (let index = 0; index < path.length; index += 1) {
    if (path[index] === '/') count += 1
  }
  return count
}

/** Apply the skip policy to one entry name. */
function shouldSkip(name: string, options: WalkOptions): boolean {
  if (options.skipHidden && name.startsWith('.')) return true
  return options.skipPatterns.includes(name)
}
