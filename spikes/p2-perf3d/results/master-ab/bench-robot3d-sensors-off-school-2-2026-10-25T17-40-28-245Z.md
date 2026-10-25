# bench:robot3d — 2026-10-25T17:40:28.245Z — sensors-off-school-2

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 518f6a2. Sensor overlays off (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 14.02–16.67 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 378.5 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | Run → moving (warm), every profile | 43 ms | ≤ 300 ms | ok | 2 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 3 | idle before a run, a parked robot, after an orbit settles |
| target | school: p95 frame time running at 1× | 19.6 ms | ≤ 33 ms | ok | 2 | every run scenario, low tier |
| target | school: p95 frame time running at 4× | 31.5 ms | ≤ 33 ms | ok | 1 | sim speed 4× and Kiểm tra 4× |
| target | school: long tasks > 100 ms during a run | 1  | ≤ 0  | not met | 3 | in the measuring window |
| target | school: first frame | 4619 ms | ≤ 2500 ms | not met | 3 | lesson page navigation → the scene drawn |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · line-follow | 59.9 | 51 | 16.7 / 19.6 / 20.7 | 4.9 / 8.6 | 1.3 | 44 + 0 | 0 (0) 0 | 10.7 (—) | 332 (114) | 90.1 (5.35) | 16 (0.95) | 0 | 100 | 16.67 |
| school · stop-at-wall | 59.5 | 51 | 16.8 / 19.6 / 20.9 | 4.5 / 8.1 | 1.3 | 37 + 0 | 0 (0) 0 | 16.1 (—) | 289 (96) | 56.6 (3.39) | 15.7 (0.94) | 0.1 | 98 | 15.06 |
| school · check-4x | 60.2 | 31.7 | 16.6 / 31.5 / 85.1 | 7 / 12.3 | 1.3 | 45 + 0 | 22 (1) 333 | 33.4 (—) | 504 (113) | 57 (3.25) | 17.6 (1) | 1 | 101 | 14.02 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · line-follow | 4619 | 583 | 2988 | 936 | 3181 | 3432 → 3494 | 3145 | 4449 | 1075 (384) | 309 | 13 | 9.7 | 424 | 43 | 0 | — |
| school · stop-at-wall | 2555 | 534 | 1229 | 885 | 1386 | 1584 → 1631 | 1343 | 2184 | 873 (356) | 256 | 12 | 8.2 | 413 | 42 | 0 | — |
| school · check-4x | 2585 | 536 | 1236 | 897 | 1473 | 1631 → 1677 | 1445 | 2220 | 985 (370) | 345 | 12 | 9.9 | — | — | 0 | — |

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| school · line-follow | 52 (41, 0) | 5 | 22 Lambert, 10 Basic, 3 Sprite | 51046 | 36368 | 13 | 9.7: 4.8 + 2.3 + 0 + 2.5 | MeshLambertMaterial 850×700 canvas aniso 8; birch_face 1024×128 ImageBitmap; walnut 256×256 ImageBitmap; pcb_teal 200×256 ImageBitmap |

## Bundle (gzip -6)

| file | bytes | gzip | holds |
|---|---|---|---|
| test-hooks-P0rzqaOg.js | 1439400 | 409669 | — |
| RobotLab-9aaBbRob.js | 1329557 | 378495 | three, r3f, gltfLoader, meshopt |
| index-CnB3OsAZ.js | 483855 | 145816 | — |
| rapier-DZ_EfFMH.js | 295823 | 52055 | rapier |
| rolldown-runtime-hePW80VL.js | 716 | 428 | — |
| rapier_wasm3d_bg-DZsYp9WG.wasm | 3105893 | 1180561 | |
| arena-props-low.glb | 194772 | 83286 | |
| arena-props.glb | 303372 | 150186 | |
| robot-kit-low.glb | 495220 | 196824 | |
| robot-kit.glb | 826656 | 369080 | |

Entry HTML loads: /favicon.svg, /assets/index-CnB3OsAZ.js, /assets/rolldown-runtime-hePW80VL.js, /assets/test-hooks-P0rzqaOg.js, /assets/index-C8LDzkpJ.css.

## Served headers (vite preview)

| path | Cache-Control | Content-Encoding | ETag |
|---|---|---|---|
| / | no-cache | none | yes |
| /assets/RobotLab-*.js | no-cache | gzip | yes |
| /robot3d/robot-kit.glb?v=1 | no-cache | none | yes |
| /assets/rapier_wasm3d_bg-*.wasm | no-cache | none | yes |
