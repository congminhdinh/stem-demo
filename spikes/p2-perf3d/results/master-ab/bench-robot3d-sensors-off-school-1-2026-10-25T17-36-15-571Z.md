# bench:robot3d — 2026-10-25T17:36:15.571Z — sensors-off-school-1

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 518f6a2. Sensor overlays off (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 21.35–24.86 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 378.5 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | Run → moving (warm), every profile | 59 ms | ≤ 300 ms | ok | 2 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 3 | idle before a run, a parked robot, after an orbit settles |
| target | school: p95 frame time running at 1× | 729.9 ms | ≤ 33 ms | not met | 2 | every run scenario, low tier |
| target | school: p95 frame time running at 4× | 66.6 ms | ≤ 33 ms | not met | 1 | sim speed 4× and Kiểm tra 4× |
| target | school: long tasks > 100 ms during a run | 1  | ≤ 0  | not met | 3 | in the measuring window |
| target | school: first frame | 4283 ms | ≤ 2500 ms | not met | 3 | lesson page navigation → the scene drawn |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · line-follow | 6.2 | 3.7 | 162.1 / 269.9 / 743 | 12.2 / 16.1 | 1.5 | 40 + 0 | 0 (0) 0 | 2.9 (—) | 134 (18) | 93.8 (0.47) | 173.3 (0.87) | 0.1 | 98 | 21.93 |
| school · stop-at-wall | 6.1 | 1.4 | 164.8 / 729.9 / 820.5 | 11.9 / 18.2 | 1.3 | 37 + 0 | 0 (0) 0 | 2.6 (—) | 69 (16) | 81.5 (0.4) | 179.8 (0.87) | 0 | 102 | 21.35 |
| school · check-4x | 59.2 | 15 | 16.9 / 66.6 / 180.9 | 8.7 / 14.9 | 1.5 | 45 + 0 | 27 (1) 366 | 32.2 (—) | 591 (130) | 55.8 (3.05) | 18.7 (1.02) | 1 | 98 | 24.86 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · line-follow | 3998 | 478 | 2529 | 827 | 2697 | 2891 → 2939 | 2669 | 3826 | 936 (325) | 266 | 13 | 9.7 | 399 | 43 | 0 | — |
| school · stop-at-wall | 4283 | 634 | 1908 | 981 | 2052 | 2620 → 2671 | 2021 | 4073 | 799 (348) | 239 | 12 | 8.2 | 411 | 59 | 0 | — |
| school · check-4x | 2509 | 483 | 1155 | 837 | 1385 | 1543 → 1587 | 1362 | 2148 | 873 (333) | 335 | 12 | 9.9 | — | — | 0 | — |

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| school · line-follow | 52 (40, 0) | 5 | 22 Lambert, 10 Basic, 3 Sprite | 51046 | 36364 | 13 | 9.7: 4.8 + 2.3 + 0 + 2.5 | MeshLambertMaterial 850×700 canvas aniso 8; birch_face 1024×128 ImageBitmap; walnut 256×256 ImageBitmap; pcb_teal 200×256 ImageBitmap |

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
