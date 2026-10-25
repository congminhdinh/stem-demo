# bench:robot3d — 2026-10-25T16:21:31.842Z — ab-no-shader-checks-1

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 7de18d0. Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 12.9–13.04 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 370 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | Run → moving (warm), every profile | 40 ms | ≤ 300 ms | ok | 1 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 3 | idle before a run, a parked robot, after an orbit settles |
| target | school: p95 frame time running at 1× | 19 ms | ≤ 33 ms | ok | 1 | every run scenario, low tier |
| target | school: long tasks > 100 ms during a run | 0  | ≤ 0  | ok | 1 | in the measuring window |
| target | school: first frame | 5454 ms | ≤ 2500 ms | not met | 2 | lesson page navigation → the scene drawn |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 59.5 | 53.8 | 16.8 / 18.6 / 19.1 | 2.7 / 4 | 1.4 | 40 + 0 | 0 (0) 0 | — (—) | 243 (129) | 86.8 (4.98) | 16.3 (0.94) | 98 | 13.04 |
| school · line-follow | 60.2 | 52.6 | 16.6 / 19 / 20.1 | 4.1 / 8 | 1 | 44 + 0 | 0 (0) 0 | 13.1 (—) | 280 (98) | 103.4 (6.2) | 15.7 (0.94) | 97 | 12.9 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 5454 | 568 | 3655 | 920 | 3808 | 4066 → 4126 | 4936 | 5293 | 2077 (775) | 262 | 11 | 9.6 | — | — | 0 | 0 |
| school · line-follow | 2422 | 459 | 1085 | 805 | 1211 | 1419 → 1468 | 1909 | 2012 | 1164 (428) | 222 | 11 | 9.6 | 390 | 40 | 0 | — |

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| school · idle | 49 (39, 0) | 4 | 22 Lambert, 8 Basic, 2 Sprite | 50664 | 36360 | 11 | 9.6: 4.7 + 2.3 + 0 + 2.5 | MeshLambertMaterial 850×700 canvas aniso 8; birch_face 1024×128 ImageBitmap; walnut 256×256 ImageBitmap; pcb_teal 200×256 ImageBitmap |

## Bundle (gzip -6)

| file | bytes | gzip | holds |
|---|---|---|---|
| test-hooks-SslOmkyj.js | 1438871 | 409492 | — |
| RobotLab-B0CtYHCK.js | 1305722 | 370034 | three, r3f, gltfLoader, meshopt |
| index-tBndO0f0.js | 483855 | 145819 | — |
| rapier-DZ_EfFMH.js | 295823 | 52055 | rapier |
| rolldown-runtime-hePW80VL.js | 716 | 428 | — |
| rapier_wasm3d_bg-DZsYp9WG.wasm | 3105893 | 1180561 | |
| arena-props-low.glb | 194772 | 83286 | |
| arena-props.glb | 303372 | 150186 | |
| robot-kit-low.glb | 495220 | 196824 | |
| robot-kit.glb | 826656 | 369080 | |

Entry HTML loads: /favicon.svg, /assets/index-tBndO0f0.js, /assets/rolldown-runtime-hePW80VL.js, /assets/test-hooks-SslOmkyj.js, /assets/index-C8LDzkpJ.css.

## Served headers (vite preview)

| path | Cache-Control | Content-Encoding | ETag |
|---|---|---|---|
| / | no-cache | none | yes |
| /assets/RobotLab-*.js | no-cache | gzip | yes |
| /robot3d/robot-kit.glb?v=1 | no-cache | none | yes |
| /assets/rapier_wasm3d_bg-*.wasm | no-cache | none | yes |
