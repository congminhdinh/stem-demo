# bench:robot3d — 2026-10-27T02:18:18.713Z — e910-rover-B1-branch

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 46a3f82. Sensor overlays on (where the build has them). Repeats 2, window 8 s, soak 10 min, switches 20. 1-minute load average from 5.97–9.3 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 414.6 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | Run → moving (warm), every profile | 44 ms | ≤ 300 ms | ok | 6 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 16 | idle before a run, a parked robot, after an orbit settles |
| target | school: p95 frame time running at 1× | 20.2 ms | ≤ 33 ms | ok | 8 | every run scenario, low tier |
| target | school: p95 frame time running at 4× | 20.7 ms | ≤ 33 ms | ok | 2 | sim speed 4× and Kiểm tra 4× |
| target | school: long tasks > 100 ms during a run | 0  | ≤ 0  | ok | 10 | in the measuring window |
| target | school: first frame | 4287 ms | ≤ 2500 ms | not met | 12 | lesson page navigation → the scene drawn |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 59.5–60.2 | 52.6–53.5 | 16.6–16.8 / 18.7–19 / 19.9–20.2 | 2.4–2.8 / 4.4–4.5 | 1.4–1.5 | 41 + 0 | 0 (0) 0 | — (—) | 204–231 (122–122) | 88.7–89.1 (5.08–5.22) | 15.8–16.4 (0.93) | 2.5–3 | 98–99 | 5.97–6.8 |
| school · drive-to-zone | 59.5–60.2 | 51–52.4 | 16.6–16.8 / 19.1–19.6 / 20.7–21.4 | 4.6–4.9 / 7.7–8.2 | 1.2–1.4 | 42 + 0 | 0 (0) 0 | 10–10.2 (—) | 311–328 (118–131) | 80.4–81.3 (4.81–4.87) | 15.9–15.9 (0.95–0.96) | 0.2 | 98–100 | 6.17–7.01 |
| school · line-follow | 59.5–60.2 | 50.5–51.5 | 16.6–16.8 / 19.4–19.8 / 21.3–21.4 | 5.4–5.6 / 9.2–9.5 | 1.4 | 48 + 0 | 0 (0) 0 | 10.7–13 (—) | 375–375 (135–137) | 95.9–100.8 (5.74–6.04) | 16–16.1 (0.96) | 0 | 97–98 | 6.13–7.99 |
| school · mini-mission | 59.9–60.2 | 49.5–50 | 16.6–16.7 / 20–20.2 / 21.7–22.1 | 5.2 / 8.9–9.1 | 1.3 | 47 + 0 | 0 (0) 0 | 11.6 (—) | 353–357 (134–134) | 95.5–95.7 (5.72–5.73) | 15.9–15.9 (0.95) | 1.4 | 99–102 | 8.33–8.92 |
| school · check-4x | 60.2–60.6 | 48.3–48.8 | 16.5–16.6 / 20.5–20.7 / 40.4–198.2 | 7.4–7.5 / 12.6 | 1.5 | 49 + 0 | 0 (0) 0 | 34.1 (—) | 492–495 (91–94) | 60.3–61.1 (3.57–3.6) | 16.4–16.7 (0.98) | 1.3–1.5 | 98–100 | 8.57–9.3 |
| school · teleop | 59.9 | 52.1 | 16.7 / 19.2 / 20.6–20.8 | 6–6.1 / 8.3–8.5 | 1.4 | 43 + 0 | 0 (0) 0 | 11.9–12 (—) | 384–389 (130–131) | 125.1–125.5 (7.48–7.52) | 16.2–16.3 (0.97) | 0 | 98–99 | 6.9–8.45 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 4049–4287 | 559–697 | 2603–2822 | 908–1183 | 2739–2984 | 2959–3179 → 3005–3230 | 2703–2940 | 3848–4067 | 996–2345 (366–1248) | 254–1436 | 13 | 9.7 | — | — | 0 | 0 |
| school · drive-to-zone | 2601–2678 | 521–541 | 1230–1282 | 874–907 | 1354–1400 | 1586–1639 → 1635–1687 | 1322–1370 | 2228–2308 | 885–912 (360–373) | 249–252 | 13 | 7.8 | 80–91 | 43–44 | 0 | 0 |
| school · line-follow | 2572–2576 | 522–535 | 1253–1254 | 879–885 | 1383–1393 | 1606–1608 → 1654–1655 | 1351–1355 | 2064–2267 | 910–921 (358–367) | 261–263 | 13 | 9.7 | 84–86 | 44 | 0 | — |
| school · mini-mission | 2569 | 512–549 | 1260 | 873–901 | 1398–1401 | 1613 → 1658–1660 | 1369–1371 | 2193–2196 | 916–937 (354–367) | 262–267 | 12 | 9.9 | 85–86 | 42–44 | 0 | — |
| school · check-4x | 2557 | 529–533 | 1246–1260 | 882–887 | 1384–1401 | 1598–1614 → 1645–1662 | 1354–1370 | 2179–2182 | 915–924 (365–367) | 265–274 | 12 | 9.9 | — | — | 0 | — |
| school · teleop | 2604–2638 | 534–536 | 1215–1239 | 887–892 | 1324–1342 | 1568–1591 → 1628–1652 | 2087–2122 | 2247–2281 | 1445–1451 (457–458) | 235 | 13 | 10.4 | — | — | 0 | — |

