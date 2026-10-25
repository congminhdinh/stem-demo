# bench:robot3d — 2026-10-25T21:28:33.866Z — before-gpu-high-3

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 844e9ce. Sensor overlays on (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 3.3–3.65 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 385.8 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | gpu-high: median fps of every run | 59.9 fps | ≥ 50 fps | ok | 3 | the plan’s ≥ 50 fps mid-range |
| budget | Run → moving (warm), every profile | 18 ms | ≤ 300 ms | ok | 3 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 5 | idle before a run, a parked robot, after an orbit settles |
| target | gpu-high: p95 frame time running | 18.3 ms | ≤ 20 ms | ok | 3 | every run scenario |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high · idle | 60.2 | 57.1 | 16.6 / 17.5 / 17.9 | 1.3 / 3.2 | 1 | 78 + 51 | 0 (0) 0 | — (—) | 121 (87) | 2.1 (0.12) | 3.7 (0.22) | 3 | 23 | 3.45 |
| gpu-high · line-follow | 60.2 | 56.2 | 16.6 / 17.8 / 18.4 | 1.7 / 4 | 0.7 | 84 + 51 | 0 (0) 0 | 10.7 (—) | 125 (61) | 1.8 (0.11) | 3.4 (0.2) | 0 | 25 | 3.38 |
| gpu-high · servo-gate | 59.9 | 54.6 | 16.7 / 18.3 / 33.9 | 1.9 / 4.7 | 0.8 | 87 + 53 | 0 (0) 0 | 16.4 (—) | 136 (48) | 1.3 (0.08) | 3.6 (0.21) | 0.1 | 24 | 3.65 |
| gpu-high · follow | 59.9 | 57.5 | 16.7 / 17.4 / 18.1 | 2 / 5.2 | 0.8 | 76 + 51 | 0 (0) 0 | 10.7 (—) | 155 (85) | 2.2 (0.13) | 4.1 (0.24) | 0 | 23 | 3.3 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high · idle | 1049 | 125 | 600 | 423 | 564 | 658 → 690 | 716 | 716 | 258 (130) | 16 | 16 | 54.5 | — | — | 0 | 0 |
| gpu-high · line-follow | 978 | 119 | 520 | 431 | 485 | 578 → 619 | 641 | 641 | 129 (76) | 17 | 16 | 54.5 | 24 | 18 | 0 | — |
| gpu-high · servo-gate | 970 | 117 | 514 | 425 | 478 | 569 → 609 | 646 | 646 | 74 (74) | 17 | 16 | 51.3 | 20 | 18 | 0 | — |
| gpu-high · follow | 911 | 116 | 507 | 421 | 472 | 564 → 605 | 626 | 626 | 74 (74) | 17 | 16 | 54.5 | 27 | 15 | 0 | — |

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| gpu-high · idle | 90 (78, 53) | 5 | 62 Standard, 10 Basic, 3 Sprite, 4 Physical | 97509 | 156682 | 16 | 54.5: 22.4 + 3.7 + 16 + 12.5 | MeshStandardMaterial 1360×1120 canvas aniso 8; PMREM.cubeUv 768×1024 other; birch_face 2048×256 ImageBitmap aniso 8; MeshStandardMaterial 680×560 canvas |

## Bundle (gzip -6)

| file | bytes | gzip | holds |
|---|---|---|---|
| test-hooks-DEejnb95.js | 1447064 | 411816 | — |
| RobotLab-BL07lirD.js | 1349944 | 385844 | three, r3f, gltfLoader, meshopt |
| index-BtCBo9yI.js | 479886 | 144387 | — |
| rapier-DZ_EfFMH.js | 295823 | 52055 | rapier |
| rolldown-runtime-hePW80VL.js | 716 | 428 | — |
| rapier_wasm3d_bg-DZsYp9WG.wasm | 3105893 | 1180561 | |
| arena-props-low.glb | 194772 | 83286 | |
| arena-props.glb | 303372 | 150186 | |
| robot-kit-low.glb | 495220 | 196824 | |
| robot-kit.glb | 826656 | 369080 | |

Entry HTML loads: /favicon.svg, /assets/index-BtCBo9yI.js, /assets/rolldown-runtime-hePW80VL.js, /assets/test-hooks-DEejnb95.js, /assets/index-CgMmDkmz.css.

## Served headers (vite preview)

| path | Cache-Control | Content-Encoding | ETag |
|---|---|---|---|
| / | no-cache | none | yes |
| /assets/RobotLab-*.js | no-cache | gzip | yes |
| /robot3d/robot-kit.glb?v=1 | no-cache | none | yes |
| /assets/rapier_wasm3d_bg-*.wasm | no-cache | none | yes |
