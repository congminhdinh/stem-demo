# bench:robot3d — 2026-10-25T22:03:38.318Z — final-school-1

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 7661d33. Sensor overlays on (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 6.2–10.91 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 386.1 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | Run → moving (warm), every profile | 61 ms | ≤ 300 ms | ok | 3 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 8 | idle before a run, a parked robot, after an orbit settles |
| target | school: p95 frame time running at 1× | 20.2 ms | ≤ 33 ms | ok | 5 | every run scenario, low tier |
| target | school: p95 frame time running at 4× | 22.1 ms | ≤ 33 ms | ok | 1 | sim speed 4× and Kiểm tra 4× |
| target | school: long tasks > 100 ms during a run | 0  | ≤ 0  | ok | 6 | in the measuring window |
| target | school: first frame | 4403 ms | ≤ 2500 ms | not met | 7 | lesson page navigation → the scene drawn |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 60.2 | 51 | 16.6 / 19.6 / 20 | 3.1 / 5.7 | 1.7 | 41 + 0 | 0 (0) 0 | — (—) | 262 (151) | 87 (4.99) | 16.4 (0.94) | 2.6 | 100 | 6.2 |
| school · line-follow | 60.2 | 50.8 | 16.6 / 19.7 / 21.7 | 6.6 / 10.6 | 1.6 | 48 + 0 | 0 (0) 0 | 10.9 (—) | 440 (159) | 93 (5.56) | 16.3 (0.97) | 0 | 102 | 6.72 |
| school · mini-mission | 59.5 | 49.5 | 16.8 / 20.2 / 22 | 6.5 / 11 | 1.6 | 47 + 0 | 0 (0) 0 | 11.6 (—) | 445 (169) | 91.4 (5.47) | 16.3 (0.98) | 1.4 | 103 | 8.44 |
| school · check-1x | 60.6 | 50.5 | 16.5 / 19.8 / 21.1 | 6.1 / 10.7 | 1.5 | 47 + 0 | 0 (0) 0 | 12.9 (—) | 409 (156) | 97.5 (5.84) | 16.2 (0.97) | 1.4 | 101 | 10.91 |
| school · check-4x | 60.2 | 45.2 | 16.6 / 22.1 / 50.2 | 8.9 / 14.7 | 1.7 | 49 + 0 | 0 (0) 0 | 34.1 (—) | 588 (107) | 55.8 (3.25) | 17.1 (1) | 1.3 | 101 | 9.98 |
| school · follow | 60.2 | 53.2 | 16.6 / 18.8 / 19.5 | 6.5 / 10.4 | 1.6 | 42 + 0 | 0 (0) 0 | 10.7 (—) | 431 (145) | 88.7 (5.32) | 16.2 (0.97) | 0 | 103 | 9.83 |
| school · teleop | 59.9 | 51.3 | 16.7 / 19.5 / 21.4 | 6.3 / 9.4 | 1.5 | 43 + 0 | 0 (0) 0 | 12 (—) | 403 (142) | 120.8 (7.22) | 16.4 (0.98) | 0 | 102 | 10.47 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 4403 | 613 | 2890 | 1024 | 3058 | 3255 → 3311 | 3020 | 4223 | 1152 (410) | 292 | 13 | 9.7 | — | — | 0 | 0 |
| school · line-follow | 2768 | 569 | 1396 | 970 | 1559 | 1765 → 1825 | 1518 | 2454 | 1025 (388) | 300 | 13 | 9.7 | 99 | 61 | 0 | — |
| school · mini-mission | 2778 | 577 | 1400 | 980 | 1575 | 1768 → 1820 | 1538 | 2411 | 1046 (397) | 298 | 12 | 9.9 | 103 | 50 | 0 | — |
| school · check-1x | 2870 | 613 | 1481 | 1037 | 1650 | 1850 → 1903 | 1610 | 2356 | 1092 (427) | 306 | 12 | 9.9 | — | — | 0 | — |
| school · check-4x | 2767 | 590 | 1404 | 965 | 1571 | 1768 → 1824 | 1532 | 2405 | 1047 (400) | 299 | 12 | 9.9 | — | — | 0 | — |
| school · follow | 2784 | 584 | 1415 | 998 | 1578 | 1780 → 1830 | 1540 | 2470 | 1042 (402) | 284 | 13 | 9.7 | 127 | 55 | 0 | — |
| school · teleop | 2762 | 592 | 1307 | 935 | 1438 | 1664 → 1731 | 2245 | 2412 | 1577 (511) | 256 | 13 | 10.4 | — | — | 0 | — |

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| school · idle | 52 (40, 0) | 5 | 22 Lambert, 10 Basic, 3 Sprite | 51046 | 36370 | 13 | 9.7: 4.8 + 2.3 + 0 + 2.5 | MeshLambertMaterial 850×700 canvas aniso 8; birch_face 1024×128 ImageBitmap; walnut 256×256 ImageBitmap; pcb_teal 200×256 ImageBitmap |

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
