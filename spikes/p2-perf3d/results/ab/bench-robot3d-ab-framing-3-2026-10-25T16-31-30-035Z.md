# bench:robot3d — 2026-10-25T16:31:30.035Z — ab-framing-3

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit de86a10. Sensor overlays on (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 6.13–6.83 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 370.1 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | Run → moving (warm), every profile | 38 ms | ≤ 300 ms | ok | 1 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 2 | idle before a run, a parked robot, after an orbit settles |
| target | school: p95 frame time running at 1× | 19.7 ms | ≤ 33 ms | ok | 1 | every run scenario, low tier |
| target | school: p95 frame time running at 4× | 20 ms | ≤ 33 ms | ok | 1 | sim speed 4× and Kiểm tra 4× |
| target | school: long tasks > 100 ms during a run | 1  | ≤ 0  | not met | 2 | in the measuring window |
| target | school: first frame | 3835 ms | ≤ 2500 ms | not met | 2 | lesson page navigation → the scene drawn |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · mini-mission | 59.9 | 50.8 | 16.7 / 19.7 / 21.3 | 3.2 / 7.1 | 0.9 | 43 + 0 | 0 (0) 0 | 11.9 (—) | 235 (91) | 99 (5.93) | 15.5 (0.93) | 95 | 6.83 |
| school · check-4x | 60.2 | 50 | 16.6 / 20 / 40.2 | 5.1 / 9.7 | 1.1 | 45 + 0 | 1 (1) 315 | 34 (—) | 369 (62) | 63.6 (3.72) | 16.6 (0.97) | 96 | 6.13 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · mini-mission | 3835 | 472 | 2415 | 818 | 2498 | 2747 → 2798 | 3320 | 3529 | 1332 (509) | 172 | 10 | 9.8 | 383 | 38 | 0 | — |
| school · check-4x | 2353 | 459 | 1078 | 804 | 1162 | 1413 → 1458 | 1840 | 1948 | 1065 (376) | 181 | 10 | 9.8 | — | — | 0 | — |

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
