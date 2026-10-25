# bench:robot3d — 2026-10-25T21:37:33.387Z — before-school-2

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 9e8b1a6. Sensor overlays on (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 4.69 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 386 kB | ≤ 600 kB | ok | 1 | robot plan §5 |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

## Where the main thread goes (profile pass, ms per animation frame, ranges over the repeats)

| profile · scenario | busy | sim | render (shadow map) | React | Blockly | scene callbacks | GC | browser (style, layout, paint, GL) | alloc/frame KB | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|
| school · line-follow | 6.52 | 3 | 1.37 (0) | 0.27 | 0 | 0.48 | 0.07 | 1.18 | 130.9 | 96 | 4.69 |

## The busiest sources (profile pass, self time in the window, ms; the first repeat)

- **school · line-follow** (8 s, 481 frames): (browser) 569; three/build/three.module.js 548; rapier.wasm 529; three/build/three.core.js 181; src/core/run/virtual-clock.ts 109; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 92; src/core/run/robot-run-session.ts 91; WebGL calls (through the bench probe) 79. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; three/build/three.module.js 5 MiB; src/core/world/units.ts 4 MiB; src/core/world/world.ts 4 MiB; src/core/world/arena/ground-paint.ts 4 MiB

## Before the first frame (profile pass: navigation → the scene drawn, main thread self time by what ran, ms)

| profile · scenario | first frame | busy | three | blockly | react-dom | r3f | ui: robot3d | sim | webgl calls | browser | gc |
|---|---|---|---|---|---|---|---|---|---|---|---|
| school · line-follow | 3934 | 3598 | 1097 | 282 | 85 | 66 | 137 | 31 | 35 | 1551 | 25 |

- **school · line-follow**: (browser) 1551; three/build/three.module.js 899; blockly/blockly_compressed.js 274; three/build/three.core.js 135; react-dom/cjs/react-dom-client.production.js 85; (unknown) 72; react-use-measure/dist/index.js 63; @react-three/fiber/dist/events-9ce18a08.esm.js 63; zod/v4/core/schemas.js 45; three/examples/jsm/loaders/GLTFLoader.js 42

## Bundle (gzip -6)

| file | bytes | gzip | holds |
|---|---|---|---|
| test-hooks-DEejnb95.js | 1447064 | 411816 | — |
| RobotLab-CJOdoDNe.js | 1350538 | 386027 | three, r3f, gltfLoader, meshopt |
| index-BTVphlDh.js | 479886 | 144388 | — |
| rapier-DZ_EfFMH.js | 295823 | 52055 | rapier |
| rolldown-runtime-hePW80VL.js | 716 | 428 | — |
| rapier_wasm3d_bg-DZsYp9WG.wasm | 3105893 | 1180561 | |
| arena-props-low.glb | 194772 | 83286 | |
| arena-props.glb | 303372 | 150186 | |
| robot-kit-low.glb | 495220 | 196824 | |
| robot-kit.glb | 826656 | 369080 | |

Entry HTML loads: /favicon.svg, /assets/index-BTVphlDh.js, /assets/rolldown-runtime-hePW80VL.js, /assets/test-hooks-DEejnb95.js, /assets/index-CgMmDkmz.css.

## Served headers (vite preview)

| path | Cache-Control | Content-Encoding | ETag |
|---|---|---|---|
| / | no-cache | none | yes |
| /assets/RobotLab-*.js | no-cache | gzip | yes |
| /robot3d/robot-kit.glb?v=1 | no-cache | none | yes |
| /assets/rapier_wasm3d_bg-*.wasm | no-cache | none | yes |
