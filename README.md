# STEM Studio — PoC

Proof of Concept for a browser-only STEM programming/simulation editor: 2D circuit editor, Blockly programming, a runtime and simulated devices.

The implementation plan (current best strategy, in Vietnamese) is [`docs/stem-demo-implementation-plan.md`](docs/stem-demo-implementation-plan.md).

## Requirements

- Node.js ≥ 20.19 (dev machine: 20.20.2)
- pnpm via Corepack. The exact version is pinned in the `packageManager` field of `package.json`.

## Setup

```sh
corepack enable pnpm
pnpm install
pnpm exec playwright install chromium
```

On Windows, `corepack enable` can fail with `EPERM` when Corepack lives under `C:\Program Files\nodejs`. In that case, install the shims into a writable directory on `PATH`, for example the active Node directory:

```sh
corepack enable pnpm --install-directory "<writable dir on PATH>"
```

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Vite dev server on http://localhost:5173 |
| `pnpm build` | Production build into `dist/` |
| `pnpm preview` | Serves `dist/` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint, including the core boundary rule (B1) |
| `pnpm test` | Vitest unit tests (Node) |
| `pnpm e2e` | Playwright smoke tests on Chromium; starts the dev server, and a lesson page on port 5190 for the iframe tests |
| `pnpm verify` | Fast quality gate: typecheck + lint + unit tests. E2E is run separately with `pnpm e2e` |

## Launch modes

| URL | Mode |
|---|---|
| `/` | Standalone editor: restores the last project from IndexedDB (Blink when there is none) |
| `/?embed=1&template=<key>` | Embedded lab: opens the bundled template `<key>` (`blink`, `led-on`, `button-direct`, `button-led`, `empty`); never reads or overwrites the standalone last project |

Any other use of `embed`/`template` shows an explicit error instead of a project. Details: [`docs/stem-demo-local-development.md`](docs/stem-demo-local-development.md#hai-mode-standalone-và-lab-nhúng-s1).

## Architecture rule

`src/core/**` is plain TypeScript. It must not import React, Konva, Blockly, Zustand, Dexie, Monaco, Pyodide, or the `ui`/`storage` layers. `pnpm lint` enforces this; `tests/core-boundary.test.ts` checks the rule itself. See plan §5.1 for all boundaries.

## Layout

```text
src/main.tsx        app entry
src/ui/app/         app shell
tests/              repo-level unit tests (e.g. lint boundary)
e2e/                Playwright specs
```

Other folders (`src/core`, `src/samples`…) are created by the tasks that need them.
