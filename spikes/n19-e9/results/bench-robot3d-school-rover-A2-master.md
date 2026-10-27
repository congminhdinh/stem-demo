# bench:robot3d — 2026-10-27T02:26:47.962Z — e910-rover-A2-master

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 46a3f82. Sensor overlays on (where the build has them). Repeats 2, window 8 s, soak 10 min, switches 20. 1-minute load average from 4.94–12.17 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 414.4 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | Run → moving (warm), every profile | 46 ms | ≤ 300 ms | ok | 6 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 16 | idle before a run, a parked robot, after an orbit settles |
| target | school: p95 frame time running at 1× | 19.8 ms | ≤ 33 ms | ok | 8 | every run scenario, low tier |
| target | school: p95 frame time running at 4× | 21 ms | ≤ 33 ms | ok | 2 | sim speed 4× and Kiểm tra 4× |
| target | school: long tasks > 100 ms during a run | 0  | ≤ 0  | ok | 10 | in the measuring window |
| target | school: first frame | 4083 ms | ≤ 2500 ms | not met | 12 | lesson page navigation → the scene drawn |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 60.2 | 52.1–52.9 | 16.6 / 18.9–19.2 / 19.3–19.4 | 2.6–2.7 / 4.2–4.3 | 1.5–1.6 | 41 + 0 | 0 (0) 0 | — (—) | 221–223 (125–130) | 87.4–88 (5–5.17) | 15.9–16.3 (0.93) | 2.4–2.5 | 98 | 5.94–6.23 |
| school · drive-to-zone | 59.9–60.2 | 52.1–52.6 | 16.6–16.7 / 19–19.2 / 19.9–20 | 4.6–4.8 / 7.7–8 | 1.2–1.3 | 42 + 0 | 0 (0) 0 | 10 (—) | 312–318 (122–124) | 80.6–81.4 (4.83–4.88) | 15.8–15.8 (0.95) | 0.2 | 98 | 5.09–5.43 |
| school · line-follow | 59.9 | 52.1–52.4 | 16.7 / 19.1–19.2 / 20.3–20.6 | 5.4–5.6 / 8.7–9.3 | 1.4–1.5 | 48 + 0 | 0 (0) 0 | 10.7 (—) | 360–369 (127–130) | 95.2–96.3 (5.7–5.77) | 16–16 (0.96) | 0 | 98–99 | 4.94–5.7 |
| school · mini-mission | 59.9–60.2 | 50.5–51 | 16.6–16.7 / 19.6–19.8 / 21–22.1 | 5.3–5.4 / 9.3 | 1.3 | 47 + 0 | 0 (0) 0 | 11.6 (—) | 365–371 (137–137) | 95.6–96 (5.73–5.76) | 16–16 (0.96) | 1.4 | 97–98 | 5.3–6.56 |
| school · check-4x | 59.9–60.2 | 47.6–48.1 | 16.6–16.7 / 20.8–21 / 40.2–197 | 7.3–7.5 / 12.8 | 1.4–1.5 | 49 + 0 | 0 (0) 0 | 34.1 (—) | 486–502 (92–92) | 59.3–61.3 (3.46–3.67) | 16.3–16.8 (0.98) | 1.3–1.5 | 98–99 | 5.67–7.58 |
| school · teleop | 59.5–59.9 | 50.8–51.8 | 16.7–16.8 / 19.3–19.7 / 20.5–20.9 | 6–6.1 / 8.5–8.7 | 1.4 | 43 + 0 | 0 (0) 0 | 12 (—) | 389–391 (133–136) | 124.8–125 (7.47–7.49) | 16.3–16.3 (0.97) | 0 | 100 | 6.95–7.34 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 4041–4083 | 518–545 | 2608–2639 | 874–920 | 2740–2779 | 2960–2990 → 3011–3038 | 2705–2741 | 3841–3898 | 1016–1039 (353–375) | 248–257 | 13 | 9.7 | — | — | 0 | 0 |
| school · drive-to-zone | 2608–2623 | 519–525 | 1228–1241 | 871–880 | 1343–1355 | 1582–1594 → 1630–1640 | 1318–1328 | 2229–2242 | 882–888 (356–362) | 235–239 | 13 | 7.8 | 83–88 | 42–44 | 0 | 0 |
| school · line-follow | 2601–2703 | 519–532 | 1234–1265 | 876–900 | 1367–1395 | 1589–1619 → 1635–1668 | 1334–1363 | 2192–2286 | 899–912 (357–359) | 253–256 | 13 | 9.7 | 83–85 | 43–46 | 0 | — |
| school · mini-mission | 2575–2597 | 525–530 | 1256–1274 | 887–890 | 1400–1425 | 1611–1629 → 1659–1674 | 1368–1386 | 2202–2226 | 921–941 (361–362) | 267 | 12 | 9.9 | 83–85 | 43–44 | 0 | — |
| school · check-4x | 2574–2593 | 529–545 | 1262–1266 | 893–902 | 1399–1416 | 1620–1623 → 1664–1667 | 1371–1378 | 2198–2239 | 909–931 (360–361) | 261–272 | 12 | 9.9 | — | — | 0 | — |
| school · teleop | 2633–2644 | 534–550 | 1221–1245 | 884–912 | 1329–1353 | 1574–1597 → 1634–1659 | 2117–2129 | 2282–2294 | 1453 (467–469) | 230–234 | 13 | 10.4 | — | — | 0 | — |

