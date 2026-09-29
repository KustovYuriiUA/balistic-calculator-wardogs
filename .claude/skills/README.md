# Project skills

- `electron-best-practices`: written for this project, from the official Electron security and
  performance checklists plus the Windows facts measured here.
- The rest are copies from the Artkai Spok team plugin (`spok-ai-setup/plugins/spok/skills`, plugin
  version 0.11.0, copied 2026-09-29): `app-structure`, `imports-exports`, `code-comments`,
  `create-component`, `create-store`, `reactuse`, `vercel-react-best-practices`,
  `vercel-composition-patterns`.
  - They are project-agnostic. Their step 0 resolves against `/CLAUDE.md`.
  - The plugin itself is not enabled here: at session start it injects Spok-only rules
    (`spok-react-sdk`, `cc-web-new`) that do not apply to this app.
  - To pick up a newer plugin version, copy the folders again.
- Not copied, because they do not apply:
  - `styles-web`: MUI, which this app does not use;
  - `tanstack-*`: there is no server;
  - `styles-native`, `vercel-react-native-skills`: React Native;
  - `new-branch`: it relies on the plugin's git-guard hook;
  - `add-skill`.
