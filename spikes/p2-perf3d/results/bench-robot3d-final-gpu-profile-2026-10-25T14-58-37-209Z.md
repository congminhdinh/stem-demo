# bench:robot3d — 2026-10-25T14:58:37.209Z — final-gpu-profile

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit a4717b0. Repeats 3, window 8 s, soak 10 min, switches 20. 1-minute load average from 5.93–91.42 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 370 kB | ≤ 600 kB | ok | 1 | robot plan §5 |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

## Where the main thread goes (profile pass, ms per animation frame, ranges over the repeats)

| profile · scenario | busy | sim | render (shadow map) | React | Blockly | scene callbacks | GC | browser (style, layout, paint, GL) | alloc/frame KB | load |
|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high · line-follow | 2.19–2.42 | 0.8–0.91 | 0.82–0.98 (0.19–0.23) | 0.06–0.09 | 0 | 0.1–0.11 | 0.02–0.03 | 0.28–0.3 | 160.3–167.4 | 8.12–13.59 |
| gpu-high · mini-mission | 2.2–2.59 | 0.75–0.91 | 0.74–0.98 (0.19–0.26) | 0.07–0.08 | 0 | 0.25–0.26 | 0.02 | 0.31–0.36 | 273.6–275.7 | 12.99–15.68 |
| gpu-high · check-4x | 3.24–3.6 | 1.48–1.62 | 0.23–0.27 (0.06–0.07) | 0.17–0.19 | 0–0.01 | 0.69–0.77 | 0.06–0.08 | 0.51–0.52 | 791.9–795 | 6.93–13.08 |
| gpu-high · follow | 3.05–3.41 | 1.08–1.2 | 1.14–1.44 (0.35–0.47) | 0.09–0.14 | 0–0.01 | 0.17–0.2 | 0.04–0.06 | 0.37–0.41 | 176.4–183.7 | 5.93–14.04 |
| gpu-high · teleop | 2.78–3.27 | 0.74–0.83 | 1.09–1.51 (0.26–0.49) | 0.06–0.07 | 0 | 0.14–0.16 | 0.03–0.07 | 0.57–0.6 | 153.7–157.8 | 17.53–20.19 |
| gpu-high · pins | 2.36–3.04 | 0.81–1 | 0.74–1.05 (0.18–0.24) | 0.18–0.23 | 0–0.01 | 0.11–0.12 | 0.01–0.02 | 0.46–0.58 | 178.9–183.5 | 12.68–17.88 |
| gpu-high · cpp | 3.03–3.27 | 1–1.21 | 1.26–1.33 (0.27–0.42) | 0.14–0.16 | 0–0.01 | 0.12–0.13 | 0.02–0.03 | 0.35–0.45 | 166.1–174.7 | 11.65–35.84 |
| gpu-high-sim4x · line-follow | 4.07–4.19 | 2.56–2.69 | 0.53–0.54 (0.11–0.15) | 0.18–0.21 | 0–0.01 | 0.06–0.07 | 0.04–0.06 | 0.6–0.62 | 371.3–375.6 | 59.28–75.3 |
| gpu-high-sim4x · mini-mission | 3.3–3.79 | 1.76–1.98 | 0.17–0.23 (0.04–0.07) | 0.17–0.19 | 0 | 0.47–0.65 | 0.04–0.09 | 0.51–0.66 | 626–630.8 | 73.35–91.42 |

## The busiest sources (profile pass, self time in the window, ms; the first repeat)

