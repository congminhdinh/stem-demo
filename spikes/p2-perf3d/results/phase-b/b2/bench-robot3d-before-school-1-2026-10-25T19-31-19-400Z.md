# bench:robot3d — 2026-10-25T19:31:19.400Z — before-school-1

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit dd4c309. Sensor overlays on (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 4.27 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 384.4 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 1 | idle before a run, a parked robot, after an orbit settles |
| target | school: first frame | 4022 ms | ≤ 2500 ms | not met | 1 | lesson page navigation → the scene drawn |
| target | school: GPU resources growth over the 2D↔3D switches | 0  | ≤ 0  | ok | 1 | live WebGL contexts, geometries, textures |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · switch | — | — | — / — / — | — / — | — | — + — | — (—) — | — (—) | — (—) | — (—) | — (—) | — | 86 | 4.27 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · switch | 4022 | 573 | 2598 | 949 | 2731 | 2947 → 2993 | 2699 | 3805 | 973 (364) | 233 | 13 | 8.5 | — | — | 0 | — |

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| school · switch | 52 (44, 0) | 5 | 22 Lambert, 10 Basic, 3 Sprite | 44260 | — | 13 | 8.5: 3.9 + 2 + 0 + 2.5 | MeshLambertMaterial 800×500 canvas aniso 8; birch_face 1024×128 ImageBitmap; walnut 256×256 ImageBitmap; pcb_teal 200×256 ImageBitmap |

## Switches (growth from the first switch to the last; the scenario switches load the lesson frame again, so its contexts and renderer are new)

| profile | repeat | kind | switches | heap KB | live contexts | geometries | textures | programs | documents | listeners |
|---|---|---|---|---|---|---|---|---|---|---|
| school | 1 | 2D ↔ 3D | 20 | 3780 | 0 | 0 | 0 | 0 | 0 | 19 |
| school | 1 | tier high ↔ low (sampled every second) | 10 | 1596 | 0 | 0 | 0 | 0 | 0 | 18 |
| school | 1 | scenario | 10 | 69 | 0 | 8 | -1 | 1 | 0 | 0 |

## Bundle (gzip -6)

| file | bytes | gzip | holds |
|---|---|---|---|
| test-hooks-BjTfuep0.js | 1446683 | 411713 | — |
| RobotLab-XcW7qJVw.js | 1345871 | 384363 | three, r3f, gltfLoader, meshopt |
| index-unCg-rvw.js | 479886 | 144390 | — |
| rapier-DZ_EfFMH.js | 295823 | 52055 | rapier |
| rolldown-runtime-hePW80VL.js | 716 | 428 | — |
| rapier_wasm3d_bg-DZsYp9WG.wasm | 3105893 | 1180561 | |
| arena-props-low.glb | 194772 | 83286 | |
| arena-props.glb | 303372 | 150186 | |
| robot-kit-low.glb | 495220 | 196824 | |
| robot-kit.glb | 826656 | 369080 | |

Entry HTML loads: /favicon.svg, /assets/index-unCg-rvw.js, /assets/rolldown-runtime-hePW80VL.js, /assets/test-hooks-BjTfuep0.js, /assets/index-CgMmDkmz.css.

## Served headers (vite preview)

| path | Cache-Control | Content-Encoding | ETag |
|---|---|---|---|
| / | no-cache | none | yes |
| /assets/RobotLab-*.js | no-cache | gzip | yes |
| /robot3d/robot-kit.glb?v=1 | no-cache | none | yes |
| /assets/rapier_wasm3d_bg-*.wasm | no-cache | none | yes |
