# bench:robot3d — 2026-10-25T22:14:11.259Z — final-school-2

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 7661d33. Sensor overlays on (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 5.75–10.32 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 386.1 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | Run → moving (warm), every profile | 46 ms | ≤ 300 ms | ok | 3 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 8 | idle before a run, a parked robot, after an orbit settles |
| target | school: p95 frame time running at 1× | 19.6 ms | ≤ 33 ms | ok | 5 | every run scenario, low tier |
| target | school: p95 frame time running at 4× | 20.8 ms | ≤ 33 ms | ok | 1 | sim speed 4× and Kiểm tra 4× |
| target | school: long tasks > 100 ms during a run | 0  | ≤ 0  | ok | 6 | in the measuring window |
| target | school: first frame | 4025 ms | ≤ 2500 ms | not met | 7 | lesson page navigation → the scene drawn |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 59.9 | 52.4 | 16.7 / 19.1 / 19.6 | 2.1 / 3.7 | 1.4 | 41 + 0 | 0 (0) 0 | — (—) | 197 (112) | 93 (5.4) | 15.9 (0.92) | 2.8 | 99 | 5.75 |
| school · line-follow | 60.2 | 51 | 16.6 / 19.6 / 20.6 | 5.2 / 9 | 1.3 | 48 + 0 | 0 (0) 0 | 12.9 (—) | 352 (131) | 101.7 (6.1) | 15.9 (0.96) | 0 | 99 | 6.55 |
| school · mini-mission | 59.5 | 51.5 | 16.8 / 19.4 / 21.1 | 4.7 / 8.5 | 1.3 | 47 + 0 | 0 (0) 0 | 11.6 (—) | 330 (126) | 97.9 (5.87) | 15.8 (0.95) | 1.4 | 97 | 8.55 |
| school · check-1x | 59.9 | 51.3 | 16.7 / 19.5 / 21.5 | 4.7 / 8.4 | 1.3 | 47 + 0 | 0 (0) 0 | 13 (—) | 335 (129) | 103.2 (6.19) | 15.9 (0.95) | 1.4 | 98 | 9.31 |
| school · check-4x | 59.9 | 48.1 | 16.7 / 20.8 / 123.9 | 6.7 / 11.5 | 1.4 | 49 + 0 | 0 (0) 0 | 33.7 (—) | 439 (82) | 61.1 (3.54) | 16.7 (0.96) | 1.3 | 96 | 8.6 |
| school · follow | 59.9 | 53.2 | 16.7 / 18.8 / 19.8 | 4.4 / 7.9 | 1.1 | 42 + 0 | 0 (0) 0 | 12.6 (—) | 309 (108) | 98.2 (5.88) | 15.8 (0.94) | 0 | 99 | 10.32 |
| school · teleop | 60.2 | 51 | 16.6 / 19.6 / 21.4 | 5.4 / 7.6 | 1.4 | 43 + 0 | 0 (0) 0 | 11.9 (—) | 345 (124) | 126.4 (7.57) | 16.1 (0.97) | 0 | 101 | 9.51 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 4025 | 508 | 2569 | 857 | 2701 | 2922 → 2972 | 2670 | 3824 | 939 (344) | 238 | 13 | 9.7 | — | — | 0 | 0 |
| school · line-follow | 2507 | 506 | 1192 | 854 | 1322 | 1547 → 1594 | 1296 | 1996 | 853 (347) | 246 | 13 | 9.7 | 78 | 46 | 0 | — |
| school · mini-mission | 2500 | 497 | 1187 | 856 | 1323 | 1539 → 1588 | 1295 | 2133 | 840 (339) | 237 | 12 | 9.9 | 78 | 43 | 0 | — |
| school · check-1x | 2499 | 497 | 1188 | 857 | 1318 | 1539 → 1583 | 1294 | 2136 | 792 (338) | 236 | 12 | 9.9 | — | — | 0 | — |
| school · check-4x | 2482 | 500 | 1185 | 856 | 1318 | 1539 → 1585 | 1295 | 2115 | 800 (340) | 236 | 12 | 9.9 | — | — | 0 | — |
| school · follow | 2489 | 485 | 1169 | 840 | 1288 | 1522 → 1571 | 1267 | 2163 | 824 (333) | 227 | 13 | 9.7 | 96 | 44 | 0 | — |
| school · teleop | 2581 | 488 | 1144 | 844 | 1256 | 1498 → 1556 | 2066 | 2234 | 1313 (504) | 217 | 13 | 10.4 | — | — | 0 | — |

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| school · idle | 52 (40, 0) | 5 | 22 Lambert, 10 Basic, 3 Sprite | 51046 | 36370 | 13 | 9.7: 4.8 + 2.3 + 0 + 2.5 | MeshLambertMaterial 850×700 canvas aniso 8; birch_face 1024×128 ImageBitmap; walnut 256×256 ImageBitmap; pcb_teal 200×256 ImageBitmap |

## Bundle (gzip -6)

| file | bytes | gzip | holds |
|---|---|---|---|
| test-hooks-DEejnb95.js | 1447064 | 411816 | — |
| RobotLab-BTFZ3RXO.js | 1350637 | 386077 | three, r3f, gltfLoader, meshopt |
| index-pfsFlOq_.js | 479886 | 144391 | — |
| rapier-DZ_EfFMH.js | 295823 | 52055 | rapier |
| rolldown-runtime-hePW80VL.js | 716 | 428 | — |
| rapier_wasm3d_bg-DZsYp9WG.wasm | 3105893 | 1180561 | |
| arena-props-low.glb | 194772 | 83286 | |
| arena-props.glb | 303372 | 150186 | |
| robot-kit-low.glb | 495220 | 196824 | |
| robot-kit.glb | 826656 | 369080 | |

Entry HTML loads: /favicon.svg, /assets/index-pfsFlOq_.js, /assets/rolldown-runtime-hePW80VL.js, /assets/test-hooks-DEejnb95.js, /assets/index-CgMmDkmz.css.

## Served headers (vite preview)

| path | Cache-Control | Content-Encoding | ETag |
|---|---|---|---|
| / | no-cache | none | yes |
| /assets/RobotLab-*.js | no-cache | gzip | yes |
| /robot3d/robot-kit.glb?v=1 | no-cache | none | yes |
| /assets/rapier_wasm3d_bg-*.wasm | no-cache | none | yes |
