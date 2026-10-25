# bench:robot3d — 2026-10-25T17:34:43.093Z — sensors-on-school-1

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 518f6a2. Sensor overlays on (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 18.53–18.91 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 378.5 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | Run → moving (warm), every profile | 46 ms | ≤ 300 ms | ok | 2 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 3 | idle before a run, a parked robot, after an orbit settles |
| target | school: p95 frame time running at 1× | 334.3 ms | ≤ 33 ms | not met | 2 | every run scenario, low tier |
| target | school: p95 frame time running at 4× | 82.1 ms | ≤ 33 ms | not met | 1 | sim speed 4× and Kiểm tra 4× |
| target | school: long tasks > 100 ms during a run | 1  | ≤ 0  | not met | 3 | in the measuring window |
| target | school: first frame | 4351 ms | ≤ 2500 ms | not met | 3 | lesson page navigation → the scene drawn |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · line-follow | 5.8 | 3 | 173.5 / 334.3 / 702 | 11.7 / 17.7 | 1.5 | 44 + 0 | 0 (0) 0 | 3.1 (—) | 148 (22) | 95.4 (0.54) | 154.2 (0.87) | 0.1 | 99 | 18.53 |
| school · stop-at-wall | 60.2 | 49.5 | 16.6 / 20.2 / 22.2 | 3.7 / 7.9 | 1 | 41 + 0 | 0 (0) 0 | 16.4 (—) | 248 (87) | 63.7 (3.82) | 15.5 (0.93) | 0.1 | 88 | 18.91 |
| school · check-4x | 59.5 | 12.2 | 16.8 / 82.1 / 249.4 | 6.2 / 11.4 | 1.3 | 49 + 0 | 21 (1) 303 | 21.2 (—) | 294 (68) | 59.7 (2.17) | 25.6 (0.93) | 0.9 | 98 | 18.79 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · line-follow | 4207 | 511 | 2550 | 854 | 2713 | 3122 → 3169 | 2684 | 4031 | 898 (330) | 259 | 13 | 9.7 | 408 | 46 | 0 | — |
| school · stop-at-wall | 4351 | 613 | 1742 | 936 | 1886 | 2521 → 2570 | 1858 | 4050 | 810 (344) | 231 | 12 | 8.2 | 423 | 45 | 0 | — |
| school · check-4x | 2513 | 487 | 1166 | 842 | 1398 | 1558 → 1604 | 1375 | 2144 | 882 (334) | 342 | 12 | 9.9 | — | — | 0 | — |

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| school · line-follow | 52 (43, 0) | 5 | 22 Lambert, 10 Basic, 3 Sprite | 51046 | 36768 | 13 | 9.7: 4.8 + 2.3 + 0 + 2.5 | MeshLambertMaterial 850×700 canvas aniso 8; birch_face 1024×128 ImageBitmap; walnut 256×256 ImageBitmap; pcb_teal 200×256 ImageBitmap |

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
