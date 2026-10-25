# bench:robot3d — 2026-10-25T20:48:28.922Z — before-school-2

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit f2ff258. Sensor overlays on (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 3.4–3.81 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 385.1 kB | ≤ 600 kB | ok | 1 | robot plan §5 |

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
| school · line-follow | 5.46 | 2.44 | 1.19 (0) | 0.25 | 0.01 | 0.43 | 0.07 | 0.97 | 138.3 | 91 | 3.4 |
| school · mini-mission | 5.79 | 2.31 | 1.2 (0) | 0.32 | 0.02 | 0.65 | 0.07 | 1.14 | 182.8 | 95 | 3.81 |

## The busiest sources (profile pass, self time in the window, ms; the first repeat)

- **school · line-follow** (8 s, 482 frames): (browser) 469; three/build/three.module.js 469; rapier.wasm 423; three/build/three.core.js 162; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 86; src/core/run/robot-run-session.ts 78; src/core/run/virtual-clock.ts 69; WebGL calls (through the bench probe) 66. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; three/build/three.module.js 5 MiB; src/core/world/units.ts 5 MiB; src/core/world/world.ts 4 MiB; src/core/world/arena/ground-paint.ts 4 MiB
- **school · mini-mission** (8 s, 477 frames): (browser) 542; three/build/three.module.js 469; rapier.wasm 416; three/build/three.core.js 159; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 74; src/ui/robot3d/camera-studio.ts 73; src/core/run/virtual-clock.ts 70; react-dom/cjs/react-dom-client.production.js 69. Allocates most: src/ui/robot3d/camera-studio.ts 13 MiB; src/core/world/arena/ground-paint.ts 7 MiB; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; three/build/three.module.js 5 MiB; src/ui/robot3d/parts/zone-tag-layout.ts 5 MiB

## Before the first frame (profile pass: navigation → the scene drawn, main thread self time by what ran, ms)

| profile · scenario | first frame | busy | three | blockly | react-dom | r3f | ui: robot3d | sim | webgl calls | browser | gc |
|---|---|---|---|---|---|---|---|---|---|---|---|
| school · line-follow | 3637 | 3284 | 1076 | 246 | 74 | 71 | 144 | 27 | 26 | 1370 | 18 |
| school · mini-mission | 1925 | 1765 | 712 | 171 | 75 | 72 | 155 | 30 | 19 | 265 | 23 |

- **school · line-follow**: (browser) 1370; three/build/three.module.js 886; blockly/blockly_compressed.js 238; three/build/three.core.js 129; react-dom/cjs/react-dom-client.production.js 74; @react-three/fiber/dist/events-9ce18a08.esm.js 71; (unknown) 65; react-use-measure/dist/index.js 47; three/examples/jsm/loaders/GLTFLoader.js 37; zod/v4/core/schemas.js 36
- **school · mini-mission**: three/build/three.module.js 537; (browser) 265; blockly/blockly_compressed.js 163; three/build/three.core.js 113; react-dom/cjs/react-dom-client.production.js 75; @react-three/fiber/dist/events-9ce18a08.esm.js 71; (unknown) 55; react-use-measure/dist/index.js 50; three/examples/jsm/loaders/GLTFLoader.js 44; zod/v4/core/schemas.js 39

## Bundle (gzip -6)

| file | bytes | gzip | holds |
|---|---|---|---|
| test-hooks-DEejnb95.js | 1447064 | 411816 | — |
| RobotLab-DcSqrZmE.js | 1348198 | 385121 | three, r3f, gltfLoader, meshopt |
| index-C8BH19me.js | 479886 | 144387 | — |
| rapier-DZ_EfFMH.js | 295823 | 52055 | rapier |
| rolldown-runtime-hePW80VL.js | 716 | 428 | — |
| rapier_wasm3d_bg-DZsYp9WG.wasm | 3105893 | 1180561 | |
| arena-props-low.glb | 194772 | 83286 | |
| arena-props.glb | 303372 | 150186 | |
| robot-kit-low.glb | 495220 | 196824 | |
| robot-kit.glb | 826656 | 369080 | |

Entry HTML loads: /favicon.svg, /assets/index-C8BH19me.js, /assets/rolldown-runtime-hePW80VL.js, /assets/test-hooks-DEejnb95.js, /assets/index-CgMmDkmz.css.

## Served headers (vite preview)

| path | Cache-Control | Content-Encoding | ETag |
|---|---|---|---|
| / | no-cache | none | yes |
| /assets/RobotLab-*.js | no-cache | gzip | yes |
| /robot3d/robot-kit.glb?v=1 | no-cache | none | yes |
| /assets/rapier_wasm3d_bg-*.wasm | no-cache | none | yes |
