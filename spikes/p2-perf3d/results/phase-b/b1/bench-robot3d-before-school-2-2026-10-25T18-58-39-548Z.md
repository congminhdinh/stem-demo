# bench:robot3d — 2026-10-25T18:58:39.548Z — before-school-2

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 592ec41. Sensor overlays on (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 3.09–5.14 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 383.7 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | Run → moving (warm), every profile | 41 ms | ≤ 300 ms | ok | 2 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 5 | idle before a run, a parked robot, after an orbit settles |
| target | school: p95 frame time running at 1× | 19.7 ms | ≤ 33 ms | ok | 2 | every run scenario, low tier |
| target | school: p95 frame time running at 4× | 21 ms | ≤ 33 ms | ok | 1 | sim speed 4× and Kiểm tra 4× |
| target | school: long tasks > 100 ms during a run | 1  | ≤ 0  | not met | 3 | in the measuring window |
| target | school: first frame | 3984 ms | ≤ 2500 ms | not met | 4 | lesson page navigation → the scene drawn |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 61 | 52.9 | 16.4 / 18.9 / 19.8 | 1.7 / 3.4 | 1.2 | 41 + 0 | 0 (0) 0 | — (—) | 171 (87) | 91 (5.12) | 16.2 (0.91) | 2.5 | 87 | 3.09 |
| school · line-follow | 60.2 | 50.8 | 16.6 / 19.7 / 20.5 | 3.7 / 7.3 | 1.1 | 48 + 0 | 0 (0) 0 | 13 (—) | 262 (103) | 107.2 (6.42) | 15.6 (0.94) | 0 | 88 | 3.63 |
| school · mini-mission | 60.2 | 51.5 | 16.6 / 19.4 / 21.2 | 3.7 / 7.6 | 1.1 | 47 + 0 | 1 (0) 53 | 11.6 (—) | 269 (111) | 99.4 (5.93) | 15.7 (0.94) | 1.4 | 89 | 5.11 |
| school · check-4x | 59.9 | 47.6 | 16.7 / 21 / 76.6 | 5.2 / 10 | 1.2 | 49 + 0 | 19 (1) 307 | 33.4 (—) | 391 (92) | 65.2 (3.74) | 16.9 (0.97) | 1.4 | 91 | 5.14 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 3984 | 566 | 2567 | 958 | 2735 | 2915 → 2962 | 2701 | 3765 | 992 (353) | 268 | 13 | 9.7 | — | — | 0 | 0 |
| school · line-follow | 2336 | 432 | 1045 | 777 | 1192 | 1389 → 1434 | 1167 | 2023 | 711 (291) | 240 | 13 | 9.7 | 377 | 41 | 0 | — |
| school · mini-mission | 2359 | 445 | 1060 | 791 | 1278 | 1429 → 1470 | 1251 | 1992 | 793 (301) | 316 | 12 | 9.9 | 377 | 41 | 0 | — |
| school · check-4x | 2399 | 447 | 1070 | 796 | 1285 | 1438 → 1482 | 1260 | 2025 | 800 (302) | 313 | 12 | 9.9 | — | — | 0 | — |

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
