# Tochny Brosok — project rules

Always-on overlay for WARDOGS artillery: an Electron app over the game, with an offline map and a layer
over the in-game map. These rules resolve the project-specific questions of the skills in
`.claude/skills` (their step 0). The skills themselves carry the full canon.

## Stack

- Electron 44 (Chromium + Node 24), TypeScript `strict`, React 19 for the overlay window only.
- Build: Vite for the renderer pages and workers, esbuild for main and preloads. pnpm.
- Lint and format: ESLint flat config, `typescript-eslint`, `@stylistic` (block from `imports-exports`).
  **No Prettier.**
- Tests: unit tests on pure code; Electron checks in `tests/` (see Testing).

## Structure (`app-structure` step 0)

- **Features root:** `src/features`. Domains:
  - `fire-plan`: targets, presets, the offline map, the fire solution and the manual calculator. One
    domain, since the calculator edits the same selected target as the map;
  - `game-map`: the layer over the in-game map, the area picker, their main-process part;
  - `window`: the overlay window's chrome (title bar, menu, tabs, grips, the focusless select list);
  - `updates`: the updater (main) and its pill in the title bar.
- **Entry folder:** `src/pages` is Vite's root. One HTML file per window at its top
  (`index.html` = overlay, `layer.html`, `area-picker.html`: the build keeps these names in `dist/`)
  and the entry code in `src/pages/<window>/` (`overlay/main.tsx`, `layer/main.ts`, `picker/main.ts`).
  Only `overlay` is a React app. `layer` and `picker` are plain TS: the layer runs a 60–120 fps
  capture loop and has almost nothing to render.
- **Composition:** features never import each other. The overlay page (`src/pages/overlay/`) wires
  them: `App.tsx` lays the window out and passes slots (`WindowBar updatePill`, `MapTools actions`),
  `bridge.ts` feeds the preload's pushes into the stores once at start, `useOverlaySync.ts` sends
  the stores' state back to main.
- **Processes:** `src/main/` (main process: app, windows, tray, settings), `src/preload/` (one file per
  window kind).
- **Whitelist extension** for feature folders, next to the canon's `components/`, `hooks/`, `stores/`,
  `utils/`, `constants/`, `types/`, `mocks/`:
  - `core/`: pure logic, no DOM, Electron or Node imports, unit-tested;
  - `main/`: this feature's main-process part (windows, IPC handlers);
  - `worker/`: Web Worker entries;
  - `layer/`: modules of the framework-free layer page.
- **Shared-code policy:** in-app. There is no shared package. Code used by 2+ features or processes
  lives in `src/shared/` (`ipc/`, `i18n/`, `geometry/`, `format/`, `zones/`, later `ui/`, `styles/`).
- Data: `src/data/` (landmarks); generated files in `src/data/generated/` (`pnpm zone-patches`).

## Imports and exports (`imports-exports` step 0)

