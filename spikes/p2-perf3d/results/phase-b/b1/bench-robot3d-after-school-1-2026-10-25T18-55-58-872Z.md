# bench:robot3d — 2026-10-25T18:55:58.872Z — after-school-1

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 592ec41. Sensor overlays on (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 4.03–5.83 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 383.9 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | Run → moving (warm), every profile | 41 ms | ≤ 300 ms | ok | 2 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 5 | idle before a run, a parked robot, after an orbit settles |
| target | school: p95 frame time running at 1× | 19.6 ms | ≤ 33 ms | ok | 2 | every run scenario, low tier |
| target | school: p95 frame time running at 4× | 20 ms | ≤ 33 ms | ok | 1 | sim speed 4× and Kiểm tra 4× |
| target | school: long tasks > 100 ms during a run | 1  | ≤ 0  | not met | 3 | in the measuring window |
| target | school: first frame | 3801 ms | ≤ 2500 ms | not met | 4 | lesson page navigation → the scene drawn |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 60.6 | 52.1 | 16.5 / 19.2 / 19.9 | 1.9 / 3.6 | 1.2 | 41 + 0 | 0 (0) 0 | — (—) | 175 (100) | 90.5 (5.15) | 16.2 (0.92) | 2.7 | 90 | 4.62 |
| school · line-follow | 60.2 | 52.1 | 16.6 / 19.2 / 20.8 | 3.9 / 7.2 | 1.1 | 48 + 0 | 0 (0) 0 | 10.7 (—) | 265 (102) | 99 (5.93) | 15.6 (0.94) | 0 | 90 | 4.03 |
| school · mini-mission | 59.9 | 51 | 16.7 / 19.6 / 20.7 | 3.7 / 7.1 | 1.1 | 47 + 0 | 0 (0) 0 | 11.6 (—) | 258 (103) | 100.2 (6) | 15.6 (0.94) | 1.4 | 91 | 5.1 |
| school · check-4x | 59.9 | 50 | 16.7 / 20 / 44.7 | 5.4 / 10.4 | 1.3 | 49 + 0 | 1 (1) 314 | 34.2 (—) | 383 (72) | 63.9 (3.77) | 16.6 (0.98) | 1.3 | 92 | 5.83 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 3801 | 456 | 2402 | 809 | 2523 | 2751 → 2796 | 2496 | 3610 | 805 (308) | 209 | 13 | 9.7 | — | — | 0 | 0 |
| school · line-follow | 2351 | 448 | 1065 | 794 | 1193 | 1420 → 1463 | 1167 | 2043 | 705 (305) | 228 | 13 | 9.7 | 395 | 41 | 0 | — |
| school · mini-mission | 2361 | 452 | 1091 | 801 | 1213 | 1440 → 1479 | 1189 | 1992 | 726 (308) | 221 | 12 | 9.9 | 382 | 40 | 0 | — |
| school · check-4x | 2364 | 464 | 1091 | 816 | 1214 | 1439 → 1482 | 1190 | 1992 | 723 (313) | 219 | 12 | 9.9 | — | — | 0 | — |

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
