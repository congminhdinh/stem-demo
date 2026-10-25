# bench:robot3d — 2026-10-25T22:14:52.601Z — final-school-sim4x-2

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 7661d33. Sensor overlays on (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 9.35–9.96 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 386.1 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | Run → moving (warm), every profile | 43 ms | ≤ 300 ms | ok | 2 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 2 | idle before a run, a parked robot, after an orbit settles |
| target | school: p95 frame time running at 4× | 20.1 ms | ≤ 33 ms | ok | 2 | sim speed 4× and Kiểm tra 4× |
| target | school: long tasks > 100 ms during a run | 0  | ≤ 0  | ok | 2 | in the measuring window |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school-sim4x · line-follow | 59.9 | 50.5 | 16.7 / 19.8 / 21.5 | 8.1 / 11.9 | 1.4 | 46 + 0 | 0 (0) 0 | 29.1 (—) | 503 (91) | 58.7 (3.41) | 16.8 (0.98) | 0.4 | 97 | 9.96 |
| school-sim4x · mini-mission | 59.9 | 49.8 | 16.7 / 20.1 / 198.1 | 6.7 / 10.9 | 1.4 | 49 + 0 | 0 (0) 0 | 30.4 (—) | 413 (62) | 31.9 (1.91) | 16 (0.96) | 0.7 | 97 | 9.35 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school-sim4x · line-follow | 4087 | 487 | 2642 | 853 | 2769 | 2991 → 3045 | 2742 | 3892 | 1022 (386) | 226 | 13 | 9.7 | 81 | 41 | 0 | — |
| school-sim4x · mini-mission | 2524 | 495 | 1211 | 851 | 1350 | 1563 → 1607 | 1318 | 2161 | 862 (340) | 245 | 12 | 9.9 | 80 | 43 | 0 | — |

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| school-sim4x · line-follow | 52 (40, 0) | 5 | 22 Lambert, 10 Basic, 3 Sprite | 51046 | 36754 | 13 | 9.7: 4.8 + 2.3 + 0 + 2.5 | MeshLambertMaterial 850×700 canvas aniso 8; birch_face 1024×128 ImageBitmap; walnut 256×256 ImageBitmap; pcb_teal 200×256 ImageBitmap |

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
