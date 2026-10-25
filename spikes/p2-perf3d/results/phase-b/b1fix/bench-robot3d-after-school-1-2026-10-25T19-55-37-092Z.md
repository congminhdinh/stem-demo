# bench:robot3d — 2026-10-25T19:55:37.092Z — after-school-1

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit aff9dbc. Sensor overlays on (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 6.31–6.77 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 384.5 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | Run → moving (warm), every profile | 42 ms | ≤ 300 ms | ok | 1 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 2 | idle before a run, a parked robot, after an orbit settles |
| target | school: p95 frame time running at 1× | 18.9 ms | ≤ 33 ms | ok | 1 | every run scenario, low tier |
| target | school: p95 frame time running at 4× | 19.8 ms | ≤ 33 ms | ok | 1 | sim speed 4× and Kiểm tra 4× |
| target | school: long tasks > 100 ms during a run | 0  | ≤ 0  | ok | 2 | in the measuring window |
| target | school: first frame | 3885 ms | ≤ 2500 ms | not met | 2 | lesson page navigation → the scene drawn |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · mini-mission | 60.2 | 52.9 | 16.6 / 18.9 / 20.5 | 4.6 / 8.4 | 1.2 | 47 + 0 | 0 (0) 0 | 11.7 (—) | 319 (126) | 92.4 (5.53) | 15.9 (0.95) | 1.4 | 96 | 6.77 |
| school · check-4x | 59.9 | 50.5 | 16.7 / 19.8 / 169.7 | 6.8 / 12.2 | 1.3 | 49 + 0 | 0 (0) 0 | 33.7 (—) | 451 (83) | 62.9 (3.66) | 16.7 (0.97) | 1.3 | 98 | 6.31 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · mini-mission | 3885 | 476 | 2469 | 835 | 2600 | 2817 → 2860 | 2572 | 3622 | 846 (320) | 225 | 12 | 9.9 | 74 | 42 | 0 | — |
| school · check-4x | 2468 | 494 | 1176 | 852 | 1301 | 1527 → 1566 | 1278 | 2094 | 779 (336) | 225 | 12 | 9.9 | — | — | 0 | — |

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| school · mini-mission | 55 (43, 0) | 7 | 22 Lambert, 10 Basic, 5 Sprite | 50556 | 36084 | 12 | 9.9: 5.1 + 2.3 + 0 + 2.5 | MeshLambertMaterial 900×700 canvas aniso 8; birch_face 1024×128 ImageBitmap; walnut 256×256 ImageBitmap; pcb_teal 200×256 ImageBitmap |

## Bundle (gzip -6)

| file | bytes | gzip | holds |
|---|---|---|---|
| test-hooks-BjTfuep0.js | 1446683 | 411713 | — |
| RobotLab-itka80lC.js | 1346013 | 384495 | three, r3f, gltfLoader, meshopt |
| index-GC5fzKhl.js | 479886 | 144385 | — |
| rapier-DZ_EfFMH.js | 295823 | 52055 | rapier |
| rolldown-runtime-hePW80VL.js | 716 | 428 | — |
| rapier_wasm3d_bg-DZsYp9WG.wasm | 3105893 | 1180561 | |
| arena-props-low.glb | 194772 | 83286 | |
| arena-props.glb | 303372 | 150186 | |
| robot-kit-low.glb | 495220 | 196824 | |
| robot-kit.glb | 826656 | 369080 | |

Entry HTML loads: /favicon.svg, /assets/index-GC5fzKhl.js, /assets/rolldown-runtime-hePW80VL.js, /assets/test-hooks-BjTfuep0.js, /assets/index-CgMmDkmz.css.

## Served headers (vite preview)

| path | Cache-Control | Content-Encoding | ETag |
|---|---|---|---|
| / | no-cache | none | yes |
| /assets/RobotLab-*.js | no-cache | gzip | yes |
| /robot3d/robot-kit.glb?v=1 | no-cache | none | yes |
| /assets/rapier_wasm3d_bg-*.wasm | no-cache | none | yes |
