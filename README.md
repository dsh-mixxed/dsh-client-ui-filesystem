# ui-filesystem

**English** · [中文](README.zh.md)

A dsh plugin that adds **`@` project file/directory suggestions** to the chat composer: type `@` to browse the current project (the session's working directory), pick a file or directory, and the draft gains a `@path` reference that ships to the model verbatim.

Built as a fully out-of-tree plugin — the deepseek-harness source stays untouched. It rides the same input-trigger pipeline as ui-skill's `/` (so it coexists with ui-subagent's `@` mentions as a second menu group), and it serves its project tree over its own HTTP route (`ctx.webServer`).

## Install

1. Install the plugin from npm (published as `@dsh-mixxed/dsh-client-ui-filesystem`):

   ```sh
   dsh plugin --profile web add @dsh-mixxed/dsh-client-ui-filesystem
   ```

   The package declares `dsh.bundle` (its bundled `cordis.patch.yml`), so `dsh plugin add` automatically appends it to the profile's `dsh.profile.bundles` layer stack and the plugin mounts on the next boot — **no manual `cordis.patch.yml` editing**.

   Upgrading an install that predates the bundle declaration: remove the legacy `ui-filesystem` row from `$DSH_HOME/profiles/<name>/cordis.patch.yml` — the bundle layer now supplies it, and leaving both would mount the id twice.

2. Restart the profile (new plugins are discovered at boot), open any session, and type `@`.

### Building from source (development / offline)

```sh
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
npm pack          # produces dsh-mixxed-dsh-client-ui-filesystem-<version>.tgz
dsh plugin --profile web add ./dsh-mixxed-dsh-client-ui-filesystem-<version>.tgz
```

## Features

- **`@` trigger**: same pipeline as ui-skill's `/` (`ui-input-trigger`), shown alongside ui-subagent's `@` mentions as its own menu group
- **Basename-prefix matching**: the query matches only the file/directory **name** prefix, never the path prefix — `@index` hits `src/index.ts` and `test/index.ts`; path-shaped queries like `@src/` return nothing (by design)
- **Filename-first rows**: every candidate shows the file/directory name first and the relative path after (e.g. `index.ts  src/index.ts`)
- **Plain-text references**: picking replaces the `@` token with the literal `@relative/path ` — the prompt ships the same literal and the model resolves the file with its own fs tools
- **Per-session caching**: each session fetches the bounded project tree once; keystroke filtering happens locally, and `connection/reset` rebuilds the cache
- **Bounded walk**: skips `node_modules` / `.git` / hidden entries (configurable), caps depth at 6 and entries at 2000, and never lists symlinks
- **Retry on failure**: a failed tree request (e.g. right after the host restarts, before the session is attached) retries once, keeping the menu in its loading state instead of vanishing

## Usage notes (harness behavior, accepted as-is)

- **Where `@` triggers**: the trigger char must sit at the start of the draft, after whitespace, or after punctuation. A Chinese character directly before `@` does **not** trigger (`请查看@index` is a miss; `请查看，@index` works) — the trigger detector treats CJK letters as word characters. That rule lives in the harness's `ui-input-trigger`; this plugin does not modify the harness, so inline references work best with a space or punctuation before `@`.
- **Loading state**: while the project tree loads, the menu opens immediately with the group's existing text-only loading row (`正在加载…`); an animated spinner would require modifying the harness menu component, which this plugin does not do.
- **No chip decoration**: `@path` stays plain text in the draft — the decoration scanner only matches word-ish names, so paths never render as chips (DESIGN.md §7.1).
- **No menu group title**: the harness menu renders a raw per-source title row (the `slash.menu` dictionary is exclusively owned by the harness); since `@` shows only this plugin's group, the title row is hidden with one injected CSS rule.
- Full boundary list: `DESIGN.md` §7.

## Verify

```sh
dsh --profile <name> --dump-config | Select-String ui-filesystem
```

The composed config shows the `ui-filesystem` row, and `$DSH_HOME/profiles/<name>/package.json` lists `@dsh-mixxed/dsh-client-ui-filesystem` under `dsh.profile.bundles` (auto-appended by `dsh plugin add`).

After the restart: `@` opens the `filesystem` group (name first, path after) → basename-prefix filtering → picking inserts `@path ` → the model can read the file from the prompt literal.

## Config (optional)

Tune the walk bounds from your profile's own `cordis.patch.yml` — the user layer is applied after the bundle layer, so an id-targeted patch overrides the bundled mount row:

```yaml
- id: ui-filesystem
  name: "@dsh-mixxed/dsh-client-ui-filesystem"
  config:
    maxDepth: 6          # max path-segment depth (default 6)
    maxEntries: 2000     # total entry cap (default 2000)
    skipHidden: true     # skip dot-prefixed entries (default true)
    skipPatterns:        # basename exact-match skip patterns (default node_modules, .git)
      - node_modules
      - .git
```

## License

[MIT](LICENSE)
