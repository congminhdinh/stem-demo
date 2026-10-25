# bench:robot3d — 2026-10-25T19:54:33.264Z — before-school-1

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit aff9dbc. Sensor overlays on (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 3.04–3.94 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 384.6 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | Run → moving (warm), every profile | 38 ms | ≤ 300 ms | ok | 1 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 2 | idle before a run, a parked robot, after an orbit settles |
| target | school: p95 frame time running at 1× | 19.1 ms | ≤ 33 ms | ok | 1 | every run scenario, low tier |
| target | school: p95 frame time running at 4× | 19.6 ms | ≤ 33 ms | ok | 1 | sim speed 4× and Kiểm tra 4× |
| target | school: long tasks > 100 ms during a run | 0  | ≤ 0  | ok | 2 | in the measuring window |
| target | school: first frame | 3468 ms | ≤ 2500 ms | not met | 2 | lesson page navigation → the scene drawn |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · mini-mission | 60.2 | 52.4 | 16.6 / 19.1 / 20.6 | 4.9 / 8.9 | 1.2 | 47 + 0 | 0 (0) 0 | 11.6 (—) | 327 (125) | 96.3 (5.77) | 15.9 (0.95) | 1.4 | 96 | 3.04 |
| school · check-4x | 59.5 | 51 | 16.8 / 19.6 / 49.9 | 6.3 / 11.2 | 1.2 | 49 + 0 | 0 (0) 0 | 34.2 (—) | 431 (75) | 62.7 (3.66) | 16.5 (0.96) | 1.3 | 88 | 3.94 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · mini-mission | 3468 | 559 | 2559 | 923 | 2700 | 2910 → 2954 | 2666 | 3695 | 961 (354) | 248 | 12 | 9.9 | 94 | 38 | 0 | — |
| school · check-4x | 2360 | 462 | 1090 | 813 | 1211 | 1439 → 1479 | 1187 | 1991 | 719 (309) | 216 | 12 | 9.9 | — | — | 0 | — |

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
