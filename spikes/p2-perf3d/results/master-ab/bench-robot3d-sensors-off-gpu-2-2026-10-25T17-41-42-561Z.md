# bench:robot3d — 2026-10-25T17:41:42.561Z — sensors-off-gpu-2

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 518f6a2. Sensor overlays off (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 11.86–15.26 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 378.5 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | gpu-high: median fps of every run | 59.9 fps | ≥ 50 fps | ok | 2 | the plan’s ≥ 50 fps mid-range |
| budget | Run → moving (warm), every profile | 8 ms | ≤ 300 ms | ok | 2 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 2 | idle before a run, a parked robot, after an orbit settles |
| target | gpu-high: p95 frame time running | 18.5 ms | ≤ 20 ms | ok | 2 | every run scenario |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high · line-follow | 59.9 | 54.3 | 16.7 / 18.4 / 18.9 | 3.1 / 4.4 | 1.4 | 80 + 51 | 0 (0) 0 | 10.7 (—) | 181 (91) | 2.3 (0.14) | 4.6 (0.27) | 0 | 16 | 15.26 |
| gpu-high · stop-at-wall | 59.9 | 54.1 | 16.7 / 18.5 / 19 | 2.7 / 4.3 | 1.3 | 75 + 51 | 0 (0) 0 | 16.4 (—) | 158 (69) | 1.8 (0.11) | 4.2 (0.25) | 0.1 | 28 | 11.86 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high · line-follow | 1118 | 194 | 661 | 472 | 634 | 726 → 761 | 784 | 784 | 288 (137) | 24 | 16 | 54.5 | 74 | 7 | 0 | — |
| gpu-high · stop-at-wall | 967 | 126 | 510 | 425 | 475 | 568 → 610 | 640 | 640 | 127 (76) | 17 | 15 | 50.5 | 71 | 8 | 0 | — |

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| gpu-high · line-follow | 90 (79, 53) | 5 | 62 Standard, 10 Basic, 3 Sprite, 4 Physical | 97509 | 157204 | 16 | 54.5: 22.4 + 3.7 + 16 + 12.5 | MeshStandardMaterial 1360×1120 canvas aniso 8; PMREM.cubeUv 768×1024 other; birch_face 2048×256 ImageBitmap aniso 8; MeshStandardMaterial 680×560 canvas |

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
