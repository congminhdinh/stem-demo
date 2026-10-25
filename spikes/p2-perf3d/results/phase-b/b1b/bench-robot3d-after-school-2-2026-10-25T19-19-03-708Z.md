# bench:robot3d — 2026-10-25T19:19:03.708Z — after-school-2

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 5680ab2. Sensor overlays on (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 3.56–4.53 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 384.4 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | Run → moving (warm), every profile | 39 ms | ≤ 300 ms | ok | 1 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 4 | idle before a run, a parked robot, after an orbit settles |
| target | school: p95 frame time running at 1× | 19 ms | ≤ 33 ms | ok | 1 | every run scenario, low tier |
| target | school: p95 frame time running at 4× | 20 ms | ≤ 33 ms | ok | 1 | sim speed 4× and Kiểm tra 4× |
| target | school: long tasks > 100 ms during a run | 0  | ≤ 0  | ok | 2 | in the measuring window |
| target | school: first frame | 3819 ms | ≤ 2500 ms | not met | 3 | lesson page navigation → the scene drawn |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 60.2 | 52.9 | 16.6 / 18.9 / 20 | 2.1 / 3.9 | 1.2 | 41 + 0 | 0 (0) 0 | — (—) | 173 (100) | 90.8 (5.31) | 15.8 (0.92) | 2.7 | 92 | 4.29 |
| school · line-follow | 60.2 | 52.6 | 16.6 / 19 / 20 | 3.5 / 6.4 | 1.1 | 48 + 0 | 0 (0) 0 | 10.7 (—) | 243 (93) | 100.3 (6.02) | 15.5 (0.93) | 0 | 90 | 3.56 |
| school · check-4x | 59.9 | 50 | 16.7 / 20 / 48.2 | 5.6 / 10.3 | 1.2 | 49 + 0 | 0 (0) 0 | 34.2 (—) | 383 (68) | 64 (3.75) | 16.3 (0.95) | 1.3 | 92 | 4.53 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 3819 | 456 | 2394 | 802 | 2508 | 2738 → 2785 | 2482 | 3598 | 789 (311) | 201 | 13 | 9.7 | — | — | 0 | 0 |
| school · line-follow | 2481 | 451 | 1069 | 799 | 1182 | 1413 → 1454 | 1158 | 1969 | 699 (308) | 211 | 13 | 9.7 | 70 | 39 | 0 | — |
| school · check-4x | 2363 | 452 | 1082 | 806 | 1204 | 1429 → 1471 | 1180 | 1996 | 720 (307) | 222 | 12 | 9.9 | — | — | 0 | — |

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| school · idle | 52 (40, 0) | 5 | 22 Lambert, 10 Basic, 3 Sprite | 51046 | 36370 | 13 | 9.7: 4.8 + 2.3 + 0 + 2.5 | MeshLambertMaterial 850×700 canvas aniso 8; birch_face 1024×128 ImageBitmap; walnut 256×256 ImageBitmap; pcb_teal 200×256 ImageBitmap |

## Bundle (gzip -6)

| file | bytes | gzip | holds |
|---|---|---|---|
| test-hooks-BjTfuep0.js | 1446683 | 411713 | — |
| RobotLab-XcW7qJVw.js | 1345871 | 384363 | three, r3f, gltfLoader, meshopt |
| index-unCg-rvw.js | 479886 | 144390 | — |
| rapier-DZ_EfFMH.js | 295823 | 52055 | rapier |
| rolldown-runtime-hePW80VL.js | 716 | 428 | — |
| rapier_wasm3d_bg-DZsYp9WG.wasm | 3105893 | 1180561 | |
| arena-props-low.glb | 194772 | 83286 | |
| arena-props.glb | 303372 | 150186 | |
| robot-kit-low.glb | 495220 | 196824 | |
| robot-kit.glb | 826656 | 369080 | |

Entry HTML loads: /favicon.svg, /assets/index-unCg-rvw.js, /assets/rolldown-runtime-hePW80VL.js, /assets/test-hooks-BjTfuep0.js, /assets/index-CgMmDkmz.css.

## Served headers (vite preview)

| path | Cache-Control | Content-Encoding | ETag |
|---|---|---|---|
| / | no-cache | none | yes |
| /assets/RobotLab-*.js | no-cache | gzip | yes |
| /robot3d/robot-kit.glb?v=1 | no-cache | none | yes |
| /assets/rapier_wasm3d_bg-*.wasm | no-cache | none | yes |
