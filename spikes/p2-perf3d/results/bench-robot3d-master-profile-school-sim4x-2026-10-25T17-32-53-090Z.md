# bench:robot3d — 2026-10-25T17:32:53.090Z — master-profile-school-sim4x

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 518f6a2. Sensor overlays on (where the build has them). Repeats 3, window 8 s, soak 10 min, switches 20. 1-minute load average from 15.4–17.75 at the cells' start.

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
| school-sim4x · line-follow | 9.55–54.64 | 6.17–11.71 | 0.54–2.69 (0) | 0.64–1.07 | 0–0.01 | 0.29–8.47 | 0.11–0.67 | 1.69–3.56 | 363.4–1995.2 | 95–99 | 15.4–17.75 |

## The busiest sources (profile pass, self time in the window, ms; the first repeat)

- **school-sim4x · line-follow** (8 s, 478 frames): rapier.wasm 1151; (browser) 844; three/build/three.module.js 304; src/core/run/virtual-clock.ts 256; src/core/hardware/binding.ts 243; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 242; src/core/program/ybc-interpreter.ts 218; react-dom/cjs/react-dom-client.production.js 157. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 20 MiB; src/core/world/world.ts 15 MiB; src/core/world/sensors/contacts.ts 13 MiB; src/core/world/units.ts 12 MiB; src/core/world/robot/assembly.ts 11 MiB

## Before the first frame (profile pass: navigation → the scene drawn, main thread self time by what ran, ms)

| profile · scenario | first frame | busy | three | blockly | react-dom | r3f | ui: robot3d | sim | webgl calls | browser | gc |
|---|---|---|---|---|---|---|---|---|---|---|---|
| school-sim4x · line-follow | 2082–4096 | 1940–3842 | 832–1866 | 179–273 | 83–89 | 66–86 | 171–183 | 26–33 | 19–28 | 282–1661 | 21–35 |

- **school-sim4x · line-follow**: (browser) 1661; three/build/three.module.js 993; blockly/blockly_compressed.js 263; three/build/three.core.js 146; react-dom/cjs/react-dom-client.production.js 83; @react-three/fiber/dist/events-9ce18a08.esm.js 67; (unknown) 64; src/ui/robot3d/camera-studio.ts 57; three/examples/jsm/loaders/GLTFLoader.js 54; react-use-measure/dist/index.js 53

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
