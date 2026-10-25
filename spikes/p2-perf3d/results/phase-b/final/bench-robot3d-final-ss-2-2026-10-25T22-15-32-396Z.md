# bench:robot3d — 2026-10-25T22:15:32.396Z — final-ss-2

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 7661d33. Sensor overlays on (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 8.71–9.06 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 386.1 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | ss-low-4x: p5 fps of every run | 52.4 fps | ≥ 30 fps | ok | 2 | the plan’s ≥ 30 fps low tier at 4× |
| budget | Run → moving (warm), every profile | 27 ms | ≤ 300 ms | ok | 2 | click to the first render with the robot moved |
| budget | ss-low-4x: first Run → moving (physics loads) | 55 ms | ≤ 1500 ms | ok | 2 | the plan’s init physics ≤ 1.5 s at 4× |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 2 | idle before a run, a parked robot, after an orbit settles |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ss-low-4x · line-follow | 60.2 | 52.4 | 16.6 / 19.1 / 20.1 | 3.4 / 5.8 | 0.9 | 48 + 0 | 0 (0) 0 | 13 (—) | 231 (86) | 103.9 (6.23) | 14.6 (0.87) | 0 | 65 | 8.71 |
| ss-low-4x · mini-mission | 59.9 | 53.2 | 16.7 / 18.8 / 20 | 3.1 / 5.3 | 0.9 | 47 + 0 | 0 (0) 0 | 11.6 (—) | 218 (84) | 98.6 (5.91) | 14.5 (0.87) | 1.4 | 66 | 9.06 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ss-low-4x · line-follow | 3677 | 336 | 2261 | 661 | 2434 | 2593 → 2633 | 2328 | 3482 | 1923 (1394) | 1562 | 13 | 9.7 | 55 | 27 | 0 | — |
| ss-low-4x · mini-mission | 2108 | 335 | 857 | 664 | 942 | 1190 → 1222 | 927 | 1742 | 506 (215) | 152 | 12 | 9.9 | 51 | 27 | 0 | — |

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| ss-low-4x · line-follow | 52 (44, 0) | 5 | 22 Lambert, 10 Basic, 3 Sprite | 51046 | 36776 | 13 | 9.7: 4.8 + 2.3 + 0 + 2.5 | MeshLambertMaterial 850×700 canvas aniso 8; birch_face 1024×128 ImageBitmap; walnut 256×256 ImageBitmap; pcb_teal 200×256 ImageBitmap |

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
