# bench:robot3d — 2026-10-25T19:04:35.029Z — after-school-3

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 592ec41. Sensor overlays on (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 3.99–6.06 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 383.9 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | Run → moving (warm), every profile | 45 ms | ≤ 300 ms | ok | 2 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 5 | idle before a run, a parked robot, after an orbit settles |
| target | school: p95 frame time running at 1× | 19.6 ms | ≤ 33 ms | ok | 2 | every run scenario, low tier |
| target | school: p95 frame time running at 4× | 20.6 ms | ≤ 33 ms | ok | 1 | sim speed 4× and Kiểm tra 4× |
| target | school: long tasks > 100 ms during a run | 1  | ≤ 0  | not met | 3 | in the measuring window |
| target | school: first frame | 3829 ms | ≤ 2500 ms | not met | 4 | lesson page navigation → the scene drawn |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 59.9 | 54.1 | 16.7 / 18.5 / 18.7 | 1.6 / 3.2 | 1.2 | 41 + 0 | 0 (0) 0 | — (—) | 163 (86) | 91 (5.29) | 15.7 (0.91) | 2.9 | 91 | 6.06 |
| school · line-follow | 60.6 | 51 | 16.5 / 19.6 / 21.3 | 3.8 / 7.5 | 1.1 | 48 + 0 | 0 (0) 0 | 13 (—) | 270 (103) | 106.6 (6.39) | 15.7 (0.94) | 0 | 89 | 4.93 |
| school · mini-mission | 59.5 | 51.5 | 16.8 / 19.4 / 20.7 | 4 / 7.6 | 1.2 | 47 + 0 | 0 (0) 0 | 11.6 (—) | 276 (108) | 95.8 (5.74) | 15.7 (0.94) | 1.4 | 92 | 3.99 |
| school · check-4x | 60.2 | 48.5 | 16.6 / 20.6 / 51.6 | 6.1 / 11 | 1.3 | 49 + 0 | 1 (1) 338 | 34.1 (—) | 427 (77) | 62.8 (3.69) | 16.8 (0.99) | 1.3 | 99 | 5.71 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 3829 | 478 | 2419 | 825 | 2534 | 2763 → 2806 | 2509 | 3617 | 785 (312) | 203 | 13 | 9.7 | — | — | 0 | 0 |
| school · line-follow | 2327 | 447 | 1059 | 791 | 1171 | 1404 → 1446 | 1150 | 2007 | 694 (304) | 206 | 13 | 9.7 | 383 | 41 | 0 | — |
| school · mini-mission | 2348 | 451 | 1072 | 799 | 1193 | 1422 → 1464 | 1170 | 1977 | 710 (305) | 218 | 12 | 9.9 | 380 | 45 | 0 | — |
| school · check-4x | 2495 | 495 | 1174 | 852 | 1306 | 1526 → 1570 | 1281 | 2134 | 837 (336) | 237 | 12 | 9.9 | — | — | 0 | — |

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| school · idle | 52 (40, 0) | 5 | 22 Lambert, 10 Basic, 3 Sprite | 51046 | 36370 | 13 | 9.7: 4.8 + 2.3 + 0 + 2.5 | MeshLambertMaterial 850×700 canvas aniso 8; birch_face 1024×128 ImageBitmap; walnut 256×256 ImageBitmap; pcb_teal 200×256 ImageBitmap |

## Bundle (gzip -6)

| file | bytes | gzip | holds |
|---|---|---|---|
| test-hooks-BmzOF-lf.js | 1442708 | 410376 | — |
| RobotLab-YH31SwFk.js | 1344499 | 383896 | three, r3f, gltfLoader, meshopt |
| index-CdAfbINr.js | 483855 | 145818 | — |
| rapier-DZ_EfFMH.js | 295823 | 52055 | rapier |
| rolldown-runtime-hePW80VL.js | 716 | 428 | — |
| rapier_wasm3d_bg-DZsYp9WG.wasm | 3105893 | 1180561 | |
| arena-props-low.glb | 194772 | 83286 | |
| arena-props.glb | 303372 | 150186 | |
| robot-kit-low.glb | 495220 | 196824 | |
| robot-kit.glb | 826656 | 369080 | |

Entry HTML loads: /favicon.svg, /assets/index-CdAfbINr.js, /assets/rolldown-runtime-hePW80VL.js, /assets/test-hooks-BmzOF-lf.js, /assets/index-CgMmDkmz.css.

## Served headers (vite preview)

| path | Cache-Control | Content-Encoding | ETag |
|---|---|---|---|
| / | no-cache | none | yes |
| /assets/RobotLab-*.js | no-cache | gzip | yes |
| /robot3d/robot-kit.glb?v=1 | no-cache | none | yes |
| /assets/rapier_wasm3d_bg-*.wasm | no-cache | none | yes |
