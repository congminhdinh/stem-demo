# bench:robot3d — 2026-10-25T16:20:53.924Z — ab-mat-aniso-low-1

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 7de18d0. Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 6.72–10.2 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 370 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | Run → moving (warm), every profile | 43 ms | ≤ 300 ms | ok | 1 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 4 | idle before a run, a parked robot, after an orbit settles |
| target | school: p95 frame time running at 1× | 98.9 ms | ≤ 33 ms | not met | 2 | every run scenario, low tier |
| target | school: long tasks > 100 ms during a run | 0  | ≤ 0  | ok | 2 | in the measuring window |
| target | school: first frame | 3819 ms | ≤ 2500 ms | not met | 3 | lesson page navigation → the scene drawn |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 59.9 | 54.9 | 16.7 / 18.2 / 18.8 | 2.1 / 3.6 | 1.2 | 40 + 0 | 0 (0) 0 | — (—) | 185 (106) | 88.7 (5.07) | 16.1 (0.92) | 94 | 6.85 |
| school · line-follow | 24.7 | 10.1 | 40.5 / 98.9 / 216.9 | 11.2 / 16.5 | 1.7 | 42 + 0 | 0 (0) 0 | 9.1 (—) | 278 (64) | 92 (1.9) | 44.8 (0.93) | 98 | 6.72 |
| school · teleop | 23.2 | 12 | 43.1 / 83.4 / 106.7 | 10.8 / 15.5 | 1.6 | 40 + 0 | 0 (0) 0 | 11.3 (—) | 260 (64) | 104.7 (2.19) | 44.6 (0.93) | 98 | 10.2 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 3819 | 457 | 2405 | 803 | 2535 | 2738 → 2789 | 3305 | 3592 | 1314 (507) | 216 | 11 | 9.6 | — | — | 0 | 0 |
| school · line-follow | 2425 | 462 | 1115 | 809 | 1253 | 1454 → 1508 | 1911 | 2098 | 1214 (398) | 237 | 11 | 9.6 | 408 | 43 | 0 | — |
| school · teleop | 2937 | 575 | 1384 | 960 | 1534 | 1723 → 1782 | 2416 | 2800 | 1587 (625) | 259 | 12 | 10.3 | — | — | 0 | — |

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| school · idle | 49 (39, 0) | 4 | 22 Lambert, 8 Basic, 2 Sprite | 50664 | 36360 | 11 | 9.6: 4.7 + 2.3 + 0 + 2.5 | MeshLambertMaterial 850×700 canvas; birch_face 1024×128 ImageBitmap; walnut 256×256 ImageBitmap; pcb_teal 200×256 ImageBitmap |

## Bundle (gzip -6)

| file | bytes | gzip | holds |
|---|---|---|---|
| test-hooks-SslOmkyj.js | 1438871 | 409492 | — |
| RobotLab-jB9O_YJ9.js | 1305697 | 370020 | three, r3f, gltfLoader, meshopt |
| index-CpovUcaS.js | 483855 | 145821 | — |
| rapier-DZ_EfFMH.js | 295823 | 52055 | rapier |
| rolldown-runtime-hePW80VL.js | 716 | 428 | — |
| rapier_wasm3d_bg-DZsYp9WG.wasm | 3105893 | 1180561 | |
| arena-props-low.glb | 194772 | 83286 | |
| arena-props.glb | 303372 | 150186 | |
| robot-kit-low.glb | 495220 | 196824 | |
| robot-kit.glb | 826656 | 369080 | |

Entry HTML loads: /favicon.svg, /assets/index-CpovUcaS.js, /assets/rolldown-runtime-hePW80VL.js, /assets/test-hooks-SslOmkyj.js, /assets/index-C8LDzkpJ.css.

## Served headers (vite preview)

| path | Cache-Control | Content-Encoding | ETag |
|---|---|---|---|
| / | no-cache | none | yes |
| /assets/RobotLab-*.js | no-cache | gzip | yes |
| /robot3d/robot-kit.glb?v=1 | no-cache | none | yes |
| /assets/rapier_wasm3d_bg-*.wasm | no-cache | none | yes |
