# bench:robot3d — 2026-10-25T19:00:16.804Z — after-school-2

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 592ec41. Sensor overlays on (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 3.22–4.5 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 383.9 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | Run → moving (warm), every profile | 42 ms | ≤ 300 ms | ok | 2 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 5 | idle before a run, a parked robot, after an orbit settles |
| target | school: p95 frame time running at 1× | 19.6 ms | ≤ 33 ms | ok | 2 | every run scenario, low tier |
| target | school: p95 frame time running at 4× | 20.1 ms | ≤ 33 ms | ok | 1 | sim speed 4× and Kiểm tra 4× |
| target | school: long tasks > 100 ms during a run | 1  | ≤ 0  | not met | 3 | in the measuring window |
| target | school: first frame | 3798 ms | ≤ 2500 ms | not met | 4 | lesson page navigation → the scene drawn |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 60.6 | 54.1 | 16.5 / 18.5 / 20.4 | 1.7 / 3.5 | 1 | 41 + 0 | 0 (0) 0 | — (—) | 162 (87) | 92 (5.35) | 15.8 (0.92) | 2.8 | 91 | 4.02 |
| school · line-follow | 59.9 | 52.9 | 16.7 / 18.9 / 20.4 | 3.7 / 6.9 | 1.1 | 48 + 0 | 0 (0) 0 | 10.7 (—) | 256 (97) | 99.7 (5.98) | 15.5 (0.93) | 0 | 94 | 3.72 |
| school · mini-mission | 59.9 | 51 | 16.7 / 19.6 / 21 | 3.5 / 7 | 0.9 | 47 + 0 | 0 (0) 0 | 11.6 (—) | 247 (98) | 99.9 (5.98) | 15.6 (0.93) | 1.4 | 91 | 3.22 |
| school · check-4x | 59.9 | 49.8 | 16.7 / 20.1 / 45.1 | 5.3 / 10.2 | 1.2 | 49 + 0 | 1 (1) 313 | 34.2 (—) | 382 (66) | 63.7 (3.75) | 16.6 (0.98) | 1.3 | 92 | 4.5 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 3798 | 452 | 2385 | 796 | 2501 | 2730 → 2775 | 2475 | 3611 | 781 (305) | 205 | 13 | 9.7 | — | — | 0 | 0 |
| school · line-follow | 2361 | 459 | 1078 | 806 | 1193 | 1421 → 1465 | 1172 | 2039 | 713 (313) | 211 | 13 | 9.7 | 378 | 40 | 0 | — |
| school · mini-mission | 2341 | 451 | 1073 | 797 | 1194 | 1419 → 1459 | 1171 | 1980 | 704 (305) | 218 | 12 | 9.9 | 379 | 42 | 0 | — |
| school · check-4x | 2356 | 446 | 1065 | 793 | 1187 | 1411 → 1455 | 1164 | 1977 | 706 (305) | 218 | 12 | 9.9 | — | — | 0 | — |

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
