# bench:robot3d — 2026-10-25T22:24:43.202Z — final-school-3

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 7661d33. Sensor overlays on (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 5.05–11.08 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 386.1 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | Run → moving (warm), every profile | 46 ms | ≤ 300 ms | ok | 3 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 8 | idle before a run, a parked robot, after an orbit settles |
| target | school: p95 frame time running at 1× | 20.1 ms | ≤ 33 ms | ok | 5 | every run scenario, low tier |
| target | school: p95 frame time running at 4× | 21.3 ms | ≤ 33 ms | ok | 1 | sim speed 4× and Kiểm tra 4× |
| target | school: long tasks > 100 ms during a run | 0  | ≤ 0  | ok | 6 | in the measuring window |
| target | school: first frame | 4231 ms | ≤ 2500 ms | not met | 7 | lesson page navigation → the scene drawn |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 60.2 | 52.4 | 16.6 / 19.1 / 19.7 | 2.2 / 3.6 | 1.5 | 41 + 0 | 0 (0) 0 | — (—) | 203 (112) | 90.8 (5.22) | 16.1 (0.92) | 2.6 | 99 | 5.05 |
| school · line-follow | 60.2 | 52.1 | 16.6 / 19.2 / 20.4 | 5 / 8.1 | 1.3 | 48 + 0 | 0 (0) 0 | 10.7 (—) | 334 (122) | 96.7 (5.8) | 15.8 (0.95) | 0 | 99 | 5.11 |
| school · mini-mission | 60.2 | 51 | 16.6 / 19.6 / 32.9 | 4.8 / 8.8 | 1.3 | 47 + 0 | 0 (0) 0 | 11.5 (—) | 327 (124) | 96.5 (5.64) | 16.2 (0.95) | 1.4 | 98 | 7.03 |
| school · check-1x | 60.2 | 49.8 | 16.6 / 20.1 / 29.7 | 4.8 / 9.3 | 1.3 | 47 + 0 | 0 (0) 0 | 12.7 (—) | 326 (125) | 98 (5.71) | 16.3 (0.95) | 1.4 | 97 | 8.2 |
| school · check-4x | 59.9 | 46.9 | 16.7 / 21.3 / 162.3 | 6.9 / 12.1 | 1.4 | 49 + 0 | 0 (0) 0 | 33.7 (—) | 455 (83) | 59.8 (3.44) | 16.8 (0.97) | 1.3 | 99 | 9.52 |
| school · follow | 59.9 | 53.8 | 16.7 / 18.6 / 19.5 | 4.8 / 7.9 | 1.2 | 42 + 0 | 0 (0) 0 | 10.7 (—) | 323 (110) | 94 (5.63) | 15.8 (0.95) | 0 | 96 | 11.08 |
| school · teleop | 59.9 | 51.3 | 16.7 / 19.5 / 21.3 | 5.4 / 7.7 | 1.3 | 43 + 0 | 0 (0) 0 | 11.9 (—) | 346 (124) | 123.9 (7.39) | 16.2 (0.96) | 0 | 97 | 10.36 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 4231 | 620 | 2770 | 1025 | 2918 | 3126 → 3178 | 2884 | 4027 | 1069 (400) | 259 | 13 | 9.7 | — | — | 0 | 0 |
| school · line-follow | 2532 | 518 | 1198 | 871 | 1324 | 1549 → 1599 | 1299 | 2220 | 835 (343) | 232 | 13 | 9.7 | 84 | 40 | 0 | — |
| school · mini-mission | 2490 | 496 | 1181 | 849 | 1317 | 1538 → 1582 | 1289 | 2120 | 795 (339) | 239 | 12 | 9.9 | 78 | 43 | 0 | — |
| school · check-1x | 2494 | 491 | 1180 | 848 | 1315 | 1530 → 1574 | 1288 | 2128 | 848 (337) | 240 | 12 | 9.9 | — | — | 0 | — |
| school · check-4x | 2510 | 495 | 1190 | 851 | 1318 | 1539 → 1585 | 1293 | 2152 | 843 (339) | 240 | 12 | 9.9 | — | — | 0 | — |
| school · follow | 2498 | 498 | 1198 | 862 | 1319 | 1548 → 1594 | 1295 | 2183 | 801 (339) | 223 | 13 | 9.7 | 96 | 46 | 0 | — |
| school · teleop | 2565 | 509 | 1163 | 859 | 1265 | 1513 → 1573 | 2051 | 2217 | 1328 (471) | 205 | 13 | 10.4 | — | — | 0 | — |

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
