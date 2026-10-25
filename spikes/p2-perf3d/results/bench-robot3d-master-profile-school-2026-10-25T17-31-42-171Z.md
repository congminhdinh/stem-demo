# bench:robot3d — 2026-10-25T17:31:42.171Z — master-profile-school

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 518f6a2. Sensor overlays on (where the build has them). Repeats 3, window 8 s, soak 10 min, switches 20. 1-minute load average from 10.06–18.71 at the cells' start.

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
| school · line-follow | 6.47–8.08 | 3.01–3.82 | 1.38–1.66 (0) | 0.28–0.35 | 0 | 0.5–0.65 | 0.04–0.06 | 1.15–1.49 | 136.4–144.1 | 98–100 | 10.77–17.04 |
| school · mini-mission | 6.85–8.75 | 2.65–3.57 | 1.3–1.58 (0) | 0.39–0.41 | 0.01–0.02 | 1.08–1.34 | 0.06–0.09 | 1.25–1.64 | 250.6–257.4 | 97–99 | 10.63–13.78 |
| school · check-4x | 14.7–16.6 | 6.88–6.95 | 0.53–0.55 (0) | 0.87–0.93 | 0.02 | 3.49–5.37 | 0.26–0.33 | 2.32–2.36 | 868.2–1143.3 | 95–99 | 10.06–15.26 |
| school · pins | 8.61–12.95 | 3.42–5.41 | 1.42–1.82 (0) | 0.7–1.19 | 0.05–0.06 | 0.58–0.83 | 0.05–0.16 | 2.12–3.11 | 152–216.9 | 98–102 | 15.48–18.71 |

## The busiest sources (profile pass, self time in the window, ms; the first repeat)

- **school · line-follow** (8 s, 459 frames): (browser) 655; three/build/three.module.js 641; rapier.wasm 636; three/build/three.core.js 207; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 143; src/core/run/virtual-clock.ts 130; src/core/run/robot-run-session.ts 87; src/core/world/world.ts 87. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; three/build/three.module.js 5 MiB; src/core/world/units.ts 4 MiB; src/core/world/world.ts 4 MiB; src/core/world/sensors/contacts.ts 4 MiB
- **school · mini-mission** (8 s, 466 frames): (browser) 631; three/build/three.module.js 545; rapier.wasm 508; src/ui/robot3d/camera-studio.ts 251; three/build/three.core.js 153; src/core/run/virtual-clock.ts 112; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 111; src/core/run/robot-run-session.ts 105. Allocates most: src/ui/robot3d/camera-studio.ts 44 MiB; src/core/world/arena/ground-paint.ts 7 MiB; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; three/build/three.module.js 5 MiB; src/ui/robot3d/parts/zone-tag-layout.ts 5 MiB
- **school · check-4x** (41.8 s, 2026 frames): src/ui/robot3d/camera-studio.ts 6344; rapier.wasm 5362; (browser) 4779; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 1876; react-dom/cjs/react-dom-client.production.js 938; three/build/three.module.js 884; src/core/run/virtual-clock.ts 654; src/core/world/arena/ground-paint.ts 644. Allocates most: src/ui/robot3d/camera-studio.ts 1028 MiB; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 79 MiB; src/core/world/world.ts 63 MiB; src/core/world/sensors/contacts.ts 52 MiB; src/core/world/robot/assembly.ts 51 MiB
- **school · pins** (8 s, 328 frames): (browser) 1020; rapier.wasm 612; three/build/three.module.js 504; react-dom/cjs/react-dom-client.production.js 214; three/build/three.core.js 166; WebGL calls (through the bench probe) 138; src/core/run/virtual-clock.ts 131; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 121. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; src/core/world/units.ts 4 MiB; src/core/world/world.ts 4 MiB; src/core/world/arena/ground-paint.ts 4 MiB; src/core/world/sensors/contacts.ts 4 MiB

## Before the first frame (profile pass: navigation → the scene drawn, main thread self time by what ran, ms)

| profile · scenario | first frame | busy | three | blockly | react-dom | r3f | ui: robot3d | sim | webgl calls | browser | gc |
|---|---|---|---|---|---|---|---|---|---|---|---|
| school · line-follow | 2616–4184 | 2074–3988 | 915–1288 | 189–289 | 82–84 | 70–78 | 183–188 | 22–33 | 23–26 | 242–1714 | 19–25 |
| school · mini-mission | 2444–2552 | 1986–2104 | 792–875 | 170–209 | 75–83 | 72–79 | 238–257 | 23–26 | 22–28 | 236–282 | 28–29 |
| school · check-4x | 2636–2684 | 2150–2218 | 851–940 | 197–212 | 73–98 | 64–81 | 251–295 | 25–42 | 23–30 | 261–297 | 26–32 |
| school · pins | 2198–2648 | 2087–2245 | 911–955 | 201–231 | 90–103 | 59–75 | 185–201 | 29–31 | 24–28 | 252–320 | 22–28 |

- **school · line-follow**: (browser) 1714; three/build/three.module.js 1076; blockly/blockly_compressed.js 280; three/build/three.core.js 133; react-dom/cjs/react-dom-client.production.js 83; @react-three/fiber/dist/events-9ce18a08.esm.js 77; (unknown) 65; src/ui/robot3d/camera-studio.ts 58; three/examples/jsm/loaders/GLTFLoader.js 58; react-use-measure/dist/index.js 57
- **school · mini-mission**: three/build/three.module.js 606; (browser) 273; blockly/blockly_compressed.js 162; three/build/three.core.js 147; src/ui/robot3d/camera-studio.ts 120; @react-three/fiber/dist/events-9ce18a08.esm.js 79; react-dom/cjs/react-dom-client.production.js 75; (unknown) 59; react-use-measure/dist/index.js 47; three/examples/jsm/loaders/GLTFLoader.js 44
- **school · check-4x**: three/build/three.module.js 721; (browser) 261; blockly/blockly_compressed.js 188; three/build/three.core.js 159; src/ui/robot3d/camera-studio.ts 129; @react-three/fiber/dist/events-9ce18a08.esm.js 78; react-dom/cjs/react-dom-client.production.js 73; react-use-measure/dist/index.js 60; (unknown) 59; three/examples/jsm/loaders/GLTFLoader.js 44
- **school · pins**: three/build/three.module.js 718; (browser) 320; blockly/blockly_compressed.js 224; three/build/three.core.js 136; react-dom/cjs/react-dom-client.production.js 90; @react-three/fiber/dist/events-9ce18a08.esm.js 73; (unknown) 72; react-use-measure/dist/index.js 68; src/ui/robot3d/camera-studio.ts 63; three/examples/jsm/loaders/GLTFLoader.js 48

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
