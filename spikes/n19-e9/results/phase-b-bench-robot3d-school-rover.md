# bench:robot3d — 2026-10-27T08:10:41.560Z — e9b-rover-school

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 8760350. Sensor overlays on (where the build has them). Repeats 2, window 8 s, soak 10 min, switches 20. 1-minute load average from 3.32–9.97 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 419.1 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | Run → moving (warm), every profile | 41 ms | ≤ 300 ms | ok | 6 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 16 | idle before a run, a parked robot, after an orbit settles |
| target | school: p95 frame time running at 1× | 19.7 ms | ≤ 33 ms | ok | 8 | every run scenario, low tier |
| target | school: p95 frame time running at 4× | 20.5 ms | ≤ 33 ms | ok | 2 | sim speed 4× and Kiểm tra 4× |
| target | school: long tasks > 100 ms during a run | 0  | ≤ 0  | ok | 10 | in the measuring window |
| target | school: first frame | 4364 ms | ≤ 2500 ms | not met | 12 | lesson page navigation → the scene drawn |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 59.9–60.2 | 53.2–54.1 | 16.6–16.7 / 18.5–18.8 / 19.3–19.9 | 2.4–2.5 / 3.7–4.3 | 1.4–1.5 | 41 + 0 | 0 (0) 0 | — (—) | 201–224 (116–122) | 87.3–88.7 (4.94–5.14) | 16–16.4 (0.93) | 2.4–2.7 | 92–97 | 3.32–4.93 |
| school · drive-to-zone | 59.9–60.2 | 52.6–52.9 | 16.6–16.7 / 18.9–19 / 20.2–20.9 | 4.4–4.5 / 7.4–7.5 | 1.2–1.3 | 42 + 0 | 0 (0) 0 | 10.2 (—) | 298–304 (119–122) | 79.3–80.3 (4.76–4.82) | 15.8–15.8 (0.95) | 0.2 | 92–95 | 4.84–5.57 |
| school · line-follow | 60.2 | 50.8–52.1 | 16.6 / 19.2–19.7 / 20.8–20.9 | 5.3–5.6 / 8.7–9.2 | 1.3–1.4 | 48 + 0 | 0 (0) 0 | 10.7–13 (—) | 362–366 (131–133) | 93.8–102.5 (5.62–6.14) | 16 (0.96) | 0 | 95–96 | 5.22–5.74 |
| school · mini-mission | 59.9–60.2 | 51.5–53.2 | 16.6–16.7 / 18.8–19.4 / 19.8–21.2 | 5.1–5.2 / 8.9–9.2 | 1.3–1.4 | 47 + 0 | 0 (0) 0 | 11.6–11.7 (—) | 349–355 (132–135) | 95.5–95.8 (5.72–5.74) | 16–16 (0.96) | 1.4 | 96–97 | 7.62–7.69 |
| school · check-4x | 60.2 | 48.8–49 | 16.6 / 20.4–20.5 / 52.4–212.5 | 6.8–6.9 / 12.3–12.4 | 1.5 | 49 + 0 | 0 (0) 0 | 34.1 (—) | 464–471 (87–90) | 60.6–61.3 (3.58–3.62) | 16.3–16.6 (0.97) | 1.3–1.4 | 97 | 8.61–9.79 |
| school · teleop | 59.9–60.2 | 52.4–52.6 | 16.6–16.7 / 19–19.1 / 20–21.3 | 5.8–6 / 8.2–8.9 | 1.4 | 43 + 0 | 0 (0) 0 | 11.9–12 (—) | 373–388 (129–135) | 124.2–125.1 (7.43–7.49) | 16.2–16.3 (0.97) | 0 | 94–98 | 6.75–7.58 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 4054–4364 | 502–760 | 2560–2894 | 856–1246 | 2720–3051 | 2925–3250 → 2970–3308 | 2678–3010 | 3843–4148 | 974–2334 (349–1242) | 294–1437 | 13 | 9.7 | — | — | 0 | 0 |
| school · drive-to-zone | 2548–2555 | 488–506 | 1179–1196 | 844–862 | 1284–1316 | 1527–1553 → 1573–1598 | 1257–1284 | 2176–2177 | 825–849 (332–348) | 223–234 | 13 | 7.8 | 74–87 | 41 | 0 | 0 |
| school · line-follow | 2512–2559 | 504–509 | 1203–1232 | 861–867 | 1326–1360 | 1555–1589 → 1599–1641 | 1297–1330 | 2047–2188 | 858–863 (335–344) | 243–256 | 13 | 9.7 | 81–87 | 41 | 0 | — |
| school · mini-mission | 2490–2506 | 467–499 | 1168–1205 | 826–854 | 1301–1344 | 1523–1558 → 1569–1608 | 1274–1315 | 2116–2132 | 837–879 (303–344) | 255–256 | 12 | 9.9 | 81–84 | 41 | 0 | — |
| school · check-4x | 2519–2541 | 502–504 | 1213 | 858–866 | 1343–1373 | 1563–1565 → 1607 | 1314–1334 | 2148–2175 | 886–891 (342–346) | 245–282 | 12 | 9.9 | — | — | 0 | — |
| school · teleop | 2575–2623 | 514–518 | 1193–1194 | 864–875 | 1296–1305 | 1540–1543 → 1596–1599 | 2058–2108 | 2060–2266 | 1354–1401 (461–495) | 227–233 | 13 | 10.4 | — | — | 0 | — |

