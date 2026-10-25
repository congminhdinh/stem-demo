# bench:robot3d — 2026-10-25T21:29:39.476Z — after-gpu-high-3

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 844e9ce. Sensor overlays on (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 2.94–3.18 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 386 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | gpu-high: median fps of every run | 59.9 fps | ≥ 50 fps | ok | 3 | the plan’s ≥ 50 fps mid-range |
| budget | Run → moving (warm), every profile | 17 ms | ≤ 300 ms | ok | 3 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 5 | idle before a run, a parked robot, after an orbit settles |
| target | gpu-high: p95 frame time running | 19.2 ms | ≤ 20 ms | ok | 3 | every run scenario |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high · idle | 60.2 | 57.5 | 16.6 / 17.4 / 17.9 | 1.2 / 3.4 | 0.9 | 78 + 0 | 0 (0) 0 | — (—) | 127 (90) | 1.9 (0.11) | 3.8 (0.22) | 2.9 | 25 | 3.18 |
| gpu-high · line-follow | 59.9 | 54.1 | 16.7 / 18.5 / 19.6 | 1.7 / 4.1 | 0.7 | 84 + 51 | 0 (0) 0 | 10.7 (—) | 126 (61) | 1.8 (0.11) | 3.4 (0.2) | 0 | 24 | 3.08 |
| gpu-high · servo-gate | 59.9 | 52.1 | 16.7 / 19.2 / 33.6 | 1.9 / 4.7 | 0.9 | 87 + 53 | 0 (0) 0 | 16.4 (—) | 143 (54) | 1.4 (0.08) | 3.9 (0.23) | 0.1 | 24 | 2.94 |
| gpu-high · follow | 59.9 | 54.9 | 16.7 / 18.2 / 18.6 | 2.1 / 5 | 0.9 | 76 + 51 | 0 (0) 0 | 10.7 (—) | 157 (85) | 2.3 (0.14) | 4.1 (0.25) | 0 | 24 | 2.94 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high · idle | 1062 | 121 | 607 | 426 | 571 | 667 → 698 | 722 | 722 | 218 (139) | 16 | 16 | 54.5 | — | — | 0 | 0 |
| gpu-high · line-follow | 910 | 116 | 508 | 421 | 473 | 566 → 610 | 638 | 638 | 77 (77) | 17 | 16 | 54.5 | 14 | 17 | 0 | — |
| gpu-high · servo-gate | 974 | 116 | 515 | 427 | 479 | 571 → 600 | 626 | 626 | 125 (74) | 17 | 16 | 51.3 | 17 | 7 | 0 | — |
| gpu-high · follow | 980 | 116 | 518 | 429 | 482 | 577 → 620 | 644 | 644 | 130 (77) | 16 | 16 | 54.5 | 32 | 13 | 0 | — |

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
