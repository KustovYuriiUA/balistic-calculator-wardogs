---
name: code-comments
description: The team's policy for code comments — when a comment earns its place and when it must not be written. Use whenever writing new code, adding comments or JSDoc, reviewing a diff, refactoring, or cleaning up AI-generated code — even if the user doesn't mention comments explicitly.
---

# Code Comments Policy

## Core principle

A comment must say something the code cannot. Folder structure, file names, function names,
parameter names, and types already carry the "what" — a comment that restates any of them is
noise that rots the moment the code around it changes. Write a comment only for the
non-obvious: WHY a decision was made, an external constraint (spec quirk, backend
inconsistency, upstream bug), a behavior contract invisible in the signature, or a deliberate
deviation from a team rule.

## The litmus test

Before keeping a comment, delete it and reread the surrounding code. If a competent developer
loses nothing they can't recover in ten seconds from the names and types around it, the
comment stays deleted. Apply this test to every comment you write, not just ones you're
reviewing — it's cheaper to not write it than to write it and delete it later.

## Never write these

- **File-header comments that restate the path.**
  ❌ `// Person titles branch: paged list + infinite variant.` at the top of `queries/titles.ts`
- **JSDoc that restates the symbol name.**
  ❌ `/** Paginated list of titles. */` above `titlesQueries.list`
  ❌ `/** Fetches a user by id. */` above `fetchUserById`
- **Narration of the next line or of structure.**
  ❌ `// imports`
  ❌ `// return the result`
- **Notes addressed to the reviewer about why a change is correct.** These belong in the PR
  description or commit message, not the code — they have no reader once the PR merges.
- **Decorative separators / section banners.** A blank line and a good name do the same job
  without rotting into a lie when the section changes shape.

## Worth writing

- **External quirks:**
  ✅ `// Spec quirk: this endpoint's params are PascalCase — backend normalization pending.`
- **Why a deliberate rule-deviation exists:**
  ✅ `// TError is pinned explicitly: the transport's throw type is a contract inference cannot see.`
- **Non-obvious defaults or behavior contracts in public-API JSDoc:**
  ✅ `/** Disabled while \`id\` is empty; a caller-provided \`enabled\` is ANDed with that guard. */`
- **Workarounds, with their reason** (and a link/ticket when one exists).
- **Safety or ordering constraints the code cannot express** — e.g. why one call must happen
  before another, or why a cleanup step exists.

## JSDoc on public API

JSDoc is allowed only for behavior that isn't derivable from the signature: applied defaults,
gating semantics, side effects, pagination ownership, or anything a caller would otherwise
have to read the implementation to discover. When you draft JSDoc, strip the restating first
sentence — the one that just renames the function in prose — and keep only the behavior
sentence. If nothing survives that cut, the JSDoc block doesn't belong there.

## AI-generated code

Generated code tends to over-comment: a comment above nearly every line, JSDoc that repeats
the function name, section banners around every block. When you touch or review
AI-generated code, deleting the restating comments is part of the task, not optional polish —
apply the litmus test line by line before judging the diff "done."
