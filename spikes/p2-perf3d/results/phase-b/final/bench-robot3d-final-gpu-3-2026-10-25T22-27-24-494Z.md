# bench:robot3d — 2026-10-25T22:27:24.494Z — final-gpu-3

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 7661d33. Sensor overlays on (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 7.06–13.46 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 386.1 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | gpu-high: median fps of every run | 59.9 fps | ≥ 50 fps | ok | 4 | the plan’s ≥ 50 fps mid-range |
| budget | Run → moving (warm), every profile | 9 ms | ≤ 300 ms | ok | 3 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 6 | idle before a run, a parked robot, after an orbit settles |
| target | gpu-high: p95 frame time running | 18.3 ms | ≤ 20 ms | ok | 4 | every run scenario |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high · idle | 59.9 | 56.5 | 16.7 / 17.7 / 18.8 | 0.6 / 1 | 0.4 | 78 + 0 | 0 (0) 0 | — (—) | 54 (34) | 0.9 (0.05) | 1.7 (0.1) | 3 | 16 | 13.46 |
| gpu-high · line-follow | 59.9 | 54.6 | 16.7 / 18.3 / 18.8 | 1.1 / 1.6 | 0.5 | 84 + 51 | 0 (0) 0 | 10.7 (—) | 74 (36) | 1.1 (0.07) | 2 (0.12) | 0 | 16 | 12.01 |
| gpu-high · mini-mission | 59.9 | 54.9 | 16.7 / 18.2 / 18.6 | 1 / 1.5 | 0.4 | 83 + 54 | 0 (0) 0 | 11.6 (—) | 66 (33) | 1 (0.06) | 1.8 (0.11) | 1.4 | 16 | 9.33 |
| gpu-high · follow | 59.9 | 54.9 | 16.7 / 18.2 / 18.5 | 1.1 / 1.6 | 0.5 | 76 + 51 | 0 (0) 0 | 10.7 (—) | 74 (38) | 1.1 (0.07) | 2 (0.12) | 0 | 16 | 7.94 |
| gpu-high · teleop | 59.9 | 54.9 | 16.7 / 18.2 / 18.6 | 1.2 / 1.5 | 0.5 | 83 + 54 | 0 (0) 0 | 12.1 (—) | 76 (37) | 1.5 (0.09) | 2.2 (0.13) | 0 | 17 | 7.06 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high · idle | 1082 | 151 | 632 | 448 | 603 | 704 → 736 | 772 | 772 | 289 (133) | 23 | 16 | 54.5 | — | — | 0 | 0 |
| gpu-high · line-follow | 961 | 133 | 511 | 427 | 475 | 570 → 614 | 640 | 640 | 130 (78) | 17 | 16 | 54.5 | 15 | 6 | 0 | — |
| gpu-high · mini-mission | 956 | 131 | 504 | 423 | 469 | 563 → 606 | 631 | 631 | 131 (79) | 17 | 15 | 55.3 | 13 | 6 | 0 | — |
| gpu-high · follow | 952 | 127 | 502 | 420 | 464 | 561 → 604 | 627 | 627 | 129 (78) | 16 | 16 | 54.5 | 25 | 9 | 0 | — |
| gpu-high · teleop | 955 | 130 | 504 | 426 | 466 | 562 → 604 | 643 | 643 | 128 (76) | 17 | 17 | 57.1 | — | — | 0 | — |

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| gpu-high · idle | 90 (78, 53) | 5 | 62 Standard, 10 Basic, 3 Sprite, 4 Physical | 97509 | 81474 | 16 | 54.5: 22.4 + 3.7 + 16 + 12.5 | MeshStandardMaterial 1360×1120 canvas aniso 8; PMREM.cubeUv 768×1024 other; birch_face 2048×256 ImageBitmap aniso 8; MeshStandardMaterial 680×560 canvas |

## Bundle (gzip -6)

| file | bytes | gzip | holds |
|---|---|---|---|
| test-hooks-DEejnb95.js | 1447064 | 411816 | — |
| RobotLab-BTFZ3RXO.js | 1350637 | 386077 | three, r3f, gltfLoader, meshopt |
| index-pfsFlOq_.js | 479886 | 144391 | — |
| rapier-DZ_EfFMH.js | 295823 | 52055 | rapier |
| rolldown-runtime-hePW80VL.js | 716 | 428 | — |
| rapier_wasm3d_bg-DZsYp9WG.wasm | 3105893 | 1180561 | |
| arena-props-low.glb | 194772 | 83286 | |
| arena-props.glb | 303372 | 150186 | |
| robot-kit-low.glb | 495220 | 196824 | |
| robot-kit.glb | 826656 | 369080 | |

Entry HTML loads: /favicon.svg, /assets/index-pfsFlOq_.js, /assets/rolldown-runtime-hePW80VL.js, /assets/test-hooks-DEejnb95.js, /assets/index-CgMmDkmz.css.

## Served headers (vite preview)

| path | Cache-Control | Content-Encoding | ETag |
|---|---|---|---|
| / | no-cache | none | yes |
| /assets/RobotLab-*.js | no-cache | gzip | yes |
| /robot3d/robot-kit.glb?v=1 | no-cache | none | yes |
| /assets/rapier_wasm3d_bg-*.wasm | no-cache | none | yes |
