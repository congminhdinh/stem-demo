# bench:robot3d — 2026-10-25T22:26:03.902Z — final-ss-3

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 7661d33. Sensor overlays on (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 10.53–10.77 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 386.1 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | ss-low-4x: p5 fps of every run | 52.6 fps | ≥ 30 fps | ok | 2 | the plan’s ≥ 30 fps low tier at 4× |
| budget | Run → moving (warm), every profile | 26 ms | ≤ 300 ms | ok | 2 | click to the first render with the robot moved |
| budget | ss-low-4x: first Run → moving (physics loads) | 52 ms | ≤ 1500 ms | ok | 2 | the plan’s init physics ≤ 1.5 s at 4× |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 2 | idle before a run, a parked robot, after an orbit settles |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ss-low-4x · line-follow | 59.9 | 53.2 | 16.7 / 18.8 / 19.6 | 3.1 / 5.2 | 0.9 | 48 + 0 | 0 (0) 0 | 10.6 (—) | 213 (79) | 96.2 (5.76) | 14.5 (0.87) | 0 | 66 | 10.77 |
| ss-low-4x · mini-mission | 60.2 | 52.6 | 16.6 / 19 / 19.7 | 3.2 / 5.6 | 0.9 | 47 + 0 | 0 (0) 0 | 11.6 (—) | 220 (86) | 95.6 (5.73) | 14.5 (0.87) | 1.4 | 65 | 10.53 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ss-low-4x · line-follow | 3554 | 324 | 2149 | 648 | 2326 | 2486 → 2522 | 2220 | 3360 | 1812 (1293) | 1466 | 13 | 9.7 | 51 | 26 | 0 | — |
| ss-low-4x · mini-mission | 2128 | 344 | 864 | 671 | 951 | 1199 → 1232 | 937 | 1758 | 504 (214) | 154 | 12 | 9.9 | 52 | 26 | 0 | — |

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