## Where the main thread goes (profile pass, ms per animation frame, ranges over the repeats)

| profile · scenario | busy | sim | render (shadow map) | React | Blockly | scene callbacks | GC | browser (style, layout, paint, GL) | alloc/frame KB | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|
| school · line-follow | 7.64–7.65 | 1.69–1.78 | 1.48–1.56 (0) | 0.36–0.47 | 0–0.01 | 0.42–0.54 | 0.08–0.1 | 1.38–1.42 | 131.2–135 | 98–99 | 7.81–8.06 |
| school · mini-mission | 7.48–7.89 | 1.69–1.87 | 1.54 (0) | 0.38–0.44 | 0 | 0.64 | 0.11 | 1.39–1.52 | 169–170.2 | 99–101 | 8.85–8.86 |
| school · check-4x | 10.26–10.45 | 3.56–3.57 | 0.5–0.51 (0) | 0.86–0.87 | 0.01 | 0.29–0.31 | 0.15–0.17 | 2.12–2.13 | 355.3–357.6 | 97–99 | 8.53–9.08 |
| school · teleop | 7.67–7.72 | 1.93–1.96 | 1.5–1.56 (0) | 0.25–0.26 | 0 | 0.5–0.57 | 0.05–0.09 | 2.02–2.03 | 120.7–121 | 98 | 8.61–8.89 |

## The busiest sources (profile pass, self time in the window, ms; the first repeat)

- **school · line-follow** (8 s, 480 frames): (browser) 660; three/build/three.module.js 629; rapier.wasm 577; three/build/three.core.js 202; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/run/robot-run-session.ts 128; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/run/virtual-clock.ts 106; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 102; react-dom/cjs/react-dom-client.production.js 96. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; three/build/three.module.js 5 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/world.ts 5 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/units.ts 4 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/arena/ground-paint.ts 4 MiB
- **school · mini-mission** (8 s, 478 frames): (browser) 663; three/build/three.module.js 617; rapier.wasm 588; three/build/three.core.js 179; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/run/robot-run-session.ts 110; react-dom/cjs/react-dom-client.production.js 94; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/run/virtual-clock.ts 94; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 86. Allocates most: Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/ui/robot3d/camera-studio.ts 12 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/arena/ground-paint.ts 7 MiB; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; three/build/three.module.js 5 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/world.ts 4 MiB
- **school · check-4x** (34.5 s, 2025 frames): rapier.wasm 5020; (browser) 4323; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 1406; react-dom/cjs/react-dom-client.production.js 935; three/build/three.module.js 832; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/arena/ground-paint.ts 716; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/world.ts 593; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/run/virtual-clock.ts 581. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 78 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/world.ts 66 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/sensors/contacts.ts 51 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/robot/assembly.ts 48 MiB; @dimforge/rapier3d-deterministic/geometry/broad_phase.js 42 MiB
- **school · teleop** (8.1 s, 486 frames): (browser) 984; rapier.wasm 686; three/build/three.module.js 609; three/build/three.core.js 237; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 133; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/run/robot-run-session.ts 117; WebGL calls (through the bench probe) 106; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/world.ts 81. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/world.ts 5 MiB; three/build/three.module.js 5 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/units.ts 4 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/arena/ground-paint.ts 4 MiB

## Before the first frame (profile pass: navigation → the scene drawn, main thread self time by what ran, ms)