- **gpu-high · line-follow** (8 s, 480 frames): three/build/three.module.js 374; rapier.wasm 145; (browser) 137; three/build/three.core.js 57; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 36; src/core/run/robot-run-session.ts 32; src/core/run/virtual-clock.ts 32; src/core/world/world.ts 23. Allocates most: three/build/three.module.js 17 MiB; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; src/core/world/world.ts 4 MiB; src/core/world/units.ts 4 MiB; src/core/world/sensors/contacts.ts 4 MiB
- **gpu-high · mini-mission** (8 s, 479 frames): three/build/three.module.js 416; rapier.wasm 165; (browser) 150; three/build/three.core.js 66; src/ui/robot3d/camera-studio.ts 64; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 48; src/core/run/virtual-clock.ts 34; src/core/run/robot-run-session.ts 29. Allocates most: src/ui/robot3d/camera-studio.ts 45 MiB; three/build/three.module.js 18 MiB; src/core/world/arena/ground-paint.ts 7 MiB; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; src/ui/robot3d/parts/zone-tag-layout.ts 5 MiB
- **gpu-high · check-4x** (35 s, 2031 frames): src/ui/robot3d/camera-studio.ts 1415; rapier.wasm 1304; (browser) 1064; three/build/three.module.js 482; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 433; WebGL calls (through the bench probe) 274; react-dom/cjs/react-dom-client.production.js 216; src/core/world/arena/ground-paint.ts 167. Allocates most: src/ui/robot3d/camera-studio.ts 867 MiB; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 82 MiB; src/core/world/world.ts 64 MiB; src/core/world/sensors/contacts.ts 52 MiB; src/core/world/robot/assembly.ts 51 MiB
- **gpu-high · follow** (8 s, 481 frames): three/build/three.module.js 490; (browser) 200; rapier.wasm 185; three/build/three.core.js 77; react-dom/cjs/react-dom-client.production.js 43; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 37; src/core/run/virtual-clock.ts 36; src/core/program/ybc-interpreter.ts 32. Allocates most: three/build/three.module.js 18 MiB; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; src/ui/robot3d/camera-studio.ts 5 MiB; src/core/world/world.ts 4 MiB; src/core/world/units.ts 4 MiB
- **gpu-high · teleop** (8.2 s, 491 frames): three/build/three.module.js 604; (browser) 296; rapier.wasm 149; three/build/three.core.js 105; WebGL calls (through the bench probe) 51; src/core/run/robot-run-session.ts 31; (gc) 29; src/core/world/world.ts 29. Allocates most: three/build/three.module.js 17 MiB; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; three/build/three.core.js 5 MiB; src/core/world/world.ts 5 MiB; src/core/world/units.ts 4 MiB
- **gpu-high · pins** (8 s, 480 frames): three/build/three.module.js 437; (browser) 253; rapier.wasm 172; three/build/three.core.js 72; react-dom/cjs/react-dom-client.production.js 45; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 42; src/core/run/virtual-clock.ts 37; WebGL calls (through the bench probe) 27. Allocates most: three/build/three.module.js 18 MiB; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; src/core/world/world.ts 4 MiB; src/core/world/units.ts 4 MiB; src/core/world/sensors/contacts.ts 4 MiB
- **gpu-high · cpp** (8 s, 481 frames): three/build/three.module.js 542; (browser) 169; rapier.wasm 156; three/build/three.core.js 77; src/core/run/virtual-clock.ts 39; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 36; WebGL calls (through the bench probe) 30; src/core/program/ybc-interpreter.ts 30. Allocates most: three/build/three.module.js 17 MiB; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; src/core/world/world.ts 4 MiB; src/core/world/units.ts 4 MiB; src/core/world/sensors/contacts.ts 4 MiB
- **gpu-high-sim4x · line-follow** (8 s, 482 frames): rapier.wasm 400; (browser) 296; three/build/three.module.js 228; src/core/run/virtual-clock.ts 120; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 101; src/core/hardware/binding.ts 95; src/core/program/ybc-interpreter.ts 64; src/core/world/arena/ground-paint.ts 50. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 20 MiB; src/core/world/world.ts 15 MiB; src/core/world/sensors/contacts.ts 12 MiB; src/core/world/robot/assembly.ts 12 MiB; src/core/world/units.ts 11 MiB
- **gpu-high-sim4x · mini-mission** (8 s, 469 frames): rapier.wasm 376; (browser) 310; src/ui/robot3d/camera-studio.ts 276; three/build/three.module.js 100; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 96; src/core/world/arena/ground-paint.ts 51; src/core/run/virtual-clock.ts 47; src/core/world/world.ts 41. Allocates most: src/ui/robot3d/camera-studio.ts 131 MiB; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 20 MiB; src/core/world/world.ts 15 MiB; src/core/world/sensors/contacts.ts 12 MiB; src/core/world/units.ts 11 MiB

