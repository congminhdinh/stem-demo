# bench:robot3d — 2026-10-25T19:02:57.387Z — before-school-3

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 592ec41. Sensor overlays on (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 2.83–5.36 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 383.7 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | Run → moving (warm), every profile | 45 ms | ≤ 300 ms | ok | 2 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 5 | idle before a run, a parked robot, after an orbit settles |
| target | school: p95 frame time running at 1× | 19.8 ms | ≤ 33 ms | ok | 2 | every run scenario, low tier |
| target | school: p95 frame time running at 4× | 21.9 ms | ≤ 33 ms | ok | 1 | sim speed 4× and Kiểm tra 4× |
| target | school: long tasks > 100 ms during a run | 1  | ≤ 0  | not met | 3 | in the measuring window |
| target | school: first frame | 3954 ms | ≤ 2500 ms | not met | 4 | lesson page navigation → the scene drawn |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 60.2 | 53.2 | 16.6 / 18.8 / 19.1 | 1.8 / 3.6 | 1.1 | 41 + 0 | 0 (0) 0 | — (—) | 171 (89) | 91.5 (5.19) | 16.1 (0.92) | 2.8 | 87 | 2.83 |
| school · line-follow | 60.2 | 50.5 | 16.6 / 19.8 / 20.7 | 3.8 / 7.9 | 1.1 | 48 + 0 | 0 (0) 0 | 13 (—) | 271 (106) | 106.9 (6.41) | 15.7 (0.94) | 0 | 87 | 3.23 |
| school · mini-mission | 60.2 | 51 | 16.6 / 19.6 / 20.7 | 3.6 / 7.1 | 1.1 | 47 + 0 | 1 (0) 53 | 11.6 (—) | 258 (109) | 100.5 (6) | 15.7 (0.94) | 1.4 | 89 | 3.01 |
| school · check-4x | 60.2 | 45.7 | 16.6 / 21.9 / 77.8 | 5.3 / 10.3 | 1.2 | 49 + 0 | 20 (1) 323 | 33.6 (—) | 404 (95) | 65.6 (3.79) | 16.9 (0.98) | 1.3 | 91 | 5.36 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 3954 | 558 | 2541 | 923 | 2705 | 2891 → 2937 | 2674 | 3762 | 989 (353) | 268 | 13 | 9.7 | — | — | 0 | 0 |
| school · line-follow | 2464 | 432 | 1043 | 778 | 1190 | 1386 → 1428 | 1166 | 1952 | 707 (291) | 244 | 13 | 9.7 | 391 | 45 | 0 | — |
| school · mini-mission | 2410 | 456 | 1089 | 812 | 1320 | 1475 → 1518 | 1292 | 2037 | 827 (307) | 328 | 12 | 9.9 | 368 | 41 | 0 | — |
| school · check-4x | 2360 | 449 | 1063 | 793 | 1283 | 1435 → 1477 | 1257 | 1994 | 799 (308) | 317 | 12 | 9.9 | — | — | 0 | — |

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
