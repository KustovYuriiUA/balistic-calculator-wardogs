---
name: app-structure
description: Feature-based application structure canon — scaffold new feature modules and pages, decide where any new file belongs, and audit an existing app against the canon. Use whenever the user creates a new page, screen, feature, or module; adds a modal, drawer, sheet, popover, component, hook, util, or store and its location matters; asks "where should this file live"; mentions folder structure, project layout, or restructuring; or asks to audit/check/enforce structure. Explicit invocation - /app-structure <new <feature> | page <feature>/<Page> | audit [scope]>.
---

# Feature-based app structure

Universal canon for feature-module structure in React and React Native
apps. The skill is project-agnostic: the canon below is the default for
any project, and project specifics (roots, entry naming, shared-code
policy) resolve in step 0.

Two modes:

- **Scaffold** — create a new feature or page, or place a new file.
- **Audit** — check an existing app against the canon and report.

## 0. Resolve project conventions first

Before asking anything, look in the injected team rules and CLAUDE.md
for:

- **Features root** (default `src/features`).
- **Entry folder name** — `pages/` on web, `screens/` on React Native.
  If unstated, infer from the platform; never mix both in one app.
- **Shared-code policy** — where platform-agnostic shared logic
  (stores/hooks/utils) lives: inside the app, or in a shared package
  consumed by several apps (its root and import alias).

Found → use silently. Only the shared-code policy is worth a question
when missing — ask ONE, via AskUserQuestion:

> *"Does shared logic (stores/hooks/utils) live inside this app, or in
> a shared package used by more than one app? If a package — what is
> its root and import alias?"*

Use the answer for this session. Do not write config files or CLAUDE.md
sections into the repo — a team-rules mechanism is the only durable home
for this answer; without one, asking again next time is cheaper than a
config convention nobody else maintains.

## 1. The canon

### Feature = domain, not page

A feature directory is a domain module (`chat`, `on-call`, `admin`),
kebab-case, holding *all* pages of that domain. Do not create one
feature per page — five related pages belong in one feature's entry
folder, not in five sibling features.

### Whitelist skeleton

```
<featuresRoot>/<feature>/
├─ index.ts          # barrel — the feature's ONLY public entry
├─ pages|screens/    # route entries; mandatory once the feature has any
├─ components/       # components local to this feature
├─ modals/  drawers/  sheets/  popovers/
├─ hooks/  utils/  stores/  constants/  types/
└─ mocks/
```

- `index.ts` is mandatory. The entry folder is mandatory for any
  feature that owns a route.
- Everything else is optional and appears **only when it has content**.
  Never scaffold empty folders or `.keep` files — an empty folder is
  noise today and a violation in the next audit.
- A folder name outside this whitelist inside a feature is a violation.
  New categories are added to the whitelist deliberately (team rules),
  not invented per feature.
- Entry naming and file suffixes follow the platform idiom: the schema
  is shared across web and native, the names are not. Don't rename
  `screens/` to `pages/` in a React Native app "for consistency" —
  cross-platform consistency lives at the schema level.

### Locality — the placement rule

Everything used by exactly one feature lives **inside** that feature:
its modals, drawers, components, hooks, utils, constants. The moment a
second feature needs it, promote it — to the app's global roots
(`src/components`, `src/hooks`, ...) or to the shared package when the
project's shared-code policy says so. Consequences:

- **Cross-feature imports are forbidden.** `features/a` importing from
  `features/b` means the shared thing is mislocated — promote it.
- The reverse also holds: a component in the global root used by
  exactly one feature belongs inside that feature.
- When the shared-code policy is a **shared package**, the app-local
  `stores/`, `hooks/`, `utils/` folders are the exception, not the
  rule: only platform-bound logic (DOM APIs, `react-native`,
  platform-specific SDK bindings) may stay in the app. Anything
  platform-agnostic goes to the package, mirrored under the same
  feature hierarchy — even ephemeral UI state. "It's small" or "only
  web uses it today" are not reasons to keep it local; divergent forks
  start exactly there.

