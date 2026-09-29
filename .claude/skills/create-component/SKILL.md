---
name: create-component
description: Create a React component the Spok way — decide composable vs simple with the user first, scaffold the per-component folder schema (components/, hooks/, utils/, *.styles.tsx, *.context.tsx, *.types.ts, index.ts), and type any size prop on the canonical SDK Size scale. Use whenever creating, scaffolding, or designing a new UI component, splitting a large component into sub-components/styles/hooks, adding or changing a size prop, translating a Figma component's sizes into code, or when asked about component structure or conventions. Triggers on "create a component", "new component", "build/make/add a component", "scaffold component", "component folder", "component structure", "size prop", "size variant". Explicit invocation - /create-component <ComponentName or description>.
---

# Create a component

Three decisions happen at component-creation time, in this order: the
API shape (composable vs simple), the folder anatomy, and the prop
vocabulary (sizes). *Where* the component lives is the `app-structure`
skill's job; this skill owns what goes inside it.

## 0. The composability gate — decide the API shape first

Whether a component is **composable** (a compound: `Root` + sub-parts
sharing context) or **simple** (one component driven by props) is
expensive to change later — consumers couple to whichever surface ships.
Decide it with the user **before writing any component code**.

1. **Check if the user already decided.** "Composable" / "compound" /
   "with subcomponents" → composable; "simple" / "just props" / "one
   component" → simple. Don't re-ask what was already answered.
2. **Otherwise ask exactly one question via `AskUserQuestion`** (never a
   prose question): "Should `<Name>` be composable or simple?" with
   options, pre-selecting the heuristic's pick as `(Recommended)`:
   - **Composable + assembled default** — compound parts plus a smart
     `<Name>` that composes them (mirrors `Select`, `BottomSheet`,
     `Input`). Best for rich slots, open-ended layout, broad reuse.
   - **Composable only** — parts without an assembled default; for
     genuinely bespoke call sites.
   - **Simple (prop-based)** — one component, fewest files; for leaf
     components with a fixed shape (`Badge`, a dot/pill).
3. Proceed per the answer. Composable → follow
   `vercel-composition-patterns` (compound components, context
   interface, no boolean-prop proliferation) and mirror the repo's
   existing compounds.

**Heuristic** — lean composable when 2+ hold: distinct slots
(leading/trailing icon, label, hint, header/footer); 3+ visual states
consumers may arrange differently; reuse across varied layouts or
custom children; a prop-only API would need many booleans (`hasIcon`,
`showLabel`, …). Otherwise lean simple.

Ask **once per component**, not per file, and only for **new**
components (or an explicit composability refactor) — never block edits
to existing ones.

**House compound pattern** (when composable): `Name.context.tsx` with a
`useName()` hook that throws outside `Name.Root`; each part under
`components/<Part>/` following the schema below; the namespace assembled
as `export const Name = Object.assign(NameAssembled, { Root, Field, … })`;
barrel exports the component, hook, parts, and types.

## 1. Folder schema

Every component is a self-contained folder. This full schema is the
**mobile** canon (`.styles.tsx`/`.types.ts` are mobile-only suffixes);
web components use the same shape minus those files, per the team
structure rules.

```
ComponentName/
  components/                 # child components — ONLY if there are sub-components
    ChildComponent/           #   recursive: a child follows this same schema
      ChildComponent.tsx
      ChildComponent.styles.tsx   # only if the child has styles
      index.ts
    index.ts                  # re-exports the children
  hooks/                      # local hooks — ONLY if non-trivial ones exist
  utils/                      # pure helpers / non-style constant maps — ONLY if present
  store/                      # zustand local store — ONLY if present (rare; see create-store)
  ComponentName.context.tsx   # context + hook — ONLY if the component provides context
  ComponentName.types.ts      # exported type unions — ONLY if there are several
  ComponentName.styles.tsx    # styleVariants/StyleSheet + style-only maps — ONLY if styled
  ComponentName.tsx           # the component + its Props interface
  index.ts                    # public barrel
```

