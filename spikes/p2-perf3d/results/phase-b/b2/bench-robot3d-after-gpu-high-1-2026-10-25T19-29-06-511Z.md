# bench:robot3d — 2026-10-25T19:29:06.511Z — after-gpu-high-1

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit dd4c309. Sensor overlays on (where the build has them). Repeats 1, window 8 s, soak 10 min, switches 20. 1-minute load average from 3.35 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 384.6 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 1 | idle before a run, a parked robot, after an orbit settles |
| target | gpu-high: GPU resources growth over the 2D↔3D switches | 0  | ≤ 0  | ok | 1 | live WebGL contexts, geometries, textures |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high · switch | — | — | — / — / — | — / — | — | — + — | — (—) — | — (—) | — (—) | — (—) | — (—) | — | 25 | 3.35 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high · switch | 1070 | 127 | 617 | 428 | 582 | 679 → 709 | 737 | 737 | 277 (145) | 18 | 16 | 51.3 | — | — | 0 | — |

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| gpu-high · switch | 93 (85, 55) | 5 | 64 Standard, 10 Basic, 3 Sprite, 4 Physical | 82757 | — | 16 | 51.3: 19.7 + 3.1 + 16 + 12.5 | PMREM.cubeUv 768×1024 other; MeshStandardMaterial 1280×800 canvas aniso 8; birch_face 2048×256 ImageBitmap aniso 8; walnut 512×512 ImageBitmap aniso 8 |

## Switches (growth from the first switch to the last; the scenario switches load the lesson frame again, so its contexts and renderer are new)

| profile | repeat | kind | switches | heap KB | live contexts | geometries | textures | programs | documents | listeners |
|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high | 1 | 2D ↔ 3D | 20 | 4105 | 0 | 0 | 0 | 0 | 0 | 0 |
| gpu-high | 1 | tier high ↔ low (sampled every second) | 10 | 1471 | 0 | 0 | 0 | 0 | 0 | 0 |
| gpu-high | 1 | scenario | 10 | 104 | 0 | 12 | -1 | 1 | 0 | 0 |

## Bundle (gzip -6)

| file | bytes | gzip | holds |
|---|---|---|---|
| test-hooks-BjTfuep0.js | 1446683 | 411713 | — |
| RobotLab-DRCXX3kh.js | 1346194 | 384605 | three, r3f, gltfLoader, meshopt |
| index-DspuuKw7.js | 479886 | 144386 | — |
| rapier-DZ_EfFMH.js | 295823 | 52055 | rapier |
| rolldown-runtime-hePW80VL.js | 716 | 428 | — |
| rapier_wasm3d_bg-DZsYp9WG.wasm | 3105893 | 1180561 | |
| arena-props-low.glb | 194772 | 83286 | |
| arena-props.glb | 303372 | 150186 | |
| robot-kit-low.glb | 495220 | 196824 | |
| robot-kit.glb | 826656 | 369080 | |

Entry HTML loads: /favicon.svg, /assets/index-DspuuKw7.js, /assets/rolldown-runtime-hePW80VL.js, /assets/test-hooks-BjTfuep0.js, /assets/index-CgMmDkmz.css.

## Served headers (vite preview)

| path | Cache-Control | Content-Encoding | ETag |
|---|---|---|---|
| / | no-cache | none | yes |
| /assets/RobotLab-*.js | no-cache | gzip | yes |
| /robot3d/robot-kit.glb?v=1 | no-cache | none | yes |
| /assets/rapier_wasm3d_bg-*.wasm | no-cache | none | yes |