- Alias `@/*` → `src/*`: set in `tsconfig`, Vite, esbuild and the test runner alike (runtime-real).
- Named exports only. `export default` only in config files (`vite.config.mts`, `vitest.config.mts`, `eslint.config.mjs`).
- Barrels: every feature has `index.ts` for the overlay window. A feature with code for another
  bundle has a separate entry for it, so a bundle never pulls in another process's modules:
  `@/features/<x>/main` (main process: `game-map`, `updates`) and `@/features/game-map/layer`
  (the plain-TS layer and picker pages, which must not pull in React and the overlay's stores).
  Pages and `src/main` import from these entries only.

## Styles

- No MUI. The overlay works without focus, and components that need focus to open (focus traps,
  portals that steal focus, native `<select>`) break there.
- Now: the 1.x global CSS, moved as is (`src/pages/overlay/{style,maps}.css`, `src/pages/layer.css`).
  Components keep the 1.x ids and classes, which the CSS and the Playwright checks rely on.
- Target: CSS modules per component, design tokens as CSS variables in
  `src/shared/styles/tokens.css`, no hardcoded colours outside the tokens. Move a component's rules
  into its module when the component changes; do not sweep.
- The HUD look (Bahnschrift, amber on near-black) stays. Keep `:root` token names when moving CSS.

## State

- Overlay window: Zustand stores per `create-store`, app-local (no SDK). Window-wide stores live in
  `src/store/` (`overlay`: what main pushes; `ui`: tab, compact, map shown, font, poll rate); a
  feature's own store in `src/features/<x>/stores/<name>/` (`fire-plan`: `firePlan`). Code outside
  React reads them through `get…` helpers (`getFirePlan`, `getOverlayActions`, `getMode`).
  Persisted to `localStorage` under the existing keys:
  - `shot-map-presets-v1` for targets per map/region/zone;
  - `shot-ui-v1` for UI settings.

  Users' saved targets must survive the migration.
- Language: `userData/settings.json`, owned by main. Pages get it from their preload.

## Text

- Every user-visible string goes through `t()` from `@/shared/i18n`. English is the default; Russian and
  Ukrainian are complete: `ru` and `uk` are typed `Record<TextKey, string>`, and `tests/unit/i18n.test.ts`
  checks their keys, placeholders and markup against `en`. A new text needs all three.
- Russian users are the main audience of the Russian UI. Keep Russian and Ukrainian texts natural, not
  literal, and never make Ukrainian a calque of the Russian.

## Electron and native constraints

Read `.claude/skills/electron-best-practices`. The non-negotiables:

- Never take the game's keyboard by yourself. Windows that only need the mouse are `focusable: false`.
- Never inject input into the game (no synthetic clicks or wheel): anti-cheat. Never touch the game
  process.
- Build output layout is a contract with installed copies' updater. Keep `package.json`
  (`main: desktop/boot.cjs`), `desktop/*.cjs` and `dist/index.html`, `dist/layer.html`,
  `dist/area-picker.html`, `dist/maps/`. `desktop/` and `dist/` are build output (`pnpm build`),
  not in git. `boot` and `update-core` stay dependency-free (Node built-ins only).
- On-disk formats stay 1.x's: `state.json` of the updater (`confirmed`, `broken`), `map-area.json`
  (`snapped`), `settings.json`, `window-position.json` (`compact`). In memory the fields follow the
  `is`-prefix canon; the read/write functions map the names.
- Every IPC channel is declared once in `src/shared/ipc/contract.ts`. Main validates the sender and
  the payload.

## Testing

- `pnpm test` runs unit tests (pure code) and must stay green.
- Off-screen checks are safe to run any time: `pnpm check:zone`, `check:terrain`, `check:sweep` (they
  bundle the game-map core from `src/` with `scripts/build-test-core.mjs`) and `check:pages` (builds, then
  loads every page hidden: no console errors, the overlay renders, the module worker starts).
- `update-check` starts the real app (`pnpm build` first): its window shows, so it counts as on-screen.
- `keyboard-check` is manual: it waits for a person to press Insert in its stand-in window. Never send
  the key synthetically.
- On-screen checks (`layer-check`, `soak-check`, Playwright ones) put windows over the screen. Ask the
  user first (they may be in a match), and ask them to keep hands off the mouse and keyboard while
  the checks run.
- Game-map detection changes are checked against `sweep-check` (all zones × zooms) and the user's
  snapshots in `tests/fixtures/game-na-*.webp`.

## Process

- Commit and push only when the user asks. Work on the branch the user named.
- A release gets its Discord announcements from `.github/news.md` (Russian) and `.github/news.en.md`
  (English); the first line of each names the version. Update both with the version bump. The Release
  workflow posts them after publishing.
- Comments: `code-comments`. Keep the WHY comments about Windows, capture and thresholds. They were
  measured, not guessed.
- `node` is not on PATH on the author's machine by default. If it is missing, Electron's own Node works
  for plain scripts: `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe <script>`.
