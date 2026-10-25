# bench:robot3d — 2026-10-25T17:25:49.105Z — master-profile-gpu

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 518f6a2. Sensor overlays on (where the build has them). Repeats 3, window 8 s, soak 10 min, switches 20. 1-minute load average from 10.41–15.39 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 378.5 kB | ≤ 600 kB | ok | 1 | robot plan §5 |

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
| gpu-high · line-follow | 1.57–1.59 | 0.59–0.61 | 0.53–0.56 (0.13) | 0.04–0.05 | 0 | 0.1–0.11 | 0.01 | 0.22–0.23 | 160.2–161.4 | 16–18 | 12.17–15.39 |
| gpu-high · check-4x | 2.27–2.29 | 1.01–1.03 | 0.17–0.18 (0.05) | 0.13 | 0 | 0.48–0.49 | 0.04–0.05 | 0.38–0.39 | 787.8–789.1 | 17–19 | 10.41–12.86 |

## The busiest sources (profile pass, self time in the window, ms; the first repeat)

- **gpu-high · line-follow** (8 s, 480 frames): three/build/three.module.js 234; (browser) 110; rapier.wasm 105; three/build/three.core.js 40; src/core/run/virtual-clock.ts 27; WebGL calls (through the bench probe) 23; src/core/run/robot-run-session.ts 19; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 16. Allocates most: three/build/three.module.js 15 MiB; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; src/core/world/units.ts 4 MiB; src/core/world/world.ts 4 MiB; src/core/world/arena/ground-paint.ts 4 MiB
- **gpu-high · check-4x** (34.5 s, 2050 frames): src/ui/robot3d/camera-studio.ts 883; rapier.wasm 828; (browser) 783; three/build/three.module.js 301; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 264; react-dom/cjs/react-dom-client.production.js 139; src/core/run/virtual-clock.ts 115; src/core/run/robot-run-session.ts 100. Allocates most: src/ui/robot3d/camera-studio.ts 867 MiB; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 80 MiB; src/core/world/world.ts 63 MiB; src/core/world/sensors/contacts.ts 52 MiB; src/core/world/robot/assembly.ts 51 MiB

## Before the first frame (profile pass: navigation → the scene drawn, main thread self time by what ran, ms)

| profile · scenario | first frame | busy | three | blockly | react-dom | r3f | ui: robot3d | sim | webgl calls | browser | gc |
|---|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high · line-follow | 878–1084 | 267–414 | 90–113 | 30–136 | 10–13 | 7–10 | 28–35 | 4–7 | 6–7 | 36–45 | 7–11 |
| gpu-high · check-4x | 882–889 | 281–291 | 90–96 | 28–29 | 11–15 | 7–9 | 41–44 | 4–7 | 6–7 | 35–38 | 8–10 |

- **gpu-high · line-follow**: blockly/blockly_compressed.js 135; three/build/three.module.js 69; (browser) 41; three/build/three.core.js 28; three/examples/jsm/loaders/GLTFLoader.js 12; (gc) 11; src/ui/robot3d/camera-studio.ts 11; (unknown) 10; react-dom/cjs/react-dom-client.production.js 10; react-use-measure/dist/index.js 10
- **gpu-high · check-4x**: three/build/three.module.js 59; (browser) 35; blockly/blockly_compressed.js 28; three/build/three.core.js 25; src/ui/robot3d/camera-studio.ts 19; react-dom/cjs/react-dom-client.production.js 13; (unknown) 11; react-use-measure/dist/index.js 11; @react-three/fiber/dist/events-9ce18a08.esm.js 9; (gc) 9

## Bundle (gzip -6)

| file | bytes | gzip | holds |
|---|---|---|---|
| test-hooks-P0rzqaOg.js | 1439400 | 409669 | — |
| RobotLab-9aaBbRob.js | 1329557 | 378495 | three, r3f, gltfLoader, meshopt |
| index-CnB3OsAZ.js | 483855 | 145816 | — |
| rapier-DZ_EfFMH.js | 295823 | 52055 | rapier |
| rolldown-runtime-hePW80VL.js | 716 | 428 | — |
| rapier_wasm3d_bg-DZsYp9WG.wasm | 3105893 | 1180561 | |
| arena-props-low.glb | 194772 | 83286 | |
| arena-props.glb | 303372 | 150186 | |
| robot-kit-low.glb | 495220 | 196824 | |
| robot-kit.glb | 826656 | 369080 | |

Entry HTML loads: /favicon.svg, /assets/index-CnB3OsAZ.js, /assets/rolldown-runtime-hePW80VL.js, /assets/test-hooks-P0rzqaOg.js, /assets/index-C8LDzkpJ.css.

## Served headers (vite preview)

| path | Cache-Control | Content-Encoding | ETag |
|---|---|---|---|
| / | no-cache | none | yes |
| /assets/RobotLab-*.js | no-cache | gzip | yes |
| /robot3d/robot-kit.glb?v=1 | no-cache | none | yes |
| /assets/rapier_wasm3d_bg-*.wasm | no-cache | none | yes |