## Before the first frame (profile pass: navigation → the scene drawn, main thread self time by what ran, ms)

| profile · scenario | first frame | busy | three | blockly | react-dom | r3f | ui: robot3d | sim | webgl calls | browser | gc |
|---|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high · line-follow | 969–1080 | 524–589 | 154–190 | 55–208 | 20–22 | 13–18 | 47–55 | 8–11 | 9–17 | 51–78 | 7–19 |
| gpu-high · mini-mission | 920–1098 | 416–703 | 138–185 | 42–61 | 18–27 | 14–27 | 65–82 | 8–11 | 8–147 | 52–71 | 10–15 |
| gpu-high · check-4x | 923–1518 | 423–612 | 139–200 | 43–54 | 17–18 | 13–19 | 63–80 | 8–9 | 9–13 | 55–123 | 8–14 |
| gpu-high · follow | 928–1722 | 401–711 | 138–238 | 42–65 | 13–25 | 14–21 | 38–74 | 7–11 | 9–14 | 57–164 | 17–31 |
| gpu-high · teleop | 1403–2373 | 645–846 | 222–439 | 63–69 | 22–36 | 15–27 | 38–69 | 7–12 | 12–25 | 87–142 | 20–22 |
| gpu-high · pins | 940–1116 | 404–574 | 138–203 | 43–63 | 18–24 | 12–22 | 44–62 | 9–11 | 8–12 | 57–83 | 12–26 |
| gpu-high · cpp | 1627–1722 | 641–699 | 218–236 | 60–72 | 19–32 | 19–25 | 61–70 | 8–13 | 10–12 | 84–148 | 12–21 |
| gpu-high-sim4x · line-follow | 1659–1732 | 662–1083 | 210–238 | 63–500 | 22–24 | 22–24 | 59–64 | 9–12 | 14–15 | 96–155 | 12–23 |
| gpu-high-sim4x · mini-mission | 1645–1679 | 638–691 | 207–269 | 62–64 | 23–27 | 18–22 | 84–96 | 11–13 | 11–16 | 76–148 | 13–29 |

