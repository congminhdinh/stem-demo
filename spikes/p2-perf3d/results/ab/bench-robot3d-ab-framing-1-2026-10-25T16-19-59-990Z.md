# bench:robot3d — 2026-10-25T16:19:59.990Z — ab-framing-1

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 7de18d0. Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 9.4–10.05 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 370.1 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | Run → moving (warm), every profile | 40 ms | ≤ 300 ms | ok | 1 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 2 | idle before a run, a parked robot, after an orbit settles |
| target | school: p95 frame time running at 1× | 19.3 ms | ≤ 33 ms | ok | 1 | every run scenario, low tier |
| target | school: p95 frame time running at 4× | 20 ms | ≤ 33 ms | ok | 1 | sim speed 4× and Kiểm tra 4× |
| target | school: long tasks > 100 ms during a run | 1  | ≤ 0  | not met | 2 | in the measuring window |
| target | school: first frame | 3867 ms | ≤ 2500 ms | not met | 2 | lesson page navigation → the scene drawn |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · mini-mission | 59.9 | 51.8 | 16.7 / 19.3 / 20.4 | 3.5 / 6.8 | 1.1 | 43 + 0 | 0 (0) 0 | 11.6 (—) | 246 (94) | 98.1 (5.88) | 15.6 (0.93) | 95 | 10.05 |
| school · check-4x | 60.2 | 50 | 16.6 / 20 / 43.1 | 5.7 / 10.6 | 1.2 | 45 + 0 | 1 (1) 314 | 34.2 (—) | 402 (70) | 62.9 (3.71) | 16.6 (0.98) | 96 | 9.4 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · mini-mission | 3867 | 475 | 2439 | 821 | 2526 | 2774 → 2823 | 3354 | 3565 | 1403 (525) | 186 | 10 | 9.8 | 379 | 40 | 0 | — |
| school · check-4x | 2357 | 456 | 1081 | 802 | 1165 | 1414 → 1462 | 1844 | 1956 | 696 (312) | 179 | 10 | 9.8 | — | — | 0 | — |

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| school · mini-mission | 50 (40, 0) | 6 | 22 Lambert, 8 Basic, 4 Sprite | 50150 | 35676 | 10 | 9.8: 5.1 + 2.3 + 0 + 2.5 | MeshLambertMaterial 900×700 canvas aniso 8; birch_face 1024×128 ImageBitmap; walnut 256×256 ImageBitmap; pcb_teal 200×256 ImageBitmap |

## Bundle (gzip -6)

| file | bytes | gzip | holds |
|---|---|---|---|
| test-hooks-SslOmkyj.js | 1438871 | 409492 | — |
| RobotLab-CIse6cuT.js | 1305902 | 370150 | three, r3f, gltfLoader, meshopt |
| index-B-AT0ysG.js | 483855 | 145817 | — |
| rapier-DZ_EfFMH.js | 295823 | 52055 | rapier |
| rolldown-runtime-hePW80VL.js | 716 | 428 | — |
| rapier_wasm3d_bg-DZsYp9WG.wasm | 3105893 | 1180561 | |
| arena-props-low.glb | 194772 | 83286 | |
| arena-props.glb | 303372 | 150186 | |
| robot-kit-low.glb | 495220 | 196824 | |
| robot-kit.glb | 826656 | 369080 | |

Entry HTML loads: /favicon.svg, /assets/index-B-AT0ysG.js, /assets/rolldown-runtime-hePW80VL.js, /assets/test-hooks-SslOmkyj.js, /assets/index-C8LDzkpJ.css.

## Served headers (vite preview)

| path | Cache-Control | Content-Encoding | ETag |
|---|---|---|---|
| / | no-cache | none | yes |
| /assets/RobotLab-*.js | no-cache | gzip | yes |
| /robot3d/robot-kit.glb?v=1 | no-cache | none | yes |
| /assets/rapier_wasm3d_bg-*.wasm | no-cache | none | yes |
