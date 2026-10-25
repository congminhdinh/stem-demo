# bench:robot3d — 2026-10-25T21:05:19.711Z — after-gpu-high-3

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit f2ff258. Sensor overlays on (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 3.77–4.59 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 385.8 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | gpu-high: median fps of every run | 60.2 fps | ≥ 50 fps | ok | 2 | the plan’s ≥ 50 fps mid-range |
| budget | Run → moving (warm), every profile | 18 ms | ≤ 300 ms | ok | 2 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 2 | idle before a run, a parked robot, after an orbit settles |
| target | gpu-high: p95 frame time running | 18.2 ms | ≤ 20 ms | ok | 2 | every run scenario |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high · mini-mission | 60.2 | 54.9 | 16.6 / 18.2 / 18.8 | 1.9 / 4.9 | 0.8 | 83 + 54 | 0 (0) 0 | 11.7 (—) | 154 (78) | 2.1 (0.13) | 4 (0.24) | 1 | 25 | 4.59 |
| gpu-high · follow | 60.2 | 57.5 | 16.6 / 17.4 / 17.9 | 2 / 5 | 0.8 | 76 + 51 | 0 (0) 0 | 10.7 (—) | 157 (83) | 2.3 (0.14) | 4.1 (0.24) | 0 | 23 | 3.77 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high · mini-mission | 1060 | 122 | 607 | 428 | 569 | 666 → 696 | 721 | 721 | 218 (139) | 15 | 15 | 55.3 | 25 | 18 | 0 | — |
| gpu-high · follow | 979 | 118 | 516 | 430 | 481 | 574 → 603 | 627 | 627 | 128 (77) | 17 | 16 | 54.5 | 28 | 17 | 0 | — |

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| gpu-high · mini-mission | 93 (81, 54) | 7 | 62 Standard, 10 Basic, 5 Sprite, 4 Physical | 98018 | 160356 | 15 | 55.3: 23.1 + 3.7 + 16 + 12.5 | MeshStandardMaterial 1440×1120 canvas aniso 8; PMREM.cubeUv 768×1024 other; birch_face 2048×256 ImageBitmap aniso 8; MeshStandardMaterial 720×560 canvas |

## Bundle (gzip -6)

| file | bytes | gzip | holds |
|---|---|---|---|
| test-hooks-DEejnb95.js | 1447064 | 411816 | — |
| RobotLab-CuRYwkCZ.js | 1349801 | 385812 | three, r3f, gltfLoader, meshopt |
| index-CqFmtzXW.js | 479886 | 144390 | — |
| rapier-DZ_EfFMH.js | 295823 | 52055 | rapier |
| rolldown-runtime-hePW80VL.js | 716 | 428 | — |
| rapier_wasm3d_bg-DZsYp9WG.wasm | 3105893 | 1180561 | |
| arena-props-low.glb | 194772 | 83286 | |
| arena-props.glb | 303372 | 150186 | |
| robot-kit-low.glb | 495220 | 196824 | |
| robot-kit.glb | 826656 | 369080 | |

Entry HTML loads: /favicon.svg, /assets/index-CqFmtzXW.js, /assets/rolldown-runtime-hePW80VL.js, /assets/test-hooks-DEejnb95.js, /assets/index-CgMmDkmz.css.

## Served headers (vite preview)

| path | Cache-Control | Content-Encoding | ETag |
|---|---|---|---|
| / | no-cache | none | yes |
| /assets/RobotLab-*.js | no-cache | gzip | yes |
| /robot3d/robot-kit.glb?v=1 | no-cache | none | yes |
| /assets/rapier_wasm3d_bg-*.wasm | no-cache | none | yes |
