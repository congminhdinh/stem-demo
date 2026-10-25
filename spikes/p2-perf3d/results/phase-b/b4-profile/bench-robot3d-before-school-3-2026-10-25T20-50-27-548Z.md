# bench:robot3d — 2026-10-25T20:50:27.548Z — before-school-3

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit f2ff258. Sensor overlays on (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 3.02–3.62 at the cells' start.

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
| school · line-follow | 7.51 | 3.39 | 1.51 (0) | 0.41 | 0.01 | 0.63 | 0.07 | 1.37 | 144 | 98 | 3.62 |
| school · mini-mission | 6.37 | 2.68 | 1.25 (0) | 0.34 | 0.01 | 0.68 | 0.08 | 1.21 | 181.4 | 95 | 3.02 |

## The busiest sources (profile pass, self time in the window, ms; the first repeat)

- **school · line-follow** (8 s, 473 frames): (browser) 647; three/build/three.module.js 595; rapier.wasm 584; three/build/three.core.js 204; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 125; src/core/run/robot-run-session.ts 117; src/core/run/virtual-clock.ts 114; react-dom/cjs/react-dom-client.production.js 88. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; three/build/three.module.js 5 MiB; src/core/world/world.ts 4 MiB; src/core/world/units.ts 4 MiB; src/core/world/sensors/contacts.ts 4 MiB
- **school · mini-mission** (8 s, 477 frames): (browser) 578; rapier.wasm 498; three/build/three.module.js 496; three/build/three.core.js 158; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 106; src/core/run/robot-run-session.ts 93; react-dom/cjs/react-dom-client.production.js 78; src/core/run/virtual-clock.ts 73. Allocates most: src/ui/robot3d/camera-studio.ts 12 MiB; src/core/world/arena/ground-paint.ts 7 MiB; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; three/build/three.module.js 5 MiB; src/ui/robot3d/parts/zone-tag-layout.ts 5 MiB

## Before the first frame (profile pass: navigation → the scene drawn, main thread self time by what ran, ms)

| profile · scenario | first frame | busy | three | blockly | react-dom | r3f | ui: robot3d | sim | webgl calls | browser | gc |
|---|---|---|---|---|---|---|---|---|---|---|---|
| school · line-follow | 3683 | 3313 | 1084 | 245 | 84 | 59 | 135 | 28 | 25 | 1381 | 29 |
| school · mini-mission | 1926 | 1767 | 727 | 163 | 74 | 65 | 157 | 24 | 26 | 254 | 22 |

- **school · line-follow**: (browser) 1381; three/build/three.module.js 902; blockly/blockly_compressed.js 238; three/build/three.core.js 125; react-dom/cjs/react-dom-client.production.js 84; @react-three/fiber/dist/events-9ce18a08.esm.js 59; (unknown) 53; react-use-measure/dist/index.js 46; zod/v4/core/schemas.js 40; three/examples/jsm/loaders/GLTFLoader.js 35
- **school · mini-mission**: three/build/three.module.js 537; (browser) 254; blockly/blockly_compressed.js 155; three/build/three.core.js 125; react-dom/cjs/react-dom-client.production.js 74; @react-three/fiber/dist/events-9ce18a08.esm.js 63; (unknown) 57; react-use-measure/dist/index.js 46; three/examples/jsm/loaders/GLTFLoader.js 42; zod/v4/core/schemas.js 30

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