## Where the main thread goes (profile pass, ms per animation frame, ranges over the repeats)

| profile · scenario | busy | sim | render (shadow map) | React | Blockly | scene callbacks | GC | browser (style, layout, paint, GL) | alloc/frame KB | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|
| school · line-follow | 7.51–7.54 | 1.69–1.78 | 1.41–1.57 (0) | 0.3–0.44 | 0–0.01 | 0.44–0.46 | 0.08–0.12 | 1.31–1.37 | 131.9–135.4 | 98–100 | 8.37–9.41 |
| school · mini-mission | 7.47–7.61 | 1.67–1.77 | 1.45–1.51 (0) | 0.39–0.41 | 0–0.01 | 0.66 | 0.08–0.12 | 1.38–1.41 | 167.4–170.5 | 99 | 10.79–12.17 |
| school · check-4x | 10.38–10.57 | 3.54–3.58 | 0.5–0.51 (0) | 0.89–0.91 | 0.01–0.02 | 0.34–0.36 | 0.17–0.19 | 2.15–2.16 | 362.7–364.6 | 97–98 | 11.4–12.05 |
| school · teleop | 7.75–7.82 | 1.96–1.98 | 1.48–1.56 (0) | 0.24–0.3 | 0 | 0.54–0.57 | 0.05–0.09 | 2–2.09 | 118.6–119.7 | 98–100 | 8.64–9.94 |

## The busiest sources (profile pass, self time in the window, ms; the first repeat)

- **school · line-follow** (8 s, 481 frames): (browser) 660; rapier.wasm 609; three/build/three.module.js 560; three/build/three.core.js 172; e910-master/src/core/run/virtual-clock.ts 143; e910-master/src/core/run/robot-run-session.ts 114; react-dom/cjs/react-dom-client.production.js 106; WebGL calls (through the bench probe) 92. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; three/build/three.module.js 5 MiB; e910-master/src/core/world/world.ts 4 MiB; e910-master/src/core/world/units.ts 4 MiB; e910-master/src/core/world/arena/ground-paint.ts 4 MiB
- **school · mini-mission** (8 s, 477 frames): (browser) 674; rapier.wasm 628; three/build/three.module.js 592; three/build/three.core.js 182; e910-master/src/core/run/robot-run-session.ts 123; WebGL calls (through the bench probe) 104; e910-master/src/core/run/virtual-clock.ts 99; react-dom/cjs/react-dom-client.production.js 96. Allocates most: e910-master/src/ui/robot3d/camera-studio.ts 12 MiB; e910-master/src/core/world/arena/ground-paint.ts 7 MiB; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; three/build/three.module.js 5 MiB; e910-master/src/core/world/world.ts 4 MiB
- **school · check-4x** (34.5 s, 2026 frames): rapier.wasm 5088; (browser) 4377; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 1427; react-dom/cjs/react-dom-client.production.js 1008; three/build/three.module.js 836; e910-master/src/core/world/arena/ground-paint.ts 635; e910-master/src/core/world/world.ts 619; e910-master/src/core/run/virtual-clock.ts 587. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 73 MiB; e910-master/src/core/world/world.ts 66 MiB; e910-master/src/core/world/sensors/contacts.ts 51 MiB; e910-master/src/ui/robot3d/camera-studio.ts 46 MiB; e910-master/src/core/world/robot/assembly.ts 45 MiB
- **school · teleop** (8.1 s, 487 frames): (browser) 975; rapier.wasm 687; three/build/three.module.js 632; three/build/three.core.js 215; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 141; e910-master/src/core/world/world.ts 110; e910-master/src/core/run/robot-run-session.ts 105; WebGL calls (through the bench probe) 102. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; three/build/three.module.js 5 MiB; e910-master/src/core/world/world.ts 5 MiB; e910-master/src/core/world/units.ts 4 MiB; e910-master/src/core/world/arena/ground-paint.ts 4 MiB

