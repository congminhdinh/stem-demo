# bench:robot3d — 2026-10-25T16:27:14.943Z — ab-no-shader-checks-2

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit de86a10. Sensor overlays on (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 4.71–5.38 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 370 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | Run → moving (warm), every profile | 38 ms | ≤ 300 ms | ok | 1 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 3 | idle before a run, a parked robot, after an orbit settles |
| target | school: p95 frame time running at 1× | 19.8 ms | ≤ 33 ms | ok | 1 | every run scenario, low tier |
| target | school: long tasks > 100 ms during a run | 0  | ≤ 0  | ok | 1 | in the measuring window |
| target | school: first frame | 3912 ms | ≤ 2500 ms | not met | 2 | lesson page navigation → the scene drawn |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 60.2 | 52.9 | 16.6 / 18.9 / 20 | 1.5 / 3.3 | 1 | 40 + 0 | 0 (0) 0 | — (—) | 146 (80) | 91.6 (5.26) | 15.9 (0.91) | 95 | 5.38 |
| school · line-follow | 60.2 | 50.5 | 16.6 / 19.8 / 21.5 | 3.5 / 7.2 | 1 | 44 + 0 | 0 (0) 0 | 13.1 (—) | 252 (92) | 104.2 (6.25) | 15.6 (0.94) | 95 | 4.71 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 3912 | 469 | 2412 | 813 | 2543 | 2752 → 2801 | 3397 | 3609 | 1395 (585) | 222 | 11 | 9.6 | — | — | 0 | 0 |
| school · line-follow | 2375 | 462 | 1083 | 806 | 1210 | 1414 → 1465 | 1862 | 2033 | 734 (317) | 227 | 11 | 9.6 | 372 | 38 | 0 | — |

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| school · idle | 49 (39, 0) | 4 | 22 Lambert, 8 Basic, 2 Sprite | 50664 | 36360 | 11 | 9.6: 4.7 + 2.3 + 0 + 2.5 | MeshLambertMaterial 850×700 canvas aniso 8; birch_face 1024×128 ImageBitmap; walnut 256×256 ImageBitmap; pcb_teal 200×256 ImageBitmap |

## Bundle (gzip -6)

| file | bytes | gzip | holds |
|---|---|---|---|
| test-hooks-SslOmkyj.js | 1438871 | 409492 | — |
| RobotLab-B0CtYHCK.js | 1305722 | 370034 | three, r3f, gltfLoader, meshopt |
| index-tBndO0f0.js | 483855 | 145819 | — |
| rapier-DZ_EfFMH.js | 295823 | 52055 | rapier |
| rolldown-runtime-hePW80VL.js | 716 | 428 | — |
| rapier_wasm3d_bg-DZsYp9WG.wasm | 3105893 | 1180561 | |
| arena-props-low.glb | 194772 | 83286 | |
| arena-props.glb | 303372 | 150186 | |
| robot-kit-low.glb | 495220 | 196824 | |
| robot-kit.glb | 826656 | 369080 | |

Entry HTML loads: /favicon.svg, /assets/index-tBndO0f0.js, /assets/rolldown-runtime-hePW80VL.js, /assets/test-hooks-SslOmkyj.js, /assets/index-C8LDzkpJ.css.

## Served headers (vite preview)

| path | Cache-Control | Content-Encoding | ETag |
|---|---|---|---|
| / | no-cache | none | yes |
| /assets/RobotLab-*.js | no-cache | gzip | yes |
| /robot3d/robot-kit.glb?v=1 | no-cache | none | yes |
| /assets/rapier_wasm3d_bg-*.wasm | no-cache | none | yes |
