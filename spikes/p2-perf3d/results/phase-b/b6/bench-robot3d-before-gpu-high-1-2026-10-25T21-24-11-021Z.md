# bench:robot3d — 2026-10-25T21:24:11.021Z — before-gpu-high-1

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 844e9ce. Sensor overlays on (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 8.12–12.53 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 385.8 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | gpu-high: median fps of every run | 59.9 fps | ≥ 50 fps | ok | 3 | the plan’s ≥ 50 fps mid-range |
| budget | Run → moving (warm), every profile | 11 ms | ≤ 300 ms | ok | 3 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 5 | idle before a run, a parked robot, after an orbit settles |
| target | gpu-high: p95 frame time running | 17.4 ms | ≤ 20 ms | ok | 3 | every run scenario |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high · idle | 60.2 | 57.1 | 16.6 / 17.5 / 17.7 | 0.7 / 1.4 | 0.5 | 78 + 51 | 0 (0) 0 | — (—) | 63 (41) | 1.1 (0.07) | 1.9 (0.11) | 3 | 17 | 12.53 |
| gpu-high · line-follow | 59.9 | 58.1 | 16.7 / 17.2 / 17.4 | 1 / 1.6 | 0.4 | 84 + 51 | 0 (0) 0 | 10.7 (—) | 70 (34) | 1.1 (0.07) | 1.9 (0.12) | 0 | 18 | 10.54 |
| gpu-high · servo-gate | 59.9 | 57.5 | 16.7 / 17.4 / 33.3 | 1.1 / 1.8 | 0.5 | 87 + 53 | 0 (0) 0 | 16.4 (—) | 71 (28) | 0.9 (0.05) | 2 (0.12) | 0.1 | 17 | 8.65 |
| gpu-high · follow | 59.9 | 57.5 | 16.7 / 17.4 / 17.6 | 1.1 / 1.7 | 0.4 | 76 + 51 | 0 (0) 0 | 10.7 (—) | 73 (37) | 1.1 (0.07) | 2 (0.12) | 0 | 17 | 8.12 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high · idle | 1077 | 148 | 627 | 443 | 597 | 699 → 731 | 772 | 772 | 289 (135) | 21 | 16 | 54.5 | — | — | 0 | 0 |
| gpu-high · line-follow | 945 | 120 | 493 | 414 | 456 | 550 → 592 | 624 | 624 | 75 (75) | 16 | 16 | 54.5 | 14 | 6 | 0 | — |
| gpu-high · servo-gate | 952 | 123 | 499 | 418 | 462 | 554 → 595 | 626 | 626 | 124 (74) | 15 | 16 | 51.3 | 13 | 7 | 0 | — |
| gpu-high · follow | 917 | 151 | 528 | 440 | 491 | 586 → 628 | 654 | 654 | 130 (77) | 16 | 16 | 54.5 | 30 | 11 | 0 | — |

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
