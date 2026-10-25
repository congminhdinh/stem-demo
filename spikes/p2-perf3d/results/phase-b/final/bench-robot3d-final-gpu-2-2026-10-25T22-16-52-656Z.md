# bench:robot3d — 2026-10-25T22:16:52.656Z — final-gpu-2

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 7661d33. Sensor overlays on (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 5.91–9.74 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 386.1 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | gpu-high: median fps of every run | 59.9 fps | ≥ 50 fps | ok | 4 | the plan’s ≥ 50 fps mid-range |
| budget | Run → moving (warm), every profile | 10 ms | ≤ 300 ms | ok | 3 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 6 | idle before a run, a parked robot, after an orbit settles |
| target | gpu-high: p95 frame time running | 18.3 ms | ≤ 20 ms | ok | 4 | every run scenario |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high · idle | 59.9 | 54.9 | 16.7 / 18.2 / 18.7 | 0.6 / 1.1 | 0.5 | 78 + 0 | 0 (0) 0 | — (—) | 57 (38) | 1.1 (0.06) | 1.8 (0.11) | 3 | 16 | 9.74 |
| gpu-high · line-follow | 59.9 | 55.6 | 16.7 / 18 / 18.6 | 1.1 / 1.6 | 0.5 | 84 + 51 | 0 (0) 0 | 10.7 (—) | 76 (37) | 1.2 (0.07) | 2 (0.12) | 0 | 16 | 8.52 |
| gpu-high · mini-mission | 59.9 | 54.6 | 16.7 / 18.3 / 18.6 | 1 / 1.6 | 0.5 | 83 + 54 | 0 (0) 0 | 11.7 (—) | 72 (36) | 1.1 (0.07) | 1.9 (0.12) | 1.4 | 17 | 7.67 |
| gpu-high · follow | 59.9 | 54.6 | 16.7 / 18.3 / 18.6 | 1.1 / 1.6 | 0.4 | 76 + 51 | 0 (0) 0 | 10.7 (—) | 74 (37) | 1.2 (0.07) | 2.1 (0.13) | 0 | 16 | 6.54 |
| gpu-high · teleop | 60.2 | 54.6 | 16.6 / 18.3 / 18.5 | 1.1 / 1.5 | 0.5 | 83 + 54 | 0 (0) 0 | 12.1 (—) | 74 (36) | 1.4 (0.09) | 2.2 (0.13) | 0 | 19 | 5.91 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high · idle | 1055 | 133 | 605 | 425 | 571 | 673 → 705 | 731 | 731 | 266 (127) | 18 | 16 | 54.5 | — | — | 0 | 0 |
| gpu-high · line-follow | 954 | 129 | 506 | 423 | 469 | 566 → 609 | 641 | 641 | 130 (79) | 17 | 16 | 54.5 | 13 | 6 | 0 | — |
| gpu-high · mini-mission | 956 | 128 | 503 | 421 | 466 | 563 → 617 | 638 | 638 | 132 (80) | 16 | 15 | 55.3 | 13 | 7 | 0 | — |
| gpu-high · follow | 958 | 128 | 505 | 423 | 468 | 564 → 609 | 632 | 632 | 128 (78) | 16 | 16 | 54.5 | 26 | 10 | 0 | — |
| gpu-high · teleop | 966 | 125 | 507 | 425 | 471 | 566 → 608 | 644 | 644 | 129 (78) | 17 | 17 | 57.1 | — | — | 0 | — |

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
