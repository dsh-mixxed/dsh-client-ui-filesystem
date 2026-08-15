/**
 * ui-filesystem host half: serves the project tree over the plugin's own HTTP
 * route (`ctx.webServer`). The route resolves the session's project root from
 * the host-resident session header (`ctx.sessions.get(sessionId).header.cwd`)
 * — the client never submits a raw path — then walks that root through
 * `ctx.fs` with depth/entry bounds and skip policy, returning bounded entries
 * for the browser half's '@' suggestions. Every request computes fresh: the
 * tree is a live hint source, never cached host-side.
 * @module ui-filesystem
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.sessions Context merge and the SessionId brand.
import type {} from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session'
// Type-only: pulls the ctx.fs Context merge.
import type {} from '@deepseek-ai/dsh-fs'
// Type-only: pulls the ctx.webServer Context merge.
import type {} from '@deepseek-ai/dsh-host-webserver'
import { walkTree, type FsReader, type WalkFailure, type WalkOptions } from './walk.ts'
import type { ErrorResponse, TreeResponse } from './wire.ts'

export const name = 'ui-filesystem'

/** Services required by the tree route. */
export const inject = ['sessions', 'fs', 'webServer']

/** Route prefix under which the plugin serves its API. */
export const API_PREFIX = '/plugin/ui-filesystem'

/** Deployment-varying walk bounds; every field optional with a validated default. */
export interface Config {
  /** Maximum path-segment depth of listed entries (default 6). */
  readonly maxDepth?: number
  /** Total entry cap; the walk stops when reached (default 2000). */
  readonly maxEntries?: number
  /** Skip dot-prefixed entries (default true). */
  readonly skipHidden?: boolean
  /** Basename exact-match skip patterns (default ['node_modules', '.git']). */
  readonly skipPatterns?: readonly string[]
}

/** Config with every field resolved to a concrete value. */
export type ResolvedConfig = Required<Config>

/**
 * Validate and resolve the plugin Config; throws on invalid values so a
 * misconfiguration fails loud at load.
 * @param config - raw plugin config (may be absent).
 * @returns the resolved config with defaults applied.
 */
export function resolveConfig(config: Partial<Config> = {}): ResolvedConfig {
  const maxDepth = config.maxDepth ?? 6
  const maxEntries = config.maxEntries ?? 2000
  const skipHidden = config.skipHidden ?? true
  const skipPatterns = config.skipPatterns ?? ['node_modules', '.git']
  if (!Number.isInteger(maxDepth) || maxDepth < 1) {
    throw new Error('ui-filesystem: maxDepth must be a positive integer')
  }
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new Error('ui-filesystem: maxEntries must be a positive integer')
  }
  if (!Array.isArray(skipPatterns) || skipPatterns.some(pattern => typeof pattern !== 'string')) {
    throw new Error('ui-filesystem: skipPatterns must be an array of strings')
  }
  return { maxDepth, maxEntries, skipHidden, skipPatterns: [...skipPatterns] }
}

/** The sessions surface the route reads (a subset of `ctx.sessions`). */
export interface SessionsReader {
  get(id: SessionId): { readonly header: { readonly cwd?: string } } | undefined
}

/** Everything the route handler needs, injectable for tests. */
export interface TreeRouteDeps {
  readonly sessions: SessionsReader
  readonly fs: FsReader
  readonly config: ResolvedConfig
  /** Subtree failures sink (unreadable directories are skipped, not fatal). */
  readonly onWalkError?: (failure: WalkFailure) => void
  /** Request-level failure sink (logging). */
  readonly onRequestError?: (error: unknown) => void
}

/** Write one JSON response with no-store caching. */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(text)
}

/** Uniform error body. */
function errorBody(code: string, message: string): ErrorResponse {
  return { error: { code, message } }
}

/**
 * Route handler for the plugin API: GET /plugin/ui-filesystem/tree.
 * @param deps - sessions/fs readers, resolved config, and failure sinks.
 * @returns the node:http handler.
 */
export function makeTreeHandler(deps: TreeRouteDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://ui-filesystem')
      if (url.pathname !== `${API_PREFIX}/tree`) {
        sendJson(res, 404, errorBody('not-found', `unknown route ${url.pathname}`))
        return
      }
      if (req.method !== 'GET') {
        sendJson(res, 405, errorBody('method-not-allowed', `method ${req.method} is not allowed`))
        return
      }
      const sessionId = url.searchParams.get('sessionId')
      if (sessionId === null || sessionId === '') {
        sendJson(res, 400, errorBody('missing-session', 'query parameter sessionId is required'))
        return
      }
      const session = deps.sessions.get(sessionId as SessionId)
      if (session === undefined) {
        sendJson(res, 404, errorBody('session-not-found', `session "${sessionId}" not found (not attached)`))
        return
      }
      const cwd = session.header.cwd
      if (cwd === undefined) {
        sendJson(res, 400, errorBody('no-project-cwd', `session "${sessionId}" has no project cwd`))
        return
      }
      const entries = await walkTree(deps.fs, cwd, deps.config satisfies WalkOptions, deps.onWalkError)
      const rootName = basename(cwd) || cwd
      sendJson(res, 200, { root: { name: rootName }, entries } satisfies TreeResponse)
    } catch (error) {
      deps.onRequestError?.(error)
      sendJson(res, 400, errorBody('bad-request', String(error)))
    }
  }
}

/** Register the tree route; a config error throws here, failing load loudly. */
export function apply(ctx: Context, config: Partial<Config> = {}): void {
  const resolved = resolveConfig(config)
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: makeTreeHandler({
        sessions: ctx.sessions,
        fs: ctx.fs,
        config: resolved,
        onWalkError: (failure) => {
          ctx.logger.debug(`ui-filesystem: skipped unreadable directory ${failure.path}: ${String(failure.error)}`)
        },
        onRequestError: (error) => {
          ctx.logger.warn(`ui-filesystem: ${String(error)}`)
        },
      }),
    }),
    'ui-filesystem: tree route',
  )
}
