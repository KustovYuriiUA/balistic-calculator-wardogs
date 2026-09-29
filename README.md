<p align="center"><img src="media/nexus-header.png" alt="Точный бросок — tactical aiming overlay"></p>

# Точный бросок (Tochny Brosok) — WARDOGS ballistic overlay

Unofficial always-on-top Windows overlay for artillery and mortar fire in [WARDOGS](https://store.steampowered.com/app/1867240/WARDOGS/). Mark your position and targets on an offline map, read the azimuth and range to dial in, then right-click where the shell landed to get a corrected shot.

**[Download for Windows](https://github.com/KustovYuriiUA/balistic-calculator-wardogs/releases/latest)** · [Русская версия](README.ru.md)

![Map with targets and the fire solution](media/screenshots/map-edit.png)

## Download and run

1. Open [Releases](https://github.com/KustovYuriiUA/balistic-calculator-wardogs/releases/latest) and download `balistic-calculator-wardogs-win-x64.zip`.
2. Unzip the whole archive. Keep all files together.
3. Run `Точный бросок.exe` from the unzipped folder. No installer, Node.js or internet connection is needed.

- Windows 10/11 x64.
- The EXE is not code-signed, so SmartScreen may warn on first launch: **More info → Run anyway**.
- Run the game in **windowed** or **borderless** mode. Exclusive fullscreen can hide overlay windows.

## Features

- **Offline maps:** Kavkazi, Europe and North America, with faction bases (Manticore, Valkyra, Lonestar) and the control zone of each region.
- **Fire solution:** big azimuth (`043.2°`) and range (`4,066 m`) readout for the selected target, also shown next to the target on the map.
- **Impact correction:** right-click where the shell landed to get the corrected azimuth and range. Follow-up impacts chain from the corrected shot, and each card shows its shot number.
- **Game map layer (beta):** outline the in-game map (M) on screen once. The overlay then calibrates it by itself, by the green zone circle or by matching the terrain against the offline maps when the circle is out of view. It recognises the map and zone, draws your position, targets and the fire solution over the game map. It tells an open map from a closed one by the map's frame, so the points appear as you open the map and vanish as you close it. Press **Insert** to place points by clicking the game map itself; the wheel and dragging still move the game map meanwhile.
- **Several targets** at once, each with its own correction.
- **Presets:** position and targets are saved separately for every map, region and zone, and restored after restart.
- **A real overlay:** the window never takes the keyboard from the game, so the game keeps its sound and its keys, M included. It is click-through while you play and clickable while the game map is open or marker mode is on. Only a click into a text field gives it the keyboard; a click on the game takes it back.
- **Undo** (Ctrl+Z) for every change of points. Hotkeys work on any keyboard layout.
- **English, Russian or Ukrainian:** English by default; the **EN / RU / UA** select in the title bar (or **Language** in the tray menu) switches the whole app, the game map layer included, and the choice is remembered.
- **Compact layout:** **Compact** narrows the window to 420 px at the nearer screen edge, with the map on top and the solution and target list below. Its height follows the content, so viewing (less shown) is shorter than editing and there is no empty space; up to 10 targets show in full, more scroll. **Full view** restores the previous size, and the choice survives a restart. A window narrowed by hand switches to the compact layout by itself. In the manual calculator the result moves above the inputs.
- **Manual calculator readout:** the azimuth sits in a highlighted cell with bigger digits and the range is in cream, so the two values never blend.
- **Manual calculator** for entering pasted coordinates without the map.
- **Auto-update** from GitHub Releases: the overlay downloads new versions in the background and restarts into them when you click **↻ Update to …**.

| View mode over the game | Compact layout | Manual calculator |
|---|---|---|
| ![View mode](media/screenshots/view-mode.png) | ![Compact layout](media/screenshots/compact.png) | ![Manual calculator](media/screenshots/manual.png) |

## How to use

1. Open the map in the game (M), or press **Insert**: the overlay window turns clickable. Top right, pick the map, region and zone of your match; the game map layer picks them for you once it recognises the zone.
2. With the **Me** tool (G), click your position on the map. Or copy coordinates such as `x95.90, y109.42` and click **↵ Position** with the field empty: the button takes them from the clipboard, and the game keeps the keyboard. Typing into the field works too (Enter places the point).
3. With the **Target** tool (T), click one or more targets. The hint above the map always tells you the next step.
4. Dial the **azimuth** and **range** from the fire solution into the game and fire.
5. **Right-click** where the shell landed. The fire solution switches to the corrected values.
6. Missed again? Right-click the new impact. The next correction builds on the values you just fired with.
7. Close the game map, or press **Insert** again if marker mode is on. The overlay stays visible and click-through.

### Game map layer (beta)

1. Open the map in the game (M). In the overlay, click **Select capture area** next to the tools above the map (**Area** in the compact window), or use the ☰ menu or the tray menu. Once an area is saved, the button reads **Change capture area**. **Hide map** / **Show map** next to it toggles the overlay's own map.
2. The screen dims. Drag a rectangle around the in-game map square; a margin is fine. The game keeps the keyboard meanwhile, so M still opens its map. Once the map is calibrated, the overlay finds the square map panel inside the rectangle and fits the area to it exactly, so nothing around the map is analysed (message **Capture area fitted to the game map**). Right-click cancels. The area is saved for that monitor and resolution. After a resolution change, select it again. If the map panel moves anyway (another UI scale in the game), the overlay notices the zone circle off its frame and fits the area again.
3. From then on the overlay tells an open map from a closed one by the map's frame. While the map is closed, the row reads **Game map closed · M — open** and nothing is drawn. When you open it, the layer finds it again, usually on the first frames, because the last calibration is remembered, across restarts too. It draws your position, targets, lines and the fire solution over the map, as on the overlay's own map. The coordinates next to the cursor are the game's own; the overlay prints none of its own there (see below why). When you close the map, the points vanish at once.
4. **Calibration.** When the zone circle is in view, the layer uses it: a dashed outline marks the circle it found. The circle may be any colour, and its edge is found whether it is a thin line or a wide glow, which changes with the zoom. A circle only counts once the terrain inside it matches a known zone. The layer then knows the zone, and the overlay switches its map, region and zone to match, while marker circles and pings are ignored. When the circle is out of view (zoomed in or panned away), the layer matches the terrain against the offline maps instead, and the row reads **by terrain**. The terrain search checks all three maps at once in background threads and takes about 0.3–0.5 s. The row and a small line at the top of the game map show what it is doing: **looking for the zone circle…**, then **searching by terrain · 40 %**. If neither the circle nor the terrain is found, **not recognised — zoom out to the zone circle** asks you to zoom out until the circle is in view. After that the layer follows every zoom and pan of the game map, including a zoom step that doubles or halves the scale: a found circle is tracked near where it was on the frames before (about 1.5 ms a frame instead of 15 ms for a search of the whole frame), and the terrain is followed on its coarser levels while the map moves and refined once it stands still. On a zoomed-out map, where the circle is small and icons cover much of it, the circle also counts as the zone when the terrain puts it where that zone is.
5. **Marker mode.** Press **Insert**, with the game map open or before you open it. On the found map, left-click places the current tool (**Me** or **Target**), right-click marks the impact of the selected target, and a click on a pin selects or removes it, as on the overlay's map. Pick the tool and the target in the overlay window, which stays clickable. The keyboard stays with the game. The **mouse wheel** and **dragging** still move the game map: the layer hands the mouse to the game (the first wheel notch or drag is used for that and does not reach the game, the next ones do) and takes it back after a wheel as soon as you move the cursor to aim, or the map has stood still for about half a second, and after a drag once the cursor and the map have stood still for a moment. Meanwhile the frame around the map fades and a hint at the bottom says the game has the mouse. Nothing is ever sent to the game: it only gets the mouse. Press **Insert** again to hand the mouse back to the game map for good. With the map closed, marker mode waits for it (**Markers on · Game map closed**). The pill in the title bar shows the mode (**View**, **Map**, **Markers**, **Keyboard**), and clicking it switches marker mode too.

6. **Menu** (☰, top left of the overlay window): **Font size** scales the whole overlay window to 90, 100 (the default), 115 or 130 %; the compact window widens with it. **Map in the overlay window** hides or shows the overlay's own map. Without it, the window shows only your position, the fire solution and the targets, and a **Show map** button brings the map back. **Game map poll rate** sets how often the game map is analysed: 15, 30, 60 (the default) or 120 frames per second. Unchanged frames cost nothing, so a high rate only uses CPU while the map moves. **Game map snapshot for debugging** saves the frame the layer sees and what it found there to the `diagnostics` folder of the profile and opens that folder. Send those files when something goes wrong.

At the default map zoom one screen pixel is about 1.3 m. The circle is measured at its outer edge, where the tint ends; its scale then equals the spacing of the game's axis labels, which are 100 m apart. Readings match the game grid within 1–2 m by the circle and by the terrain alike. The coordinates the game prints next to its cursor can lag or be offset by several metres (13 m on one screenshot), so check against the grid lines; that is also why the overlay adds no readout of its own next to them. The layer is hidden from screenshots and recordings so that its own drawings never confuse the search. While the game map is closed, only its frame is checked, up to 20 times a second, which costs next to nothing. Until the area is fitted to the map panel, the terrain search runs in the background at most every 4–15 seconds instead.

## Controls

| Input | Action |
|---|---|
| `Insert` | Marker mode on the game map on / off; the overlay window is clickable meanwhile, the wheel and dragging still move the game map |
| Left click | Place the point of the current tool |
| Right click | Mark the impact of the selected target |
| Drag (any button) | Pan the map; dragging never places points |
| Mouse wheel, `+` / `−` | Zoom |
| `G` / `T` / `H` | Tool: my position / target / impact |
| `1`–`9` | Select a target |
| Click the selected pin, `Delete` | Remove the selected target |
| `Ctrl+Z` | Undo |
| `Z` / `F` / `R` | Fit the zone circle / the region's bases / show the whole map (also the **Zone**, **Bases**, **All** buttons) |

The keys in this table work while the overlay window has the keyboard: after a click into a text field, from the tray menu **Window with keyboard**, or when you use the overlay without the game. Over the game, use the buttons: the game keeps the keyboard.

Clicking a target pin selects it; clicking the selected pin again removes it (Ctrl+Z brings it back). After a removal the remaining targets are renumbered 1…n, so card N is always hotkey N and a new target gets the next number. Clicking your own pin removes it and arms the **Me** tool, so the next click places it again (Ctrl+Z brings it back). In the title bar, the mode pill switches marker mode, and the other buttons hide the window (Insert brings it back) or quit. The tray icon offers the same actions, plus **Window with keyboard** for typing and **Language**.

## How the correction works

- One map unit is 100 m. Axes run 0–163.84: X to the east, Y to the north.
- Azimuth is measured clockwise from north: 0° north (+Y), 90° east (+X).
- Range is the horizontal distance by Pythagoras.
- **Range correction:** coefficient = distance to target ÷ distance to impact; new range = range fired × coefficient.
- **Direction correction:** the angle between the impact and where you aimed is subtracted from the direction to the target.

The model assumes a constant angular error and proportional range from the same position. It does not know terrain height or the game's ballistics, so treat each correction as an estimate and confirm it with the next shot.

## Updates

The overlay checks [the latest release](https://github.com/KustovYuriiUA/balistic-calculator-wardogs/releases/latest) 8 seconds after start and then every 6 hours.

1. When a newer version appears, it downloads `app-<version>.zip` (code and maps, about 27 MB) in the background and verifies its size and SHA-256 against `update.json` from the same release.
2. The title bar shows **↻ Update to <version>**. Click it, or use the tray menu, to restart into the new version whenever it suits you. Without a restart the update is used on the next launch.
3. If the new version fails to start twice, the overlay falls back to the version in the unzipped folder.

Updates are unpacked into `%APPDATA%\basketball-overlay\updates`; the unzipped folder itself is never modified. A release built on a different Electron runtime shows **↗ Version <version>** instead, which opens the release page for a full download.

Tray menu: **Check for updates** checks now; **Update automatically** turns background checks on or off.

## Safety and privacy

- The overlay is a regular Electron window with always-on-top and a global Insert hotkey. It does not attach to, read or modify the game process.
- The game map layer captures only the screen area you selected, analyses frames in memory and never sends them. A frame is written to disk only when you pick **Game map snapshot for debugging**.
- The only network traffic is the update check and download, to `api.github.com` and GitHub's release file servers. Turn off **Update automatically** in the tray menu to stop it. The map page itself is blocked from any connection by its Content Security Policy, and the maps are bundled.
- Presets, the window position, the language and downloaded updates are stored locally in `%APPDATA%\basketball-overlay`.

## Support and bug reports

Found a bug or have an idea? Post it on the support Discord: <https://discord.gg/jnB44eyq9e>. The overlay opens it from **☰ → Report a bug…** and from the tray menu. Say which version you run (tray → version), what you did, what you expected and what happened, and add a screenshot. For problems with the game map layer, also attach a snapshot from **☰ → Game map snapshot for debugging**.

## Build from source

Requires Node.js 24 and pnpm 11. TypeScript and React; Vite builds the pages, esbuild the main process.

```bash
pnpm install
```

```bash
pnpm dev
```

```bash
pnpm typecheck
```

```bash
pnpm lint
```

```bash
pnpm test
```

```bash
pnpm package
```

`pnpm dev` builds and starts the app (`pnpm start` starts the last build). `pnpm build` writes the main process and preloads to `desktop/` and the pages to `dist/`; both are build output, not in git. `pnpm test` runs the unit tests in `tests/unit` (Vitest). `pnpm package` builds a portable folder in `release/`. `pnpm release` builds everything a GitHub release needs: `release/balistic-calculator-wardogs-win-x64.zip`, `release/app-<version>.zip` and `release/update.json`. `node scripts/portable.cjs --maps` builds a single portable EXE with electron-builder.

Checks with Electron (`tests/*-check.cjs`; run `pnpm build` first for the ones that start the app). `pnpm check:pages` builds and loads every page off screen: no errors, the overlay renders, the search worker starts. The UI checks drive the app through Playwright's Electron support: install `playwright`, or set `PLAYWRIGHT_PATH` to an existing copy, then run a check with `node tests/maps-check.cjs`. The game map layer's checks:

- `pnpm check:zone`: the circle search and zone recognition on a real screenshot;
- `pnpm check:terrain`: terrain matching (acquire, track, recover, zoom) on it and on frames rendered from the offline maps;
- `pnpm check:sweep`: recognition on two real snapshots of the game map (zoomed in and out) and on every zone of every map rendered at 1.2–12 m/px with green and red rims;
- `pnpm exec electron tests/layer-check.cjs`: the whole layer on your screen against a stand-in game window (100 % display scaling);
- `pnpm exec electron tests/soak-check.cjs`: the memory of every process over 2.5 minutes of rim tracking, terrain tracking and waiting (`SHOT_TEST_NO_GPU=1` repeats it without GPU acceleration).

The first three bundle the recognition code from `src/` (`scripts/build-test-core.mjs`) and run off screen; `layer-check` and `soak-check` put windows on the screen. After changing the maps or `src/data/landmarks.json`, rebuild the zone patches and the 1024² grey terrain images for the wide search (`src/data/generated/zone-patches.ts`, `public/maps/terrain-*.png`) with `pnpm zone-patches`.

Project layout (details in `CLAUDE.md`):

- `src/main`: the main process (`boot.ts` picks the downloaded update or the bundled app; windows, Insert hotkey, tray, settings); `src/preload`: one preload per window kind.
- `src/pages`: the three windows' HTML and entry code. The overlay window is a React app; the layer over the game map and the area picker are plain TypeScript.
- `src/features`: `fire-plan` (offline map, targets, presets, fire solution, manual calculator), `game-map` (layer, picker, circle and terrain recognition in `core/`, the wide search in a worker), `window` (title bar, menu, tabs), `updates` (the updater).
- `src/shared`: IPC contract, interface text in English, Russian and Ukrainian (`i18n`), geometry and formatting; `src/store`: window-wide state; `src/data`: bases and zones, generated zone patches.
- `public/maps`: the map images.

## Release flow

Branches: `dev` for work in progress, `master` for released code.

1. Work on `dev` and push. The **CI** workflow runs the type check, lint, unit tests and build on every push to `dev` and on pull requests.
2. When ready to ship, bump `"version"` in `package.json` on `dev` (for example `1.0.1`). The updater only offers versions greater than the installed one. Write the announcements for the support Discord in `.github/news.md` (Russian) and `.github/news.en.md` (English); the first line of each must name the new version, or a short default notice is posted instead.
3. Merge `dev` into `master` (pull request or fast-forward) and push.
4. The **Release** workflow builds on `windows-latest`: it installs dependencies, runs the type check, lint and tests, runs `pnpm release` and publishes the release `v<version>` with the three files, then posts the announcements to #новости and #news through the webhooks in the `DISCORD_NEWS_WEBHOOK` and `DISCORD_NEWS_WEBHOOK_EN` secrets (`node scripts/announce-release.cjs --dry-run` previews it). If a release with that version already exists, the workflow skips publishing, so pushes to `master` without a version bump are safe.
5. Installed overlays pick the release up within 6 hours, or immediately via **Check for updates** in the tray.

`pnpm build`, then `node tests/update-check.cjs` exercises the whole update path against a local fake of the GitHub API: download, checksum, staging, restart into the new version, rejected tampered files.

## Credits and license

- Map images and base/zone coordinates come from the public [Wardogs Zone artillery calculator](https://wardogs.zone/calculators/artillery); see [public/maps/SOURCES.md](public/maps/SOURCES.md). Game graphics belong to their owners.
- WARDOGS is developed by Bulkhead and published by Team17. This project is not affiliated with or endorsed by them.
- The code is released under the [MIT License](LICENSE). The license does not cover the map images and game data.