- **gpu-high · line-follow**: blockly/blockly_compressed.js 205; three/build/three.module.js 99; (browser) 51; three/build/three.core.js 38; react-dom/cjs/react-dom-client.production.js 19; WebGL calls (through the bench probe) 17; (unknown) 15; src/ui/robot3d/camera-studio.ts 14; @react-three/fiber/dist/events-9ce18a08.esm.js 13; react-use-measure/dist/index.js 12
- **gpu-high · mini-mission**: WebGL calls (through the bench probe) 147; three/build/three.module.js 117; (browser) 71; blockly/blockly_compressed.js 59; three/build/three.core.js 43; src/ui/robot3d/camera-studio.ts 41; @react-three/fiber/dist/events-9ce18a08.esm.js 27; react-dom/cjs/react-dom-client.production.js 27; (unknown) 21; react-use-measure/dist/index.js 19
- **gpu-high · check-4x**: three/build/three.module.js 88; (browser) 59; three/build/three.core.js 45; blockly/blockly_compressed.js 41; src/ui/robot3d/camera-studio.ts 33; react-dom/cjs/react-dom-client.production.js 17; @react-three/fiber/dist/events-9ce18a08.esm.js 14; react-use-measure/dist/index.js 13; (unknown) 12; zod/v4/core/schemas.js 11
- **gpu-high · follow**: three/build/three.module.js 87; (browser) 57; blockly/blockly_compressed.js 40; three/build/three.core.js 34; (gc) 17; (unknown) 15; @react-three/fiber/dist/events-9ce18a08.esm.js 13; react-dom/cjs/react-dom-client.production.js 13; react-use-measure/dist/index.js 13; src/ui/robot3d/camera-studio.ts 10
- **gpu-high · teleop**: three/build/three.module.js 309; (browser) 104; three/build/three.core.js 69; blockly/blockly_compressed.js 66; three/examples/jsm/loaders/GLTFLoader.js 50; (unknown) 25; react-dom/cjs/react-dom-client.production.js 24; (gc) 22; src/ui/robot3d/camera-studio.ts 19; zod/v4/core/schemas.js 19
- **gpu-high · pins**: three/build/three.module.js 120; (browser) 78; blockly/blockly_compressed.js 58; three/build/three.core.js 47; (gc) 26; react-dom/cjs/react-dom-client.production.js 24; @react-three/fiber/dist/events-9ce18a08.esm.js 22; (unknown) 20; src/ui/robot3d/camera-studio.ts 19; three/examples/jsm/loaders/GLTFLoader.js 17
- **gpu-high · cpp**: three/build/three.module.js 148; (browser) 148; blockly/blockly_compressed.js 62; three/build/three.core.js 54; react-dom/cjs/react-dom-client.production.js 32; src/ui/robot3d/camera-studio.ts 21; three/examples/jsm/loaders/GLTFLoader.js 21; react-use-measure/dist/index.js 20; zod/v4/core/schemas.js 18; (unknown) 18
- **gpu-high-sim4x · line-follow**: blockly/blockly_compressed.js 497; three/build/three.module.js 144; (browser) 96; three/build/three.core.js 58; react-use-measure/dist/index.js 25; @react-three/fiber/dist/events-9ce18a08.esm.js 24; src/ui/robot3d/camera-studio.ts 24; three/examples/jsm/loaders/GLTFLoader.js 22; react-dom/cjs/react-dom-client.production.js 22; (unknown) 19
- **gpu-high-sim4x · mini-mission**: three/build/three.module.js 125; (browser) 85; three/examples/jsm/loaders/GLTFLoader.js 72; blockly/blockly_compressed.js 61; three/build/three.core.js 55; src/ui/robot3d/camera-studio.ts 48; react-dom/cjs/react-dom-client.production.js 27; react-use-measure/dist/index.js 25; (unknown) 20; @react-three/fiber/dist/events-9ce18a08.esm.js 18

## Bundle (gzip -6)

| file | bytes | gzip | holds |
|---|---|---|---|
| test-hooks-SslOmkyj.js | 1438871 | 409492 | — |
| RobotLab-dUgPb8sK.js | 1305693 | 370018 | three, r3f, gltfLoader, meshopt |
| index-CzEPebYH.js | 483855 | 145818 | — |
| rapier-DZ_EfFMH.js | 295823 | 52055 | rapier |
| rolldown-runtime-hePW80VL.js | 716 | 428 | — |
| rapier_wasm3d_bg-DZsYp9WG.wasm | 3105893 | 1180561 | |
| arena-props-low.glb | 194772 | 83286 | |
| arena-props.glb | 303372 | 150186 | |
| robot-kit-low.glb | 495220 | 196824 | |
| robot-kit.glb | 826656 | 369080 | |

Entry HTML loads: /favicon.svg, /assets/index-CzEPebYH.js, /assets/rolldown-runtime-hePW80VL.js, /assets/test-hooks-SslOmkyj.js, /assets/index-C8LDzkpJ.css.

## Served headers (vite preview)

| path | Cache-Control | Content-Encoding | ETag |
|---|---|---|---|
| / | no-cache | none | yes |
| /assets/RobotLab-*.js | no-cache | gzip | yes |
| /robot3d/robot-kit.glb?v=1 | no-cache | none | yes |
| /assets/rapier_wasm3d_bg-*.wasm | no-cache | none | yes |