### Component folders

```
components/<ComponentName>/
├─ <ComponentName>.tsx
├─ index.ts                # explicit re-export
└─ components/             # children used only by this component
```

Nested `components/` recurses: a child used only by one component stays
under that component. Barrels and import syntax follow the team's
imports-exports canon. The component's *internal* anatomy — optional
`.styles.tsx`/`.types.ts`/`.context.tsx` files, `hooks/`/`utils/`
subfolders, the composable-vs-simple decision — is the create-component
skill's job; this skill only decides where the folder lives.

Imports *inside* a feature follow the same rules as everywhere else —
placement never excuses path climbing. A sibling (`./`) or one level up
(`../`) is fine; the moment a path needs two or more `../` (e.g. a page
reaching `../../modals/...`), use the project alias
(`@/features/<feature>/modals/...`) instead. Deep relatives break on
every folder move — exactly the moves this skill's audit prescribes.

### Public surface and routing

The feature's barrel is its only public entry. Route tables and
navigators import pages from `@/features/<feature>` — never past the
barrel into feature internals. What the barrel does not export does not
exist outside the feature.

## 2. Scaffold mode

`/app-structure new <feature>` — creating a feature:

1. Resolve conventions (step 0). Confirm the first page/screen name if
   not given.
2. Create `<featuresRoot>/<feature>/` with the entry folder, the first
   page component folder, and barrels (`index.ts` at feature root and
   in the entry folder).
3. Register the route: find the project's route table or navigator
   (e.g. `app/routes/routes.ts`, `routes/RootNavigator.tsx`) and wire
   the page in, importing from the feature barrel.

`/app-structure page <feature>/<Page>` — adding a page to an existing
feature: add the page folder under the entry folder, export through the
barrels, register the route.

When creating any other file mid-task, place it by this table:

| Creating | Used by | Location |
|---|---|---|
| page / screen | — | `<feature>/pages\|screens/<Name>/` |
| component | one feature | `<feature>/components/<Name>/` |
| component | one component | `<parent>/components/<Name>/` |
| component | 2+ features | global components root |
| modal / drawer / sheet / popover | one feature | `<feature>/modals\|drawers\|sheets\|popovers/` |
| hook / util / store, platform-bound | one feature | `<feature>/hooks\|utils\|stores/` |
| hook / util / store, platform-agnostic | any | shared package per policy; app folders only if policy is "in-app" |
| constants / types | one feature | `<feature>/constants\|types/` |

## 3. Audit mode

`/app-structure audit [scope]` — scope defaults to the whole features
root; a feature name narrows it.

Run these checks:

1. **Non-whitelist folders** inside features.
2. **Empty folders** and `.keep` placeholders.
3. **Barrel integrity** — features without `index.ts`; consumers
   (routes, other code) importing past a feature barrel into its
   internals.
4. **Cross-feature imports** — `features/a` → `features/b`.
5. **Mislocated locality, both directions** — global code used by
   exactly one feature; feature-local code imported by 2+ features.
6. **Duplicates and forks** — same or near-same file names/logic across
   features, between app-global and feature dirs, or between the app
   and the shared package (byte-identical copies and diverged forks
   both count; forks are worse — name which side is canonical).
7. **Shared-package candidates** (only when the policy is a shared
   package) — every store/hook/util in the app whose imports are all
   platform-agnostic. Platform-bound files are legal residents; say so
   instead of flagging them.

Report, then stop. Fixes — file moves, promotions, extractions to the
shared package — happen only on an explicit request, and moves that
touch more than one repository are always a separate task, never a
side effect of an audit.

### Report format

```markdown
## Structure audit — <scope>

### Violations
| # | Check | Location | Problem | Target |
|---|-------|----------|---------|--------|

### Shared-package candidates
| File | Why it qualifies | Target location |

### Legal exceptions
<platform-bound files that look shareable but aren't — one line each>
```

Every row names a concrete target location — a report line without a
destination is a complaint, not a finding.
