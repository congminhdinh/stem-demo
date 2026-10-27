# bench:robot3d — 2026-10-27T02:35:37.499Z — e910-rover-B2-branch

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 46a3f82. Sensor overlays on (where the build has them). Repeats 2, window 8 s, soak 10 min, switches 20. 1-minute load average from 5.39–9.6 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 414.6 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | Run → moving (warm), every profile | 45 ms | ≤ 300 ms | ok | 6 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 16 | idle before a run, a parked robot, after an orbit settles |
| target | school: p95 frame time running at 1× | 19.8 ms | ≤ 33 ms | ok | 8 | every run scenario, low tier |
| target | school: p95 frame time running at 4× | 20.7 ms | ≤ 33 ms | ok | 2 | sim speed 4× and Kiểm tra 4× |
| target | school: long tasks > 100 ms during a run | 0  | ≤ 0  | ok | 10 | in the measuring window |
| target | school: first frame | 4046 ms | ≤ 2500 ms | not met | 12 | lesson page navigation → the scene drawn |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 59.9 | 52.6–53.2 | 16.7 / 18.8–19 / 19.5–19.8 | 2.6–2.7 / 3.7 | 1.5 | 41 + 0 | 0 (0) 0 | — (—) | 213–213 (119–123) | 87.3–89.8 (5.13–5.22) | 15.8–16 (0.93) | 2.5 | 98–100 | 5.52–6.07 |
| school · drive-to-zone | 60.2 | 51.3 | 16.6 / 19.5 / 20.8–20.9 | 4.5–4.9 / 8.1–8.2 | 1.3–1.4 | 42 + 0 | 0 (0) 0 | 10–10.2 (—) | 309–324 (120–129) | 80.5–81.1 (4.81–4.87) | 15.8–15.9 (0.95) | 0.2 | 99 | 5.39–6.49 |
| school · line-follow | 59.9–60.2 | 51–51.8 | 16.6–16.7 / 19.3–19.6 / 20.5–20.7 | 5.5–5.6 / 8.8–9 | 1.4 | 48 + 0 | 0 (0) 0 | 10.7 (—) | 367–374 (130–132) | 93.3–95.3 (5.59–5.71) | 15.9–16 (0.96) | 0 | 97–98 | 7.02–7.15 |
| school · mini-mission | 60.2 | 51–51.8 | 16.6 / 19.3–19.6 / 20.5–20.6 | 5.2–5.6 / 9.3–9.6 | 1.4 | 47 + 0 | 0 (0) 0 | 11.6–11.7 (—) | 363–382 (136–141) | 93–95.6 (5.57–5.73) | 15.9–16 (0.96) | 1.4 | 98–99 | 7.05–8.23 |
| school · check-4x | 59.9 | 48.3–48.5 | 16.7 / 20.6–20.7 / 39.2–164.3 | 7.2–7.4 / 12.6 | 1.4–1.5 | 49 + 0 | 0 (0) 0 | 34.1–34.2 (—) | 485–494 (90–91) | 59.8–62.2 (3.57–3.63) | 16.3–16.7 (0.98) | 1.3–1.5 | 98 | 7.97–8.83 |
| school · teleop | 59.5–59.9 | 50.5–52.9 | 16.7–16.8 / 18.9–19.8 / 19.8–20.7 | 6.1 / 8.3–8.5 | 1.5 | 43 + 0 | 0 (0) 0 | 12 (—) | 390–391 (136–136) | 122.5–123.9 (7.34–7.42) | 16.3 (0.97) | 0 | 99–100 | 7.59–8.05 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 4032–4046 | 539–545 | 2601–2607 | 898–901 | 2739–2746 | 2957–2959 → 3004–3008 | 2703–2709 | 3836–3839 | 1000–1011 (363–370) | 257–261 | 13 | 9.7 | — | — | 0 | 0 |
| school · drive-to-zone | 2616–2661 | 523–554 | 1245–1281 | 870–917 | 1368–1397 | 1602–1637 → 1648–1685 | 1334–1371 | 2245–2293 | 896–904 (360–363) | 244–250 | 13 | 7.8 | 80–82 | 42–45 | 0 | 0 |
| school · line-follow | 2526–2542 | 518–523 | 1214–1216 | 866–876 | 1340–1345 | 1567–1572 → 1615–1619 | 1311–1314 | 2205–2224 | 886 (356–361) | 244–247 | 13 | 9.7 | 85–86 | 45 | 0 | — |
| school · mini-mission | 2534–2605 | 523–529 | 1224–1300 | 873–904 | 1370–1447 | 1577–1658 → 1625–1702 | 1333–1413 | 2163–2233 | 907–963 (360–366) | 263–279 | 12 | 9.9 | 85–88 | 42–44 | 0 | — |
| school · check-4x | 2538–2607 | 526–538 | 1244–1291 | 884–907 | 1386–1439 | 1599–1646 → 1645–1694 | 1357–1408 | 2164–2234 | 914–943 (359–368) | 269–282 | 12 | 9.9 | — | — | 0 | — |
| school · teleop | 2588–2675 | 521–547 | 1198–1272 | 868–923 | 1301–1381 | 1549–1624 → 1607–1688 | 2072–2158 | 2230–2316 | 1388–1460 (459–463) | 229–242 | 13 | 10.4 | — | — | 0 | — |

## Where the main thread goes (profile pass, ms per animation frame, ranges over the repeats)

