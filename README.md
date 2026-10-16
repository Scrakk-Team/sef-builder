# sef-builder

Authoring CLI for **Scrakk Studio** extensions (SEF packages): scaffold, bundle,
pack and validate.

Published to npm as [`@scrakk-official/cli`](https://www.npmjs.com/package/@scrakk-official/cli);
the binary it installs is **`sef`**.

> The SEF package format and the app-side rules are documented in the
> [Scrakk Studio docs](https://github.com/Scrakk-Team/Scrakk-Studio/tree/master/docs/extensions/reference/cli.md).

## Install

```sh
npm install -g @scrakk-official/cli      # from npm (once published)
npx @scrakk-official/cli build ./ext     # on demand
```

### Without the npm registry

You do **not** need the package published: install the tarball attached to the
latest GitHub Release (npm downloads a ready-made bundle, it builds nothing):

```sh
npm install -g https://github.com/Scrakk-Team/sef-builder/releases/latest/download/cli.tgz
npx https://github.com/Scrakk-Team/sef-builder/releases/latest/download/cli.tgz build ./ext
```

Or let npm clone the repo itself and build it (standard npm):

```sh
npm install -g github:Scrakk-Team/sef-builder
```

## Usage

```sh
sef create   "<name>" [dir]   # scaffold with a sample panel
sef build    <dir>            # bundle → dist/modules.js
sef pack     <dir>            # validate and write <dir>.sef
sef validate <dir>            # validate only
sef --help
sef --version
```

### `create`

Computes the `id` from the name (lowercased; anything outside `[a-z0-9._-]`
becomes `-`, accents are lost — use ASCII) and writes `<dir>/<id>/` with a
`manifest.json` and a sample `panels/Panel.tsx`.

### `build`

Generates a **virtual entry** from the manifest (nothing hardcoded) and
compiles it with `esbuild` (`format: esm`, `jsx: automatic`,
`platform: browser`, `external: ['react','react-dom']`) to `dist/modules.js`,
which exports:

```js
export const modules = { "panels/Panel.tsx": Panel /* … */ }
```

Collected paths: `panels[].component`, `activityBar[].icon`,
`centerTabs[].component` and `centerTabs[].icon`.

### `pack`

Validates first; on errors it does not pack. Zips the manifest + `dist/` + the
data folders (`themes/`, `icons/`, `productIcons/`, `lsp/`, `events/`) and the
pack's `assets/` — plus `CREDITS.md` / `LICENSE*`, so the attribution of any
third-party asset travels with the package — into `<packageRoot>.sef` (next to
the package folder).

### `validate`

Checks (mirroring the core's runtime rules): `id` matches
`^[a-z0-9][a-z0-9._-]*$`; `name` not empty; `version` semver; `engine` a string;
`runtime` a `{ entry: string }`; `permissions` in the catalogue; `contributes`
exists with only known kinds; every referenced code path exists; themes/icons
without `path` have their conventional file; event scenes have `specVersion` and
`timeline`, and the audio they reference exists.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build      # bundles src/ → dist/index.js
node dist/index.js --help
```

`dist/` **is committed** (13 KB) so `npm install -g github:Scrakk-Team/sef-builder`
works without a build step — npm's git-dependency flow runs `prepare` before the
dependencies are available, so building at install time is not reliable. CI fails
if `dist/` is stale: always `npm run build` before committing.

Layout: `src/config.ts` (conventions), `src/schema.ts` (validation),
`src/api.ts` (create/build/pack), `src/index.ts` (CLI surface),
`src/version.ts` (semver-lite helper), `tests/` (end-to-end suite).

## Publishing

Releases are published from CI on `v*` tags via **npm Trusted Publishing**
(OIDC — no token stored); see `.github/workflows/publish.yml`. Configure the
trusted publisher once on npm (package → Settings → Trusted Publisher):
repository `Scrakk-Team/sef-builder`, workflow `publish.yml`.

The same run attaches `cli.tgz` + `install.sh` to **this repo's** GitHub Release
as a registry-free fallback. Releases live here, never in `Scrakk-Studio`, so
the app's auto-update is untouched.

## License

Apache-2.0. See [LICENSE](./LICENSE).
