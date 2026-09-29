---
name: electron-best-practices
description: Electron canon for this app's native side — process model, security checklist, the typed IPC contract, sandboxed preloads, overlay windows that never take the game's focus, screen capture, tray and global shortcuts, workers, packaging and the custom auto-updater. Use whenever touching src/main, src/preload, a BrowserWindow option, an IPC channel, desktopCapturer/getUserMedia, globalShortcut, Tray, dialogs, clipboard, the updater or electron-builder config, or when reviewing Electron code for security or performance.
---

# Electron best practices — Tochny Brosok

Sources: the official [security checklist](https://www.electronjs.org/docs/latest/tutorial/security)
and [performance checklist](https://www.electronjs.org/docs/latest/tutorial/performance), plus what this
app learned on Windows over a game (the facts in §4 were measured, not assumed — keep them).

## 1. Process model

| Process | Code | May use | Never |
|---|---|---|---|
| main | `src/main/**`, `src/features/*/main/**` | Node, every Electron main API, the file system | DOM, anything slow on the event loop (a blocked main stalls every window) |
| preload | `src/preload/*.ts` — one per window kind | `contextBridge`, `ipcRenderer` | a second import at runtime (sandboxed: bundle each preload into one file), exposing `ipcRenderer` itself |
| renderer | `src/pages/*`, `src/features/*/{pages,components,layer,…}` | DOM, workers, `window.overlay` / `window.mapLayer` from the preload | Node, `require`, Electron modules |
| worker | `src/features/game-map/worker/*` | pure TS (`core/`) | DOM |

Code shared by several processes is pure TS in `src/shared/**` or a feature's `core/` — no Electron, no DOM,
no Node imports there, so it runs in all of them and in unit tests.

## 2. Security checklist (status in this app)

Keep every window on these `webPreferences`; a new window copies them, it does not invent its own:

```ts
{ contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, preload }
```

| # | Rule | Here |
|---|---|---|
| 2–4 | no `nodeIntegration`, `contextIsolation` on, sandbox on | all windows |
| 6, 8–10 | never disable `webSecurity`, no `allowRunningInsecureContent`, no experimental/Blink features | keep |
| 7 | CSP on every page | `default-src 'self'; script-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'` — no inline scripts, no `eval`; the bundler must not emit inline code |
| 13–14 | block navigation and new windows | every window: `setWindowOpenHandler(() => ({ action: 'deny' }))` and `will-navigate` → `preventDefault()` |
| 15 | `shell.openExternal` only with URLs the app built itself | the updater's release page only |
| 16 | current Electron | the runtime version is part of the update manifest: a new runtime needs a full download (see §7) |
| 17 | validate the sender of every IPC message | each handler checks `event.sender` against the window it belongs to (`fromLayer`, `event.sender === overlay.webContents`) **before** reading the payload |
| 18 | prefer a custom protocol to `file://` | open item: `getUserMedia({ chromeMediaSource: 'desktop' })` worked only from `file://` pages here — retest with `protocol.handle` before switching the layer |
| 19 | fuses | open item: flip `RunAsNode` off for the packaged exe (keep the dev `electron.exe` as is — tests use `ELECTRON_RUN_AS_NODE`) |
| 20 | expose only what the page needs | one method per action, typed; never a generic `send(channel, …)` |

Remote content: none. Maps are bundled; the only network traffic is the updater (§7).

## 3. IPC contract

- One source of truth: `src/shared/ipc/contract.ts` — each channel's name, direction, payload type and
  validator. `main` handlers, preload bridges and page calls are typed from it; a channel exists nowhere
  else as a string literal.
- `invoke`/`handle` for a request that returns a value (`layer:config`, `overlay:paste`); `send`/`on`
  for events either way. `sendSync` only for the one-time language read in a preload.
- Validate every payload in main as untrusted input: shape, types, ranges, lengths (the `clean*`
  functions). Unknown or out-of-range → ignore, never throw into main's event loop.
- Main → page pushes go through `webContents.send` after checking `!win.isDestroyed()`.
- Errors thrown in a `handle` reach the page prefixed `Error invoking remote method '…': ` — strip it
  before showing text to the user.

## 4. Overlay windows over a game (Windows) — measured facts

- **Never take the game's keyboard by yourself.** A game that loses the foreground mutes its sound and
  its keys (M included) stop working. Windows that only need the mouse are `focusable: false`: they still
  get real left and right clicks while the game stays the foreground window.
- Click-through: `setIgnoreMouseEvents(true, { forward: true })` — `forward` delivers mouse *moves* only
  (it is a low-level hook); clicks and the wheel go to the window below. Wheel over a transparent window
  reaches the game only while ours ignores the mouse.
- Hand the mouse to the game for a gesture (wheel, drag) by ignoring mouse events for a while; the
  gesture that asked is lost, the next reach the game. End the hand-over on the *calibration* standing
  still, never on "the picture stopped changing": the game animates its map all the time. Always cap it.
- **Never inject input into the game** (no `SendInput`, no synthetic clicks or wheel): anti-cheat can
  flag it. Never read or write the game's process.
- `overlay.blur()` hands the foreground to the next topmost window, not to the game, and a window that
  lost the foreground cannot take it back — never rely on `blur()` to return focus.
- `setFocusable()` on Windows also deactivates the window, with the same hand-over to the next window,
  and right after a global hotkey the app has the right to move the foreground. Calling
  `setFocusable(false)` on every mode change made Insert take the keyboard from the game (1.x did it;
  `keyboard-check` showed it). Call it only when focusability really changes.
- Always on top over a borderless game: `setAlwaysOnTop(true, 'screen-saver')` and `showInactive()`.
- Moving and resizing a non-focusable frameless window: Windows' own title-bar drag
  (`-webkit-app-region: drag`) activates the desktop and the game loses focus; the page drives the
  move/resize through IPC following `screen.getCursorScreenPoint()`. Native resize borders do nothing
  without focus — draw grips of 10–16 px.
- `resizable: false` sets min = max = the current size; use min/max sizes instead.
- A native `<select>` does not open in a non-focusable window: the page draws its own list. The same
  holds for anything that needs focus to open (menus with focus traps, popovers that steal focus) — pick
  UI components that work without focus.
- `setContentProtection(true)` keeps our own drawings out of our own screen capture (it excludes, it
  does not black out).
- Page zoom (`setZoomFactor`) propagates across same-origin pages of one session: windows that must stay
  at 100 % use their own `partition`.

## 5. Screen capture

- `desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })` in main;
  the source id goes to the page through the IPC contract.
- Page: `getUserMedia({ video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId, maxFrameRate } } })`
  (only from `file://` so far, §2.18), `MediaStreamTrackProcessor` with `maxBufferSize: 1`.
- Read pixels with `VideoFrame.copyTo(buffer, { rect })` into reused buffers (~0.4 ms); canvas readback
  costs 35–150 ms. Frames arrive as I420 on NVIDIA; handle I420A/I422/I444/NV12/RGBX/BGRX and ask the
  browser for RGBX otherwise. Convert only the pixels you need (`pixelReader`, `frameLuma`).
- Capture windows set `backgroundThrottling: false`. Close every `VideoFrame` in `finally`.
- Heavy work (FFT terrain search) runs in workers; the capture page's main thread only tracks.

## 6. Native bits

- **globalShortcut**: register in `whenReady`, handle failure (another app holds the key → tell the user,
  offer the tray), `unregisterAll` on `will-quit`. Tests replace `globalShortcut.register` so they never
  take Insert from a running copy.
- **Tray**: the menu is rebuilt when its state changes (update state, language); every action the window
  offers is reachable from the tray too, since the window may be hidden or click-through.
- **Dialogs**: `dialog.showMessageBox(parent, …)` with text from `i18n`; `showErrorBox` only before any
  window exists.
- **Clipboard** (Electron 44): `clipboard.readText`/`writeText` return Promises — `await` them; validate
  what goes in (coordinates only).
- **Single instance**: `requestSingleInstanceLock()`; a second start focuses the first (`second-instance`).
- **Native Node modules**: avoid. Everything here is pure JS/TS on purpose (no rebuilds per Electron
  version, no per-arch binaries). If one ever becomes necessary: N-API only, prebuilt binaries, and a
  separate decision.
- **Default menu**: `setMenu(null)` on every window (performance checklist #8).

## 7. Packaging and updates

- `electron-builder` builds the portable folder/EXE; ASAR stays off while the updater unpacks plain files.
- The custom updater (`features/updates`) is a contract with **installed** copies:
  - installed 1.x copies check `desktop/main.cjs` and `dist/index.html` in a downloaded app bundle
    and start `updates/<version>/desktop/main.cjs` with their own old `boot.cjs`;
  - so the build output keeps exactly this layout: `package.json` (`main: desktop/boot.cjs`),
    `desktop/*.cjs`, `dist/*.html|js|css`, `dist/maps/**`. Sources live in `src/`, never in `dist/`.
  - `update.json` carries size and SHA-256 of both bundles and the Electron version; a different
    Electron version means "full download", not a silent bundle update.
- `src/main/boot.ts` and `features/updates/main/update-core.ts` import nothing but Node built-ins and
  `electron`; esbuild turns boot into a small self-contained `desktop/boot.cjs`. They run before
  anything else and must never break on a bad update.
- After any change to build output: run `tests/update-check.cjs` (fake GitHub API) and update a real
  1.2.0 install to the new bundle once before releasing.

## 8. Performance

- Bundle: one file per window kind and per process (checklist #7); target the bundled Chromium and Node
  (no polyfills, no down-levelling of hot loops).
- Nothing expensive before the first window shows (checklist #2); load big data lazily (fine map pyramids
  after the first frames).
- Hot loops over typed arrays stay plain `for` loops over reused buffers — no per-frame allocations in
  the capture path (a 4 MB garbage per frame at 60 fps is a stutter).

## 9. Testing

- Unit: pure `core/`, `shared/` and main helpers (validators, update-core) — no Electron needed.
- Off-screen Electron checks (`zone-check`, `terrain-check`, `sweep-check`): hidden windows, safe to run
  any time, CI-able.
- On-screen checks (`layer-check`, `soak-check`, Playwright `_electron` ones) put always-on-top windows
  over the screen: ask the user first (they may be in a match) and ask them to keep hands off the mouse
  and keyboard while they run — clicks make them fail at random places.
- Playwright via `_electron.launch` for the overlay UI; never Spectron (dead).
