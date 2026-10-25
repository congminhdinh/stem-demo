# bench:robot3d — 2026-10-25T18:19:19.827Z — master-soak-school

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 518f6a2. Sensor overlays on (where the build has them). Repeats 3, window 8 s, soak 10 min, switches 20. 1-minute load average from 4.69–14.26 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 378.5 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 3 | idle before a run, a parked robot, after an orbit settles |
| budget | school: JS heap growth over the soak (minute 1 → end) | -2.2 % | ≤ 5 % | ok | 1 | 10 min, 2 runs |
| budget | school: JS heap growth over the soak (minute 1 → end) | 0.2 % | ≤ 5 % | ok | 1 | 10 min, 2 runs |
| budget | school: JS heap growth over the soak (minute 1 → end) | -1.8 % | ≤ 5 % | ok | 1 | 10 min, 2 runs |
| target | school: first frame | 3697 ms | ≤ 2500 ms | not met | 3 | lesson page navigation → the scene drawn |
| target | school: heap growth over the soak | -2.2 % | ≤ 5 % | ok | 1 | 10 min |
| target | school: heap growth over the soak | 0.2 % | ≤ 5 % | ok | 1 | 10 min |
| target | school: heap growth over the soak | -1.8 % | ≤ 5 % | ok | 1 | 10 min |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · soak | — | — | — / — / — | — / — | — | — + — | — (—) — | — (—) | — (—) | — (—) | — (—) | — | 95–99 | 4.69–14.26 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · soak | 2458–3697 | 478–535 | 1087–2219 | 823–887 | 1222–2358 | 1430–2565 → 1483–2624 | 1946–3182 | 2108–3453 | 899–1535 (329–565) | 231–259 | 13 | 10.4 | — | — | 0 | — |

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| school · soak | 53 (44, 0) | 5 | 24 Lambert, 9 Basic, 3 Sprite | 46433 | — | 13 | 10.4: 5.8 + 2.1 + 0 + 2.5 | MeshLambertMaterial 1000×750 canvas aniso 8; birch_face 1024×128 ImageBitmap; walnut 256×256 ImageBitmap; pcb_teal 200×256 ImageBitmap |

## Soak

| profile | repeat | minutes | runs | heap after GC, minute 1 → end (MiB) | growth | frames/min | p95 frame ms (min–max over minutes) | live contexts | geometries / textures (end) |
|---|---|---|---|---|---|---|---|---|---|
| school | 1 | 10 | 2 | 20.03 → 19.58 | -2.21 % | 2395–3563 | 18.6–52 | 1 | 45 / 17 |
| school | 2 | 10 | 2 | 20.03 → 20.07 | 0.21 % | 2029–3557 | 18.6–67.7 | 1 | 45 / 17 |
| school | 3 | 10 | 2 | 20.02 → 19.65 | -1.84 % | 2034–3560 | 18.5–63.4 | 1 | 45 / 17 |

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
