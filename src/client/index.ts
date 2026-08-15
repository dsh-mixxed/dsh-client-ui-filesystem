/**
 * ui-filesystem browser half: registers the '@' source — candidates from the
 * plugin's own tree route, addressed by the per-call session projection's
 * sessionId (the host resolves the project root from the session header). A
 * pick lands the literal `@<relative path> ` text and the prompt ships the
 * same literal (plain-text-reference decision, same as ui-skill's '/name':
 * the draft carries plain text and the model resolves the path itself).
 *
 * Tree fetches are cached per session (the small twin of ui-skill's catalog
 * cache): per-keystroke candidates re-poll filters a settled snapshot
 * locally, so one session costs one request. The scope-birth warm hook
 * prewarms the session's key; connection/reset clears everything — the host
 * project tree may differ across generations. A shared in-flight fetch
 * deliberately outlives any single menu interaction: closing the menu must
 * not kill the prewarm other consumers will hit, so it carries its own abort
 * (fired only on invalidation/teardown) while a candidates caller with an
 * aborted signal just returns early.
 *
 * No lexicon: the draft decoration scan matches word-ish names only
 * (/(^|\s)([/@])([\w-]+)/g), so '@' + paths never decorate — the reference
 * stays plain text by design. No adjudication hooks: file references never
 * enter command adjudication.
 */

// Type-only: the runtime context and the trigger-source contract.
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ClientSessionContext, InputTriggerCandidate, InputTriggerServiceContract, InputTriggerSource,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { ErrorResponse, FileEntry, TreeResponse } from '../wire.ts'

/** Services required by the '@' source registration. */
export const inject = ['inputTriggers']

/** The plugin's tree endpoint (same-origin host route). */
const TREE_ENDPOINT = '/plugin/ui-filesystem/tree'

/** UI cap on candidates per query: the menu renders every item, so an empty query must stay bounded. */
const MAX_CANDIDATES = 50

/** Pause before one retry of a failed tree fetch (host session attach race). */
const RETRY_DELAY_MS = 300

/** One session's tree fetch: the shared promise plus its own abort handle. */
interface TreeFetch {
  readonly promise: Promise<readonly FileEntry[]>
  readonly abort: AbortController
}

/** Menu candidate carrying the entry's relative path for the pick outcome. */
export type FileCandidate = InputTriggerCandidate & { readonly path: string }

/** Filter entries by basename-prefix (case-insensitive), capped, preserving the settled sort. */
function filterEntries(entries: readonly FileEntry[], query: string): FileCandidate[] {
  const needle = query.toLowerCase()
  const out: FileCandidate[] = []
  for (const entry of entries) {
    if (out.length >= MAX_CANDIDATES) break
    if (!entry.name.toLowerCase().startsWith(needle)) continue
    out.push({ name: entry.name, description: entry.path, path: entry.path })
  }
  return out
}

/**
 * Client plugin body: register the '@' filesystem source over the session-keyed tree cache.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // Session-keyed tree cache; single-flight per key. Plugin-closure state:
  // the fiber effect below is its teardown boundary.
  const fetches = new Map<SessionId, TreeFetch>()

  const fetchTree = (sessionId: SessionId): Promise<readonly FileEntry[]> => {
    const existing = fetches.get(sessionId)
    if (existing !== undefined) return existing.promise
    const abort = new AbortController()
    const promise = (async () => {
      const response = await fetch(`${TREE_ENDPOINT}?sessionId=${encodeURIComponent(sessionId)}`, {
        headers: { accept: 'application/json' },
        signal: abort.signal,
      })
      const body = await response.json() as TreeResponse | ErrorResponse
      if (!response.ok || !('entries' in body)) {
        const message = 'error' in body
          ? `${body.error.code}: ${body.error.message}`
          : `tree request failed with status ${response.status}`
        throw new Error(message)
      }
      // Stable settled order: the menu re-filters this snapshot per keystroke.
      return [...body.entries].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
    })()
    const entry: TreeFetch = { promise, abort }
    fetches.set(sessionId, entry)
    // A failed fetch must not poison the key: the next consumer retries.
    promise.catch(() => {
      if (fetches.get(sessionId) === entry) fetches.delete(sessionId)
    })
    return promise
  }

  const clearAll = (): void => {
    for (const key of [...fetches.keys()]) {
      const entry = fetches.get(key)
      if (entry === undefined) continue
      fetches.delete(key)
      entry.abort.abort()
    }
  }

  const source: InputTriggerSource = {
    trigger: '@',
    name: 'filesystem',
    order: 1,
    async candidates(session: ClientSessionContext, { query, signal }) {
      let entries: readonly FileEntry[]
      try {
        entries = await fetchTree(session.sessionId)
      } catch {
        // One retry: a freshly started host generation may not have the
        // session attached yet, and a failed fetch closes the menu silently.
        // The menu stays pending (loading row) through this second attempt.
        if (signal.aborted) return []
        await new Promise(resolve => { setTimeout(resolve, RETRY_DELAY_MS) })
        entries = await fetchTree(session.sessionId)
      }
      // Superseded keystroke: the shared fetch stays warm, this caller yields.
      if (signal.aborted) return []
      return filterEntries(entries, query)
    },
    warm(session: ClientSessionContext) {
      // Fire-and-forget scope-birth prewarm; the shared fetch reports
      // through candidates.
      fetchTree(session.sessionId).catch(() => {})
    },
    onPick({ candidate }) {
      // The path rides the candidate's own field; the menu renders the
      // basename first and the path after. Fall back to the name when a
      // candidate carries no path (defensive; our candidates always do).
      const path = 'path' in candidate && typeof candidate.path === 'string'
        ? candidate.path
        : candidate.name
      // Plain-text reference: the literal lands in the draft and ships to the
      // model verbatim (trailing space closes the token).
      return { text: `@${path} ` }
    },
  }
  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract
  ctx.on('connection/reset', clearAll)
  ctx.effect(() => {
    const unregister = inputTriggers.registerSource(source)
    return () => {
      unregister()
      clearAll()
    }
  }, 'ui-filesystem: @ source')
}
