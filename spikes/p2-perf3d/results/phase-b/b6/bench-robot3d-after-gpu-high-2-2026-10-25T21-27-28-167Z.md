# bench:robot3d — 2026-10-25T21:27:28.167Z — after-gpu-high-2

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 844e9ce. Sensor overlays on (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 3.08–3.38 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 386 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | gpu-high: median fps of every run | 59.9 fps | ≥ 50 fps | ok | 3 | the plan’s ≥ 50 fps mid-range |
| budget | Run → moving (warm), every profile | 17 ms | ≤ 300 ms | ok | 3 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 5 | idle before a run, a parked robot, after an orbit settles |
| target | gpu-high: p95 frame time running | 18.7 ms | ≤ 20 ms | ok | 3 | every run scenario |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high · idle | 59.9 | 57.8 | 16.7 / 17.3 / 17.6 | 1.3 / 3.1 | 0.9 | 78 + 0 | 0 (0) 0 | — (—) | 121 (85) | 1.8 (0.1) | 3.8 (0.22) | 2.9 | 25 | 3.08 |
| gpu-high · line-follow | 60.2 | 55.6 | 16.6 / 18 / 19 | 1.9 / 3.7 | 0.7 | 84 + 51 | 0 (0) 0 | 10.7 (—) | 132 (62) | 1.9 (0.11) | 3.6 (0.22) | 0 | 24 | 3.38 |
| gpu-high · servo-gate | 60.2 | 53.5 | 16.6 / 18.7 / 33.2 | 1.8 / 4.3 | 0.8 | 87 + 53 | 0 (0) 0 | 16.4 (—) | 132 (48) | 1.3 (0.08) | 3.5 (0.21) | 0.1 | 26 | 3.38 |
| gpu-high · follow | 59.9 | 56.8 | 16.7 / 17.6 / 17.9 | 2 / 5.1 | 0.8 | 76 + 51 | 0 (0) 0 | 10.7 (—) | 153 (82) | 2.1 (0.13) | 4.1 (0.24) | 0 | 24 | 3.3 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high · idle | 1052 | 124 | 599 | 421 | 562 | 659 → 691 | 716 | 716 | 208 (129) | 15 | 16 | 54.5 | — | — | 0 | 0 |
| gpu-high · line-follow | 982 | 119 | 519 | 431 | 484 | 577 → 617 | 649 | 649 | 126 (75) | 17 | 16 | 54.5 | 23 | 17 | 0 | — |
| gpu-high · servo-gate | 914 | 117 | 515 | 426 | 479 | 570 → 601 | 623 | 623 | 74 (74) | 17 | 16 | 51.3 | 24 | 11 | 0 | — |
| gpu-high · follow | 910 | 116 | 502 | 416 | 466 | 559 → 600 | 626 | 626 | 75 (75) | 17 | 16 | 54.5 | 27 | 16 | 0 | — |

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| gpu-high · idle | 90 (78, 53) | 5 | 62 Standard, 10 Basic, 3 Sprite, 4 Physical | 97509 | 81474 | 16 | 54.5: 22.4 + 3.7 + 16 + 12.5 | MeshStandardMaterial 1360×1120 canvas aniso 8; PMREM.cubeUv 768×1024 other; birch_face 2048×256 ImageBitmap aniso 8; MeshStandardMaterial 680×560 canvas |

## Bundle (gzip -6)

| file | bytes | gzip | holds |
|---|---|---|---|
| test-hooks-DEejnb95.js | 1447064 | 411816 | — |
| RobotLab-CJOdoDNe.js | 1350538 | 386027 | three, r3f, gltfLoader, meshopt |
| index-BTVphlDh.js | 479886 | 144388 | — |
| rapier-DZ_EfFMH.js | 295823 | 52055 | rapier |
| rolldown-runtime-hePW80VL.js | 716 | 428 | — |
| rapier_wasm3d_bg-DZsYp9WG.wasm | 3105893 | 1180561 | |
| arena-props-low.glb | 194772 | 83286 | |
| arena-props.glb | 303372 | 150186 | |
| robot-kit-low.glb | 495220 | 196824 | |
| robot-kit.glb | 826656 | 369080 | |

Entry HTML loads: /favicon.svg, /assets/index-BTVphlDh.js, /assets/rolldown-runtime-hePW80VL.js, /assets/test-hooks-DEejnb95.js, /assets/index-CgMmDkmz.css.

## Served headers (vite preview)

| path | Cache-Control | Content-Encoding | ETag |
|---|---|---|---|
| / | no-cache | none | yes |
| /assets/RobotLab-*.js | no-cache | gzip | yes |
| /robot3d/robot-kit.glb?v=1 | no-cache | none | yes |
| /assets/rapier_wasm3d_bg-*.wasm | no-cache | none | yes |