## Where the main thread goes (profile pass, ms per animation frame, ranges over the repeats)

| profile · scenario | busy | sim | render (shadow map) | React | Blockly | scene callbacks | GC | browser (style, layout, paint, GL) | alloc/frame KB | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|
| school · line-follow | 7.41–7.57 | 1.66–1.69 | 1.51 (0) | 0.31–0.44 | 0–0.01 | 0.41–0.43 | 0.09 | 1.29–1.41 | 133.1–135 | 95–97 | 8.23–8.26 |
| school · mini-mission | 7.5–7.51 | 1.59–1.61 | 1.43–1.53 (0) | 0.38–0.4 | 0 | 0.61–0.67 | 0.1–0.11 | 1.43–1.55 | 170.8–171.1 | 95–97 | 6.9–8.37 |
| school · check-4x | 10.17–10.2 | 3.34–3.43 | 0.49 (0) | 0.84–0.87 | 0.01–0.02 | 0.32 | 0.16–0.2 | 2.09–2.18 | 360.2–363.7 | 97–98 | 8.61–9.03 |
| school · teleop | 7.46–7.66 | 1.9–2.04 | 1.42–1.47 (0) | 0.23–0.24 | 0 | 0.48–0.58 | 0.09–0.11 | 1.91–2.02 | 120–121 | 98–99 | 9.82–9.97 |

## The busiest sources (profile pass, self time in the window, ms; the first repeat)

- **school · line-follow** (8 s, 481 frames): (browser) 619; three/build/three.module.js 590; rapier.wasm 540; three/build/three.core.js 183; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/run/robot-run-session.ts 158; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 132; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/run/virtual-clock.ts 115; WebGL calls (through the bench probe) 100. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; three/build/three.module.js 5 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/world.ts 5 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/units.ts 4 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/arena/ground-paint.ts 4 MiB
- **school · mini-mission** (8 s, 477 frames): (browser) 682; three/build/three.module.js 598; rapier.wasm 570; three/build/three.core.js 198; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/run/robot-run-session.ts 125; react-dom/cjs/react-dom-client.production.js 92; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/run/virtual-clock.ts 90; WebGL calls (through the bench probe) 79. Allocates most: Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/ui/robot3d/camera-studio.ts 13 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/arena/ground-paint.ts 7 MiB; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; three/build/three.module.js 6 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/world.ts 4 MiB
- **school · check-4x** (34.5 s, 2026 frames): rapier.wasm 4659; (browser) 4232; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 1459; react-dom/cjs/react-dom-client.production.js 932; three/build/three.module.js 795; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/arena/ground-paint.ts 610; WebGL calls (through the bench probe) 603; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/world.ts 554. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 71 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/world.ts 66 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/sensors/contacts.ts 50 MiB; @dimforge/rapier3d-deterministic/pipeline/world.js 46 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/ui/robot3d/camera-studio.ts 46 MiB
- **school · teleop** (8.1 s, 488 frames): (browser) 934; rapier.wasm 659; three/build/three.module.js 608; three/build/three.core.js 192; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 128; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/run/robot-run-session.ts 115; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/world.ts 98; WebGL calls (through the bench probe) 80. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/world.ts 5 MiB; three/build/three.module.js 4 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/units.ts 4 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/arena/ground-paint.ts 4 MiB

## Before the first frame (profile pass: navigation → the scene drawn, main thread self time by what ran, ms)