| profile · scenario | first frame | busy | three | blockly | react-dom | r3f | ui: robot3d | sim | webgl calls | browser | gc |
|---|---|---|---|---|---|---|---|---|---|---|---|
| school · line-follow | 2128–3953 | 1960–3469 | 851–943 | 194–292 | 78–101 | 71–77 | 0 | 5–7 | 20–28 | 231–1539 | 21–24 |
| school · mini-mission | 2090–2458 | 1865–1955 | 706–802 | 191–193 | 98–106 | 78–81 | 0 | 5–9 | 20–30 | 239–253 | 21–21 |
| school · check-4x | 2061–2067 | 1912–1923 | 701–789 | 193–204 | 88–100 | 77–81 | 0 | 5–9 | 22–26 | 234–267 | 19–25 |
| school · teleop | 2509–2548 | 1979–2002 | 847–878 | 172–180 | 94–95 | 68–76 | 0 | 5–6 | 25–25 | 257–267 | 18–26 |

- **school · line-follow**: (browser) 1539; three/build/three.module.js 732; blockly/blockly_compressed.js 283; three/build/three.core.js 135; react-dom/cjs/react-dom-client.production.js 101; @react-three/fiber/dist/events-9ce18a08.esm.js 74; (unknown) 67; react-use-measure/dist/index.js 62; three/examples/jsm/loaders/GLTFLoader.js 57; zod/v4/core/schemas.js 56
- **school · mini-mission**: three/build/three.module.js 566; (browser) 253; blockly/blockly_compressed.js 183; three/build/three.core.js 163; react-dom/cjs/react-dom-client.production.js 98; @react-three/fiber/dist/events-9ce18a08.esm.js 77; (unknown) 71; zod/v4/core/schemas.js 63; react-use-measure/dist/index.js 59; three/examples/jsm/loaders/GLTFLoader.js 53
- **school · check-4x**: three/build/three.module.js 566; (browser) 234; blockly/blockly_compressed.js 183; three/build/three.core.js 137; react-dom/cjs/react-dom-client.production.js 88; @react-three/fiber/dist/events-9ce18a08.esm.js 74; (unknown) 70; three/examples/jsm/loaders/GLTFLoader.js 62; react-use-measure/dist/index.js 58; zod/v4/core/schemas.js 54
- **school · teleop**: three/build/three.module.js 660; (browser) 267; blockly/blockly_compressed.js 170; three/build/three.core.js 139; react-dom/cjs/react-dom-client.production.js 94; (unknown) 68; @react-three/fiber/dist/events-9ce18a08.esm.js 64; react-use-measure/dist/index.js 58; zod/v4/core/schemas.js 56; three/examples/jsm/loaders/GLTFLoader.js 51

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| school · idle | 52 (40, 0) | 5 | 22 Lambert, 10 Basic, 3 Sprite | 51046 | 36370 | 13 | 9.7: 4.8 + 2.3 + 0 + 2.5 | MeshLambertMaterial 850×700 canvas aniso 8; birch_face 1024×128 ImageBitmap; walnut 256×256 ImageBitmap; pcb_teal 200×256 ImageBitmap |

## Bundle (gzip -6)

| file | bytes | gzip | holds |
|---|---|---|---|
| test-hooks-f6unhMn2.js | 1489736 | 422712 | — |
| RobotLab-DBvKAsuJ.js | 1440268 | 414560 | three, r3f, gltfLoader, meshopt |
| index-CAy5vDL4.js | 484533 | 146084 | — |
| rapier-DZ_EfFMH.js | 295823 | 52055 | rapier |
| rolldown-runtime-hePW80VL.js | 716 | 428 | — |
| rapier_wasm3d_bg-DZsYp9WG.wasm | 3105893 | 1180561 | |
| arena-props-low.glb | 242472 | 101999 | |
| arena-props.glb | 376440 | 190892 | |
| robot-kit-low.glb | 560668 | 218033 | |
| robot-kit.glb | 928072 | 411573 | |

Entry HTML loads: /favicon.svg, /assets/index-CAy5vDL4.js, /assets/rolldown-runtime-hePW80VL.js, /assets/test-hooks-f6unhMn2.js, /assets/index-CgMmDkmz.css.

## Served headers (vite preview)

| path | Cache-Control | Content-Encoding | ETag |
|---|---|---|---|
| / | no-cache | none | yes |
| /assets/RobotLab-*.js | no-cache | gzip | yes |
| /robot3d/robot-kit.glb?v=1 | no-cache | none | yes |
| /assets/rapier_wasm3d_bg-*.wasm | no-cache | none | yes |
