# bench:robot3d — 2026-10-25T17:39:00.968Z — sensors-on-school-2

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 518f6a2. Sensor overlays on (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 11.09–14.55 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 378.5 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | Run → moving (warm), every profile | 55 ms | ≤ 300 ms | ok | 2 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 3 | idle before a run, a parked robot, after an orbit settles |
| target | school: p95 frame time running at 1× | 21.7 ms | ≤ 33 ms | ok | 2 | every run scenario, low tier |
| target | school: p95 frame time running at 4× | 76.5 ms | ≤ 33 ms | not met | 1 | sim speed 4× and Kiểm tra 4× |
| target | school: long tasks > 100 ms during a run | 1  | ≤ 0  | not met | 3 | in the measuring window |
| target | school: first frame | 4590 ms | ≤ 2500 ms | not met | 3 | lesson page navigation → the scene drawn |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · line-follow | 59.9 | 46.1 | 16.7 / 21.7 / 32.2 | 6 / 9.7 | 1.5 | 48 + 0 | 0 (0) 0 | 10.7 (—) | 385 (139) | 86.2 (4.98) | 16.6 (0.96) | 0 | 100 | 11.09 |
| school · stop-at-wall | 59.5 | 50.3 | 16.8 / 19.9 / 22.4 | 4.9 / 8.8 | 1.3 | 41 + 0 | 0 (0) 0 | 16.1 (—) | 329 (106) | 61.7 (3.69) | 15.8 (0.95) | 0.1 | 101 | 14.55 |
| school · check-4x | 55.9 | 13.1 | 17.9 / 76.5 / 129.3 | 8.5 / 15.3 | 1.6 | 49 + 0 | 38 (1) 355 | 29.1 (—) | 551 (138) | 48.1 (2.35) | 20.4 (1) | 1.1 | 98 | 13.54 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · line-follow | 4590 | 581 | 2897 | 938 | 3079 | 3313 → 3365 | 3044 | 4415 | 1084 (395) | 288 | 13 | 9.7 | 438 | 55 | 0 | — |
| school · stop-at-wall | 2557 | 520 | 1247 | 877 | 1384 | 1599 → 1647 | 1353 | 2190 | 875 (356) | 246 | 12 | 8.2 | 427 | 46 | 0 | — |
| school · check-4x | 2850 | 599 | 1307 | 944 | 1565 | 1726 → 1773 | 1531 | 2530 | 1043 (382) | 368 | 12 | 9.9 | — | — | 0 | — |

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| school · line-follow | 52 (44, 0) | 5 | 22 Lambert, 10 Basic, 3 Sprite | 51046 | 36776 | 13 | 9.7: 4.8 + 2.3 + 0 + 2.5 | MeshLambertMaterial 850×700 canvas aniso 8; birch_face 1024×128 ImageBitmap; walnut 256×256 ImageBitmap; pcb_teal 200×256 ImageBitmap |

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
