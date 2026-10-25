# bench:robot3d — 2026-10-25T19:57:18.641Z — before-school-2

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit aff9dbc. Sensor overlays on (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 3.58–6.29 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 384.6 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | Run → moving (warm), every profile | 40 ms | ≤ 300 ms | ok | 1 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 2 | idle before a run, a parked robot, after an orbit settles |
| target | school: p95 frame time running at 1× | 18.9 ms | ≤ 33 ms | ok | 1 | every run scenario, low tier |
| target | school: p95 frame time running at 4× | 19.7 ms | ≤ 33 ms | ok | 1 | sim speed 4× and Kiểm tra 4× |
| target | school: long tasks > 100 ms during a run | 0  | ≤ 0  | ok | 2 | in the measuring window |
| target | school: first frame | 4132 ms | ≤ 2500 ms | not met | 2 | lesson page navigation → the scene drawn |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · mini-mission | 60.2 | 52.9 | 16.6 / 18.9 / 19.8 | 5.1 / 9.3 | 1.3 | 47 + 0 | 0 (0) 0 | 11.7 (—) | 344 (131) | 94.6 (5.68) | 15.9 (0.96) | 1.4 | 98 | 3.58 |
| school · check-4x | 59.9 | 50.8 | 16.7 / 19.7 / 28.5 | 6.5 / 11.6 | 1.3 | 49 + 0 | 0 (0) 0 | 34.2 (—) | 444 (79) | 62.5 (3.65) | 16.6 (0.97) | 1.3 | 94 | 6.29 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · mini-mission | 4132 | 586 | 2725 | 978 | 2873 | 3076 → 3120 | 2839 | 3881 | 1040 (373) | 256 | 12 | 9.9 | 88 | 40 | 0 | — |
| school · check-4x | 2424 | 480 | 1150 | 837 | 1270 | 1496 → 1538 | 1249 | 2056 | 765 (328) | 213 | 12 | 9.9 | — | — | 0 | — |

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| school · mini-mission | 55 (43, 0) | 7 | 22 Lambert, 10 Basic, 5 Sprite | 50556 | 36084 | 12 | 9.9: 5.1 + 2.3 + 0 + 2.5 | MeshLambertMaterial 900×700 canvas aniso 8; birch_face 1024×128 ImageBitmap; walnut 256×256 ImageBitmap; pcb_teal 200×256 ImageBitmap |

## Bundle (gzip -6)

| file | bytes | gzip | holds |
|---|---|---|---|
| test-hooks-BjTfuep0.js | 1446683 | 411713 | — |
| RobotLab-DRCXX3kh.js | 1346194 | 384605 | three, r3f, gltfLoader, meshopt |
| index-DspuuKw7.js | 479886 | 144386 | — |
| rapier-DZ_EfFMH.js | 295823 | 52055 | rapier |
| rolldown-runtime-hePW80VL.js | 716 | 428 | — |
| rapier_wasm3d_bg-DZsYp9WG.wasm | 3105893 | 1180561 | |
| arena-props-low.glb | 194772 | 83286 | |
| arena-props.glb | 303372 | 150186 | |
| robot-kit-low.glb | 495220 | 196824 | |
| robot-kit.glb | 826656 | 369080 | |

Entry HTML loads: /favicon.svg, /assets/index-DspuuKw7.js, /assets/rolldown-runtime-hePW80VL.js, /assets/test-hooks-BjTfuep0.js, /assets/index-CgMmDkmz.css.

## Served headers (vite preview)

| path | Cache-Control | Content-Encoding | ETag |
|---|---|---|---|
| / | no-cache | none | yes |
| /assets/RobotLab-*.js | no-cache | gzip | yes |
| /robot3d/robot-kit.glb?v=1 | no-cache | none | yes |
| /assets/rapier_wasm3d_bg-*.wasm | no-cache | none | yes |