| profile · scenario | first frame | busy | three | blockly | react-dom | r3f | ui: robot3d | sim | webgl calls | browser | gc |
|---|---|---|---|---|---|---|---|---|---|---|---|
| school · line-follow | 2103–4002 | 1946–3656 | 848–1147 | 182–259 | 84–92 | 74–79 | 0 | 5–7 | 24–24 | 252–1552 | 22–27 |
| school · mini-mission | 2065–2090 | 1901–1938 | 802–809 | 182–191 | 87–98 | 69–79 | 0 | 3–7 | 23–25 | 235–243 | 21–25 |
| school · check-4x | 2015–2069 | 1850–1933 | 783–788 | 173–185 | 87–89 | 74–89 | 0 | 5–5 | 23–27 | 232–245 | 27–28 |
| school · teleop | 2039–2542 | 1820–1959 | 736–847 | 176–178 | 80–106 | 66–74 | 0 | 7–7 | 25–29 | 247–256 | 17–23 |

- **school · line-follow**: (browser) 1552; three/build/three.module.js 922; blockly/blockly_compressed.js 252; three/build/three.core.js 133; react-dom/cjs/react-dom-client.production.js 92; @react-three/fiber/dist/events-9ce18a08.esm.js 69; three/examples/jsm/loaders/GLTFLoader.js 68; (unknown) 63; react-use-measure/dist/index.js 62; zod/v4/core/schemas.js 51
- **school · mini-mission**: three/build/three.module.js 583; (browser) 243; blockly/blockly_compressed.js 181; three/build/three.core.js 151; react-dom/cjs/react-dom-client.production.js 98; @react-three/fiber/dist/events-9ce18a08.esm.js 67; (unknown) 63; react-use-measure/dist/index.js 63; three/examples/jsm/loaders/GLTFLoader.js 56; zod/v4/core/schemas.js 43
- **school · check-4x**: three/build/three.module.js 569; (browser) 232; blockly/blockly_compressed.js 165; three/build/three.core.js 143; react-dom/cjs/react-dom-client.production.js 89; @react-three/fiber/dist/events-9ce18a08.esm.js 65; (unknown) 61; react-use-measure/dist/index.js 57; zod/v4/core/schemas.js 51; three/examples/jsm/loaders/GLTFLoader.js 51
- **school · teleop**: three/build/three.module.js 534; (browser) 247; blockly/blockly_compressed.js 168; three/build/three.core.js 127; react-dom/cjs/react-dom-client.production.js 106; @react-three/fiber/dist/events-9ce18a08.esm.js 62; zod/v4/core/schemas.js 62; react-use-measure/dist/index.js 60; (unknown) 59; three/examples/jsm/loaders/GLTFLoader.js 56

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| school · idle | 52 (40, 0) | 5 | 22 Lambert, 10 Basic, 3 Sprite | 51046 | 36370 | 13 | 9.7: 4.8 + 2.3 + 0 + 2.5 | MeshLambertMaterial 850×700 canvas aniso 8; birch_face 1024×128 ImageBitmap; walnut 256×256 ImageBitmap; pcb_teal 200×256 ImageBitmap |

## Bundle (gzip -6)

| file | bytes | gzip | holds |
|---|---|---|---|
| test-hooks-f6unhMn2.js | 1489736 | 422712 | — |
| RobotLab-C-g1jzYv.js | 1451949 | 419065 | three, r3f, gltfLoader, meshopt |
| index-BTFSF14i.js | 484533 | 146082 | — |
| rapier-DZ_EfFMH.js | 295823 | 52055 | rapier |
| rolldown-runtime-hePW80VL.js | 716 | 428 | — |
| rapier_wasm3d_bg-DZsYp9WG.wasm | 3105893 | 1180561 | |
| arena-props-low.glb | 242472 | 101999 | |
| arena-props.glb | 376440 | 190892 | |
| robot-kit-low.glb | 560644 | 218123 | |
| robot-kit.glb | 928028 | 411784 | |

Entry HTML loads: /favicon.svg, /assets/index-BTFSF14i.js, /assets/rolldown-runtime-hePW80VL.js, /assets/test-hooks-f6unhMn2.js, /assets/index-CgMmDkmz.css.

## Served headers (vite preview)

| path | Cache-Control | Content-Encoding | ETag |
|---|---|---|---|
| / | no-cache | none | yes |
| /assets/RobotLab-*.js | no-cache | gzip | yes |
| /robot3d/robot-kit.glb?v=1 | no-cache | none | yes |
| /assets/rapier_wasm3d_bg-*.wasm | no-cache | none | yes |