**Golden rule — optional parts exist only when needed.** Never scaffold
empty folders or stub files: no styles → no `.styles.tsx` (`Stack` is
just `Component.tsx` + `index.ts`), no context → no `.context.tsx`, no
sub-components → no `components/`. The team has deleted empty
`utils/`/`constants` stubs before — don't reintroduce them.

| File | Holds |
|---|---|
| `ComponentName.tsx` | The component, its `Props` interface, render logic. Re-exports the type unions from `.types.ts` so the barrel pulls everything from one place. |
| `ComponentName.styles.tsx` | `styleVariants()`/`StyleSheet.create` blocks plus **style-only** constant maps (size maps, color maps) — see `styles-native`. |
| `ComponentName.types.ts` | Exported type **unions** (`Size`, `Variant`, …). The `Props` interface stays in the `.tsx`. |
| `ComponentName.context.tsx` | `createContext` + a `useX()` hook that throws outside the provider. |
| `utils/` | Pure functions and non-style constants (layout math, value resolvers). |
| `index.ts` | Public barrel — explicit named exports; `export * from './components'` only for **publicly composable** parts. |

Internal sub-components stay out of the top-level `src/components/ui`
barrel — only compound public parts (like `Select`'s) surface there.

Worked example (Avatar, with all files spelled out):
[references/avatar-example.md](references/avatar-example.md).

## 2. Size props — one canonical t-shirt scale

Every size-bearing component exposes the **same** vocabulary, sourced
from the SDK — never `size="M"`, `size="medium"`, or a per-component
invention:

```ts
// spok-react-sdk/src/theme/sizes.ts — single source of truth
export type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl'
```

- A component's size type is `Size` or a subset **derived with
  `Extract`** — never a fresh hand-written union:

  ```ts
  import { type Size } from 'spok-react-sdk/theme'

  export type ButtonSize = Extract<Size, 'sm' | 'md' | 'lg'>
  ```

- **`md` is the default for new components** (`defaultProps: { size: 'md' }`).
  Don't rewrite an existing component's established default to chase
  this.
- **Translate Figma's size names, never copy them.** Figma is
  inconsistent (`S`/`M` on one component, `small`/`large` on the next):
  anchor Figma's *default* to `md` and spread outward — `S`/`M` →
  `sm`/`md`; `small`/`medium`/`large` → `sm`/`md`/`lg`;
  `extra-large` → `xl` or `2xl`. A brand-new Figma size maps to the
  nearest existing rung.
- The scale is a **semantic rung, not a pixel value** — Avatar `md` is
  40px, Input `md` is a 40px field height, Button `md` is a padding
  ramp. The component's `styleVariants`/size maps own the numbers; the
  scale owns only the vocabulary and ordering.

## 3. Conventions that apply here (owned by other canon)

- Styling — `styleVariants`, theme-aware factories, tokens, layout
  primitives: `styles-native` (mobile) / `styles-web` (web).
- Barrels, import grouping, `type` specifiers: `imports-exports`.
- Object literals are always multiline; no semicolons, single quotes:
  the injected code-style rules.
- Comments: `code-comments` — no restating names or structure.
- Mobile lint specifics: components with **3+ props** take
  `(props: Props)` and destructure in the **body**, not the signature
  (`local/component-props-destructure`).

## Checklist before done

1. Composability decided with the user (or already stated) **before**
   code was written.
2. Optional parts created only when needed — no empty folders or stubs.
3. Styles in `*.styles.tsx`, type unions in `*.types.ts` (re-exported by
   the `.tsx`), `Props` in the `.tsx`.
4. Size prop (if any) is `Size`/`Extract<Size, …>` from
   `spok-react-sdk/theme`, defaulting to `md`.
5. `index.ts` exports the component + types (named only); parent
   aggregator barrel updated.
6. `npx tsc --noEmit` and `npx eslint <dir> --fix` clean.
