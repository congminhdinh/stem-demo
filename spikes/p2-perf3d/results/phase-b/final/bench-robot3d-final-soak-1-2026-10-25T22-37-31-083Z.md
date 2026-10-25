# bench:robot3d — 2026-10-25T22:37:31.083Z — final-soak-1

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 7661d33. Sensor overlays on (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 6.33 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 386.1 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 1 | idle before a run, a parked robot, after an orbit settles |
| budget | school: JS heap growth over the soak (minute 1 → end) | -2.4 % | ≤ 5 % | ok | 1 | 10 min, 2 runs |
| target | school: first frame | 3975 ms | ≤ 2500 ms | not met | 1 | lesson page navigation → the scene drawn |
| target | school: heap growth over the soak | -2.4 % | ≤ 5 % | ok | 1 | 10 min |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · soak | — | — | — / — / — | — / — | — | — + — | — (—) — | — (—) | — (—) | — (—) | — (—) | — | 98 | 6.33 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · soak | 3975 | 623 | 2481 | 1027 | 2598 | 2831 → 2893 | 3457 | 3729 | 1689 (552) | 235 | 13 | 10.4 | — | — | 0 | — |

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| school · soak | 53 (45, 0) | 5 | 24 Lambert, 9 Basic, 3 Sprite | 46433 | — | 13 | 10.4: 5.8 + 2.1 + 0 + 2.5 | MeshLambertMaterial 1000×750 canvas aniso 8; birch_face 1024×128 ImageBitmap; walnut 256×256 ImageBitmap; pcb_teal 200×256 ImageBitmap |

## Soak

| profile | repeat | minutes | runs | heap after GC, minute 1 → end (MiB) | growth | frames/min | p95 frame ms (min–max over minutes) | live contexts | geometries / textures (end) |
|---|---|---|---|---|---|---|---|---|---|
| school | 1 | 10 | 2 | 20.25 → 19.77 | -2.38 % | 3518–3564 | 19.1–19.8 | 1 | 45 / 17 |

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
