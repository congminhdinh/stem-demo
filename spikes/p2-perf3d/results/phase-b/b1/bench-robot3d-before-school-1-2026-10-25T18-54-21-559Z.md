# bench:robot3d — 2026-10-25T18:54:21.559Z — before-school-1

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 592ec41. Sensor overlays on (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 1.18–3.63 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 383.7 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | Run → moving (warm), every profile | 41 ms | ≤ 300 ms | ok | 2 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 5 | idle before a run, a parked robot, after an orbit settles |
| target | school: p95 frame time running at 1× | 19.5 ms | ≤ 33 ms | ok | 2 | every run scenario, low tier |
| target | school: p95 frame time running at 4× | 22 ms | ≤ 33 ms | ok | 1 | sim speed 4× and Kiểm tra 4× |
| target | school: long tasks > 100 ms during a run | 1  | ≤ 0  | not met | 3 | in the measuring window |
| target | school: first frame | 3705 ms | ≤ 2500 ms | not met | 4 | lesson page navigation → the scene drawn |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 60.6 | 53.5 | 16.5 / 18.7 / 19.2 | 2.2 / 4.4 | 1.2 | 41 + 0 | 0 (0) 0 | — (—) | 198 (97) | 90.6 (5.11) | 16.3 (0.92) | 2.6 | 91 | 1.34 |
| school · line-follow | 59.9 | 51.3 | 16.7 / 19.5 / 20.5 | 3.5 / 6.4 | 1.1 | 48 + 0 | 0 (0) 0 | 10.7 (—) | 237 (96) | 100.2 (6) | 15.5 (0.93) | 0 | 87 | 1.18 |
| school · mini-mission | 59.9 | 51.5 | 16.7 / 19.4 / 21 | 3.6 / 6.9 | 1 | 47 + 0 | 0 (0) 0 | 11.6 (—) | 258 (108) | 100.4 (5.99) | 15.7 (0.94) | 1.4 | 86 | 3.11 |
| school · check-4x | 60.2 | 45.5 | 16.6 / 22 / 74.4 | 5.2 / 10.3 | 1.2 | 49 + 0 | 17 (1) 309 | 33.3 (—) | 398 (96) | 65.4 (3.73) | 16.9 (0.97) | 1.3 | 86 | 3.63 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 3705 | 561 | 2534 | 941 | 2705 | 2888 → 2934 | 2668 | 3692 | 1006 (364) | 269 | 13 | 9.7 | — | — | 0 | 0 |
| school · line-follow | 2330 | 444 | 1065 | 794 | 1214 | 1411 → 1452 | 1190 | 2017 | 702 (284) | 246 | 13 | 9.7 | 381 | 41 | 0 | — |
| school · mini-mission | 2346 | 423 | 1033 | 771 | 1288 | 1408 → 1451 | 1215 | 1968 | 755 (283) | 349 | 12 | 9.9 | 367 | 40 | 0 | — |
| school · check-4x | 2360 | 459 | 1076 | 806 | 1291 | 1438 → 1479 | 1267 | 1988 | 793 (298) | 313 | 12 | 9.9 | — | — | 0 | — |

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| school · idle | 52 (40, 0) | 5 | 22 Lambert, 10 Basic, 3 Sprite | 51046 | 36370 | 13 | 9.7: 4.8 + 2.3 + 0 + 2.5 | MeshLambertMaterial 850×700 canvas aniso 8; birch_face 1024×128 ImageBitmap; walnut 256×256 ImageBitmap; pcb_teal 200×256 ImageBitmap |

## Bundle (gzip -6)

| file | bytes | gzip | holds |
|---|---|---|---|
| test-hooks-BmzOF-lf.js | 1442708 | 410376 | — |
| RobotLab-D7MerzQc.js | 1343941 | 383677 | three, r3f, gltfLoader, meshopt |
| index-DiEeYWJM.js | 483855 | 145815 | — |
| rapier-DZ_EfFMH.js | 295823 | 52055 | rapier |
| rolldown-runtime-hePW80VL.js | 716 | 428 | — |
| rapier_wasm3d_bg-DZsYp9WG.wasm | 3105893 | 1180561 | |
| arena-props-low.glb | 194772 | 83286 | |
| arena-props.glb | 303372 | 150186 | |
| robot-kit-low.glb | 495220 | 196824 | |
| robot-kit.glb | 826656 | 369080 | |

Entry HTML loads: /favicon.svg, /assets/index-DiEeYWJM.js, /assets/rolldown-runtime-hePW80VL.js, /assets/test-hooks-BmzOF-lf.js, /assets/index-CgMmDkmz.css.

## Served headers (vite preview)

| path | Cache-Control | Content-Encoding | ETag |
|---|---|---|---|
| / | no-cache | none | yes |
| /assets/RobotLab-*.js | no-cache | gzip | yes |
| /robot3d/robot-kit.glb?v=1 | no-cache | none | yes |
| /assets/rapier_wasm3d_bg-*.wasm | no-cache | none | yes |