| profile · scenario | busy | sim | render (shadow map) | React | Blockly | scene callbacks | GC | browser (style, layout, paint, GL) | alloc/frame KB | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|
| school · line-follow | 7.69–7.74 | 1.65–1.77 | 1.51–1.52 (0) | 0.41–0.49 | 0–0.01 | 0.45 | 0.08–0.11 | 1.45–1.48 | 136.3–136.6 | 98–99 | 8.41–8.91 |
| school · mini-mission | 7.4–7.79 | 1.69–1.76 | 1.48–1.61 (0) | 0.37–0.42 | 0–0.01 | 0.63–0.66 | 0.09 | 1.3–1.41 | 169.6–170.1 | 98 | 8.87–9.35 |
| school · check-4x | 10.1–10.42 | 3.45–3.57 | 0.49–0.53 (0) | 0.85–0.86 | 0.01–0.02 | 0.3–0.31 | 0.16–0.17 | 2.12–2.14 | 355.5–359.5 | 100–104 | 8.21–9.6 |
| school · teleop | 7.65–7.72 | 1.97–2.02 | 1.54–1.55 (0) | 0.22–0.26 | 0 | 0.54–0.58 | 0.08 | 1.98–2.01 | 120.2–121.8 | 99–101 | 8.23–8.65 |

## The busiest sources (profile pass, self time in the window, ms; the first repeat)

- **school · line-follow** (8 s, 482 frames): (browser) 699; three/build/three.module.js 609; rapier.wasm 589; three/build/three.core.js 191; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/run/virtual-clock.ts 133; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 132; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/run/robot-run-session.ts 112; react-dom/cjs/react-dom-client.production.js 93. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; three/build/three.module.js 5 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/units.ts 4 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/world.ts 4 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/arena/ground-paint.ts 4 MiB
- **school · mini-mission** (8 s, 478 frames): (browser) 675; three/build/three.module.js 642; rapier.wasm 605; three/build/three.core.js 184; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/run/robot-run-session.ts 119; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/run/virtual-clock.ts 102; WebGL calls (through the bench probe) 102; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 92. Allocates most: Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/ui/robot3d/camera-studio.ts 12 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/arena/ground-paint.ts 7 MiB; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; three/build/three.module.js 5 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/units.ts 4 MiB
- **school · check-4x** (34.5 s, 2025 frames): rapier.wasm 4968; (browser) 4332; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 1494; react-dom/cjs/react-dom-client.production.js 945; three/build/three.module.js 864; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/arena/ground-paint.ts 619; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/run/virtual-clock.ts 595; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/world.ts 583. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 77 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/world.ts 67 MiB; @dimforge/rapier3d-deterministic/pipeline/world.js 63 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/sensors/contacts.ts 51 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/robot/assembly.ts 48 MiB
- **school · teleop** (8.1 s, 488 frames): (browser) 968; rapier.wasm 703; three/build/three.module.js 616; three/build/three.core.js 217; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 133; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/world.ts 113; WebGL calls (through the bench probe) 99; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/run/robot-run-session.ts 83. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/world.ts 5 MiB; three/build/three.module.js 5 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/units.ts 4 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/arena/ground-paint.ts 4 MiB

## Before the first frame (profile pass: navigation → the scene drawn, main thread self time by what ran, ms)

| profile · scenario | first frame | busy | three | blockly | react-dom | r3f | ui: robot3d | sim | webgl calls | browser | gc |
|---|---|---|---|---|---|---|---|---|---|---|---|
| school · line-follow | 1984–3914 | 1994–3620 | 859–1129 | 190–280 | 89–90 | 73–76 | 0 | 7–10 | 23–30 | 246–1514 | 26–26 |
| school · mini-mission | 1997–2087 | 1843–1951 | 694–790 | 197–202 | 97–98 | 75–80 | 0 | 5–9 | 26–28 | 252–252 | 25–26 |
| school · check-4x | 1996–2070 | 1847–1925 | 700–794 | 188–195 | 95–98 | 73–79 | 0 | 4–5 | 22–25 | 243–248 | 19–22 |
| school · teleop | 2503–2525 | 1944–1965 | 860–864 | 172–177 | 89–92 | 67–68 | 0 | 4–7 | 28–29 | 240–246 | 20–23 |

- **school · line-follow**: (browser) 1514; three/build/three.module.js 889; blockly/blockly_compressed.js 271; three/build/three.core.js 167; react-dom/cjs/react-dom-client.production.js 90; @react-three/fiber/dist/events-9ce18a08.esm.js 75; (unknown) 63; react-use-measure/dist/index.js 57; zod/v4/core/schemas.js 54; three/examples/jsm/loaders/GLTFLoader.js 48
- **school · mini-mission**: three/build/three.module.js 563; (browser) 252; blockly/blockly_compressed.js 193; three/build/three.core.js 147; react-dom/cjs/react-dom-client.production.js 98; @react-three/fiber/dist/events-9ce18a08.esm.js 75; three/examples/jsm/loaders/GLTFLoader.js 61; react-use-measure/dist/index.js 60; zod/v4/core/schemas.js 59; (unknown) 59
- **school · check-4x**: three/build/three.module.js 562; (browser) 248; blockly/blockly_compressed.js 179; three/build/three.core.js 152; react-dom/cjs/react-dom-client.production.js 98; @react-three/fiber/dist/events-9ce18a08.esm.js 76; (unknown) 60; react-use-measure/dist/index.js 57; three/examples/jsm/loaders/GLTFLoader.js 56; zod/v4/core/schemas.js 54
- **school · teleop**: three/build/three.module.js 641; (browser) 246; blockly/blockly_compressed.js 168; three/build/three.core.js 136; react-dom/cjs/react-dom-client.production.js 92; (unknown) 67; @react-three/fiber/dist/events-9ce18a08.esm.js 65; react-use-measure/dist/index.js 58; three/examples/jsm/loaders/GLTFLoader.js 54; zod/v4/core/schemas.js 53

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
