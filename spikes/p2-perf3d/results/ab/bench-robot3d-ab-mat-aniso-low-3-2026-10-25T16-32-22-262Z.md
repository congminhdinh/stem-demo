# bench:robot3d — 2026-10-25T16:32:22.262Z — ab-mat-aniso-low-3

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit de86a10. Sensor overlays on (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 5.25–5.28 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 370 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | Run → moving (warm), every profile | 40 ms | ≤ 300 ms | ok | 1 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 4 | idle before a run, a parked robot, after an orbit settles |
| target | school: p95 frame time running at 1× | 19.6 ms | ≤ 33 ms | ok | 2 | every run scenario, low tier |
| target | school: long tasks > 100 ms during a run | 0  | ≤ 0  | ok | 2 | in the measuring window |
| target | school: first frame | 3804 ms | ≤ 2500 ms | not met | 3 | lesson page navigation → the scene drawn |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 60.2 | 53.2 | 16.6 / 18.8 / 19.7 | 1.6 / 2.9 | 0.9 | 40 + 0 | 0 (0) 0 | — (—) | 151 (77) | 87.9 (5.03) | 15.9 (0.91) | 96 | 5.27 |
| school · line-follow | 60.2 | 51 | 16.6 / 19.6 / 20.5 | 3.4 / 6.9 | 0.9 | 44 + 0 | 0 (0) 0 | 13 (—) | 246 (90) | 101.9 (6.1) | 15.6 (0.93) | 97 | 5.28 |
| school · teleop | 59.9 | 52.4 | 16.7 / 19.1 / 19.9 | 4.1 / 6.1 | 1.1 | 40 + 0 | 0 (0) 0 | 11.9 (—) | 267 (94) | 123.9 (7.43) | 15.8 (0.94) | 94 | 5.25 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 3804 | 452 | 2392 | 794 | 2518 | 2726 → 2777 | 3288 | 3579 | 1309 (508) | 215 | 11 | 9.6 | — | — | 0 | 0 |
| school · line-follow | 2358 | 462 | 1081 | 809 | 1205 | 1416 → 1464 | 1846 | 2025 | 1100 (382) | 221 | 11 | 9.6 | 371 | 40 | 0 | — |
| school · teleop | 2397 | 448 | 1036 | 789 | 1170 | 1371 → 1423 | 1885 | 2045 | 694 (307) | 230 | 12 | 10.3 | — | — | 0 | — |

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| school · idle | 49 (39, 0) | 4 | 22 Lambert, 8 Basic, 2 Sprite | 50664 | 36360 | 11 | 9.6: 4.7 + 2.3 + 0 + 2.5 | MeshLambertMaterial 850×700 canvas; birch_face 1024×128 ImageBitmap; walnut 256×256 ImageBitmap; pcb_teal 200×256 ImageBitmap |

## Bundle (gzip -6)

| file | bytes | gzip | holds |
|---|---|---|---|
| test-hooks-SslOmkyj.js | 1438871 | 409492 | — |
| RobotLab-jB9O_YJ9.js | 1305697 | 370020 | three, r3f, gltfLoader, meshopt |
| index-CpovUcaS.js | 483855 | 145821 | — |
| rapier-DZ_EfFMH.js | 295823 | 52055 | rapier |
| rolldown-runtime-hePW80VL.js | 716 | 428 | — |
| rapier_wasm3d_bg-DZsYp9WG.wasm | 3105893 | 1180561 | |
| arena-props-low.glb | 194772 | 83286 | |
| arena-props.glb | 303372 | 150186 | |
| robot-kit-low.glb | 495220 | 196824 | |
| robot-kit.glb | 826656 | 369080 | |

Entry HTML loads: /favicon.svg, /assets/index-CpovUcaS.js, /assets/rolldown-runtime-hePW80VL.js, /assets/test-hooks-SslOmkyj.js, /assets/index-C8LDzkpJ.css.

## Served headers (vite preview)

| path | Cache-Control | Content-Encoding | ETag |
|---|---|---|---|
| / | no-cache | none | yes |
| /assets/RobotLab-*.js | no-cache | gzip | yes |
| /robot3d/robot-kit.glb?v=1 | no-cache | none | yes |
| /assets/rapier_wasm3d_bg-*.wasm | no-cache | none | yes |
