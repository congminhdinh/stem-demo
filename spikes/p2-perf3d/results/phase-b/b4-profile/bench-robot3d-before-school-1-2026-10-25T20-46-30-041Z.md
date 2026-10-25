# bench:robot3d — 2026-10-25T20:46:30.041Z — before-school-1

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit f2ff258. Sensor overlays on (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 6.09–6.61 at the cells' start.

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
| school · line-follow | 5.91 | 2.59 | 1.26 (0) | 0.39 | 0.01 | 0.45 | 0.06 | 1.07 | 141 | 92 | 6.09 |
| school · mini-mission | 5.78 | 2.33 | 1.16 (0) | 0.35 | 0.01 | 0.64 | 0.07 | 1.1 | 181.5 | 96 | 6.61 |

## The busiest sources (profile pass, self time in the window, ms; the first repeat)

- **school · line-follow** (8 s, 482 frames): (browser) 516; three/build/three.module.js 507; rapier.wasm 430; three/build/three.core.js 155; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 107; src/core/run/virtual-clock.ts 99; react-dom/cjs/react-dom-client.production.js 96; src/core/run/robot-run-session.ts 87. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; three/build/three.module.js 5 MiB; src/core/world/units.ts 4 MiB; src/core/world/world.ts 4 MiB; src/core/world/arena/ground-paint.ts 4 MiB
- **school · mini-mission** (8 s, 477 frames): (browser) 525; three/build/three.module.js 459; rapier.wasm 440; three/build/three.core.js 165; react-dom/cjs/react-dom-client.production.js 89; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 80; src/ui/robot3d/camera-studio.ts 69; src/core/run/robot-run-session.ts 58. Allocates most: src/ui/robot3d/camera-studio.ts 13 MiB; src/core/world/arena/ground-paint.ts 8 MiB; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; three/build/three.module.js 5 MiB; src/ui/robot3d/parts/zone-tag-layout.ts 5 MiB

## Before the first frame (profile pass: navigation → the scene drawn, main thread self time by what ran, ms)

| profile · scenario | first frame | busy | three | blockly | react-dom | r3f | ui: robot3d | sim | webgl calls | browser | gc |
|---|---|---|---|---|---|---|---|---|---|---|---|
| school · line-follow | 3681 | 3363 | 1094 | 259 | 81 | 70 | 139 | 26 | 22 | 1409 | 21 |
| school · mini-mission | 1943 | 1787 | 717 | 169 | 73 | 70 | 157 | 25 | 21 | 277 | 13 |

- **school · line-follow**: (browser) 1409; three/build/three.module.js 907; blockly/blockly_compressed.js 251; three/build/three.core.js 116; react-dom/cjs/react-dom-client.production.js 81; @react-three/fiber/dist/events-9ce18a08.esm.js 65; (unknown) 64; react-use-measure/dist/index.js 51; three/examples/jsm/loaders/GLTFLoader.js 46; zod/v4/core/schemas.js 40
- **school · mini-mission**: three/build/three.module.js 541; (browser) 277; blockly/blockly_compressed.js 162; three/build/three.core.js 114; react-dom/cjs/react-dom-client.production.js 73; @react-three/fiber/dist/events-9ce18a08.esm.js 65; (unknown) 59; react-use-measure/dist/index.js 50; zod/v4/core/schemas.js 43; three/examples/jsm/loaders/GLTFLoader.js 43

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