## Before the first frame (profile pass: navigation → the scene drawn, main thread self time by what ran, ms)

| profile · scenario | first frame | busy | three | blockly | react-dom | r3f | ui: robot3d | sim | webgl calls | browser | gc |
|---|---|---|---|---|---|---|---|---|---|---|---|
| school · line-follow | 2115–3923 | 1964–3445 | 830–947 | 193–287 | 77–82 | 69–77 | 0 | 3–8 | 25–25 | 251–1517 | 22–24 |
| school · mini-mission | 1979–1983 | 1835–1841 | 685–702 | 188–195 | 97–100 | 71–77 | 0 | 4–5 | 25–25 | 236–237 | 22–25 |
| school · check-4x | 2081–2083 | 1938–1961 | 791–793 | 192–199 | 95–98 | 69–72 | 0 | 3–7 | 24–26 | 246–247 | 27–30 |
| school · teleop | 2018–2023 | 1829–1830 | 736–746 | 166–178 | 87–95 | 61–74 | 0 | 7–8 | 23–27 | 245–249 | 16–17 |

- **school · line-follow**: (browser) 1517; three/build/three.module.js 730; blockly/blockly_compressed.js 279; three/build/three.core.js 145; react-dom/cjs/react-dom-client.production.js 82; @react-three/fiber/dist/events-9ce18a08.esm.js 67; zod/v4/core/schemas.js 67; (unknown) 63; react-use-measure/dist/index.js 60; three/examples/jsm/loaders/GLTFLoader.js 54
- **school · mini-mission**: three/build/three.module.js 477; (browser) 236; blockly/blockly_compressed.js 186; three/build/three.core.js 139; react-dom/cjs/react-dom-client.production.js 97; @react-three/fiber/dist/events-9ce18a08.esm.js 74; three/examples/jsm/loaders/GLTFLoader.js 67; (unknown) 63; react-use-measure/dist/index.js 59; zod/v4/core/schemas.js 54
- **school · check-4x**: three/build/three.module.js 568; (browser) 246; blockly/blockly_compressed.js 185; three/build/three.core.js 139; react-dom/cjs/react-dom-client.production.js 95; @react-three/fiber/dist/events-9ce18a08.esm.js 68; (unknown) 64; zod/v4/core/schemas.js 58; react-use-measure/dist/index.js 57; three/examples/jsm/loaders/GLTFLoader.js 56
- **school · teleop**: three/build/three.module.js 516; (browser) 245; blockly/blockly_compressed.js 170; three/build/three.core.js 149; react-dom/cjs/react-dom-client.production.js 95; @react-three/fiber/dist/events-9ce18a08.esm.js 72; (unknown) 57; react-use-measure/dist/index.js 55; zod/v4/core/schemas.js 54; three/examples/jsm/loaders/GLTFLoader.js 50

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| school · idle | 52 (40, 0) | 5 | 22 Lambert, 10 Basic, 3 Sprite | 51046 | 36370 | 13 | 9.7: 4.8 + 2.3 + 0 + 2.5 | MeshLambertMaterial 850×700 canvas aniso 8; birch_face 1024×128 ImageBitmap; walnut 256×256 ImageBitmap; pcb_teal 200×256 ImageBitmap |

## Bundle (gzip -6)

| file | bytes | gzip | holds |
|---|---|---|---|
| test-hooks-f6unhMn2.js | 1489736 | 422712 | — |
| RobotLab-iFTj1is7.js | 1439598 | 414355 | three, r3f, gltfLoader, meshopt |
| index-BPSI07g5.js | 484533 | 146082 | — |
| rapier-DZ_EfFMH.js | 295823 | 52055 | rapier |
| rolldown-runtime-hePW80VL.js | 716 | 428 | — |
| rapier_wasm3d_bg-DZsYp9WG.wasm | 3105893 | 1180561 | |
| arena-props-low.glb | 242472 | 101999 | |
| arena-props.glb | 376440 | 190892 | |
| robot-kit-low.glb | 560668 | 218033 | |
| robot-kit.glb | 928072 | 411573 | |

Entry HTML loads: /favicon.svg, /assets/index-BPSI07g5.js, /assets/rolldown-runtime-hePW80VL.js, /assets/test-hooks-f6unhMn2.js, /assets/index-CgMmDkmz.css.

## Served headers (vite preview)

| path | Cache-Control | Content-Encoding | ETag |
|---|---|---|---|
| / | no-cache | none | yes |
| /assets/RobotLab-*.js | no-cache | gzip | yes |
| /robot3d/robot-kit.glb?v=1 | no-cache | none | yes |
| /assets/rapier_wasm3d_bg-*.wasm | no-cache | none | yes |
