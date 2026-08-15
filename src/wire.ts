/**
 * Wire contract for the ui-filesystem tree API. The host half produces it;
 * the browser half consumes it over the plugin's HTTP route. Keep this file
 * type-only: both halves import it and it must never carry runtime code into
 * a bundle.
 */

/** One project entry the browser menu suggests. */
export interface FileEntry {
  /** Basename of the file or directory (the menu's primary label). */
  readonly name: string
  /** Relative path from the session's project root, '/' separators. */
  readonly path: string
  /** Whether the entry is a regular file or a directory. */
  readonly type: 'file' | 'directory'
}

/** GET /plugin/ui-filesystem/tree response value. */
export interface TreeResponse {
  /** The project root's basename (display context for the fetched tree). */
  readonly root: { readonly name: string }
  /** Bounded project tree walk, in walk order. */
  readonly entries: readonly FileEntry[]
}

/** Uniform plugin-route error body. */
export interface ErrorResponse {
  readonly error: { readonly code: string; readonly message: string }
}
