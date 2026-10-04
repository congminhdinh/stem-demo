# Agent guide — STEM Studio PoC

- **Plan:** `docs/stem-demo-implementation-plan.md` is the current best strategy, not an immutable spec. Before a task, read §0, §5.1 (boundaries B1–B8), §15 (working agreement), the task in §9.2 and the contracts it references (§6).
- **Scope:** do only the task's scope. Do not build deferred items "for later". If evidence shows the plan is wrong, record the evidence and update the plan in the same change (§15).
- **Boundary B1:** `src/core/**` must not import `react`, `react-dom`, `react-konva`, `konva`, `blockly`, `zustand`, `dexie`, `monaco-editor`, `@monaco-editor/react`, `pyodide`, or anything under `src/ui` / `src/storage`. `pnpm lint` enforces it.
- **Commands:** run `pnpm verify` (typecheck + lint + unit tests) before finishing a task; run `pnpm e2e` for UI changes.
- **Versions:** read the installed package types before using an API (React 19, Vite 8, Vitest 4, ESLint 10, TypeScript 6). Vitest 5 and TypeScript 7 are intentionally not used (see plan §4).
- **Language:** UI strings, identifiers and comments in English; docs in Vietnamese with English technical terms.
