# bench:robot3d — 2026-10-27T07:42:58.402Z — e9b-gpu-high

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 8760350. Sensor overlays on (where the build has them). Repeats 3, window 8 s, soak 10 min, switches 20. 1-minute load average from 2.7–6.81 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 419.1 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | gpu-high: median fps of every run | 59.9 fps | ≥ 50 fps | ok | 12 | the plan’s ≥ 50 fps mid-range |
| budget | Run → moving (warm), every profile | 28 ms | ≤ 300 ms | ok | 12 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 27 | idle before a run, a parked robot, after an orbit settles |
| target | gpu-high: p95 frame time running | 18.5 ms | ≤ 20 ms | ok | 12 | every run scenario |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high · rb-grip-pick | 59.9–60.2 | 54.1–57.1 | 16.6–16.7 / 17.5–18.5 / 18.5–19.5 | 2.2–2.5 / 3.6–4 | 0.6–0.7 | 80 + 52 | 0 (0) 0 | 17.7 (—) | 151–167 (58–66) | 1.7–1.9 (0.1–0.11) | 4.2–4.5 (0.25–0.27) | 1.7 | 17–21 | 3.91–4.05 |
| gpu-high · rb-grip-deliver | 59.9–60.2 | 54.9–57.5 | 16.6–16.7 / 17.4–18.2 / 18.4–19.3 | 2.3–2.4 / 3.6–4 | 0.7–0.8 | 95 + 63 | 0 (0) 0 | 12 (—) | 150–159 (61–66) | 1.8–1.9 (0.11) | 4–4.2 (0.24–0.25) | 7.1 | 22–24 | 3.39–3.89 |
| gpu-high · rb-grip-sort | 59.9 | 56.8–57.8 | 16.7 / 17.3–17.6 / 18.1–19.1 | 2.1–2.3 / 3.5–3.9 | 0.6–0.7 | 84 + 52 | 0 (0) 0 | 17.8–18 (—) | 144–154 (57–61) | 1.6–1.7 (0.1) | 4–4.3 (0.24–0.26) | 1.2 | 23–24 | 2.99–3.18 |
| gpu-high · rb-grip-stack | 59.9 | 54.1–54.9 | 16.7 / 18.2–18.5 / 31–32.7 | 2.2–2.3 / 3.6–4 | 0.7 | 85 + 53 | 0 (0) 0 | 14.1 (—) | 149–159 (57–60) | 1.7–1.8 (0.1–0.11) | 3.9–4.2 (0.24–0.25) | 1.7 | 23–24 | 2.86–3.38 |
| gpu-high · rb-grip-check-4x | 59.9 | 53.8–54.6 | 16.7 / 18.3–18.6 / 33.1–50.1 | 2.8–2.9 / 4.3–4.7 | 0.6 | 84 + 52 | 0 (0) 0 | 34.4 (—) | 184–193 (23–24) | 0.9–0.9 (0.05) | 4.3–4.3 (0.26) | 0.9 | 18–24 | 2.7–3.54 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high · rb-grip-pick | 971–1149 | 126–182 | 518–697 | 435–487 | 486–675 | 580–775 → 620–805 | 643–840 | 643–840 | 129–332 (77–167) | 20–31 | 13 | 51.5 | 25–32 | 18–28 | 0 | 0 |
| gpu-high · rb-grip-deliver | 907–983 | 127–132 | 517–529 | 429–439 | 484–500 | 578–590 → 620–631 | 644–661 | 644–661 | 129–133 (77–80) | 20–22 | 13 | 57.9 | 21–36 | 14–28 | 0 | 0 |
| gpu-high · rb-grip-sort | 912–980 | 126–135 | 514–520 | 431–434 | 481–489 | 575–579 → 617–620 | 642–647 | 642–647 | 128–133 (77–80) | 20–22 | 13 | 56.8 | 33–34 | 15–22 | 0 | 0 |
| gpu-high · rb-grip-stack | 970–984 | 124–127 | 512–523 | 426–437 | 480–492 | 572–584 → 613–626 | 639–657 | 639–657 | 128–129 (76–78) | 20–21 | 13 | 52.1 | 27–35 | 14–27 | 0 | 0 |
| gpu-high · rb-grip-check-4x | 966–970 | 123–126 | 510–517 | 425–433 | 479–485 | 569–577 → 611–619 | 644 | 644 | 127–129 (76–78) | 20–21 | 13 | 56.9 | — | — | 0 | — |

## Where the main thread goes (profile pass, ms per animation frame, ranges over the repeats)

| profile · scenario | busy | sim | render (shadow map) | React | Blockly | scene callbacks | GC | browser (style, layout, paint, GL) | alloc/frame KB | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high · rb-grip-pick | 2.38–2.5 | 0.65–0.71 | 0.6–0.63 (0.15–0.17) | 0.09–0.1 | 0 | 0.14–0.16 | 0.02–0.03 | 0.36–0.37 | 251.9–257.1 | 17 | 3.42–3.86 |
| gpu-high · rb-grip-deliver | 2.36–2.43 | 0.68–0.73 | 0.65–0.69 (0.17–0.2) | 0.07–0.08 | 0 | 0.12–0.13 | 0.02 | 0.29–0.32 | 251.6–254.4 | 16–19 | 2.84–3.78 |
| gpu-high · rb-grip-sort | 2.33–2.49 | 0.66–0.72 | 0.61–0.64 (0.15–0.16) | 0.09–0.1 | 0 | 0.16–0.19 | 0.02–0.04 | 0.35 | 277.1–291.5 | 17–18 | 4.83–6.08 |
| gpu-high · rb-grip-stack | 2.4–2.57 | 0.66–0.71 | 0.6–0.68 (0.16–0.17) | 0.08–0.09 | 0 | 0.13–0.16 | 0.02 | 0.34–0.36 | 250.9–254.3 | 16–19 | 4.62–6.81 |
| gpu-high · rb-grip-check-4x | 2.99–3.04 | 1.66–1.69 | 0.15 (0.03–0.04) | 0.13–0.14 | 0 | 0.05 | 0.03–0.04 | 0.43 | 517.5–520.7 | 16–20 | 3.57–4.97 |

## The busiest sources (profile pass, self time in the window, ms; the first repeat)

- **gpu-high · rb-grip-pick** (6 s, 362 frames): three/build/three.module.js 192; rapier.wasm 186; (browser) 131; three/build/three.core.js 39; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 28; WebGL calls (through the bench probe) 24; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/run/robot-run-session.ts 21; react-dom/cjs/react-dom-client.production.js 19. Allocates most: three/build/three.module.js 12 MiB; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 9 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/ui/robot3d/camera-studio.ts 6 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/arena/ground-paint.ts 6 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/world.ts 4 MiB
- **gpu-high · rb-grip-deliver** (8 s, 480 frames): three/build/three.module.js 287; rapier.wasm 253; (browser) 141; three/build/three.core.js 55; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 36; WebGL calls (through the bench probe) 29; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/run/robot-run-session.ts 28; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/world.ts 23. Allocates most: three/build/three.module.js 19 MiB; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 13 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/world.ts 7 MiB; @dimforge/rapier3d-deterministic/dynamics/rigid_body.js 6 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/units.ts 6 MiB
- **gpu-high · rb-grip-sort** (6 s, 361 frames): three/build/three.module.js 200; rapier.wasm 180; (browser) 126; three/build/three.core.js 34; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 30; WebGL calls (through the bench probe) 21; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/run/robot-run-session.ts 19; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/world.ts 19. Allocates most: three/build/three.module.js 12 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/ui/robot3d/camera-studio.ts 12 MiB; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 10 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/arena/ground-paint.ts 7 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/world.ts 5 MiB
- **gpu-high · rb-grip-stack** (8 s, 481 frames): three/build/three.module.js 298; rapier.wasm 264; (browser) 171; three/build/three.core.js 49; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 43; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/run/virtual-clock.ts 31; WebGL calls (through the bench probe) 30; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/world.ts 28. Allocates most: three/build/three.module.js 16 MiB; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 13 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/ui/robot3d/camera-studio.ts 10 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/world.ts 6 MiB; @dimforge/rapier3d-deterministic/dynamics/rigid_body.js 5 MiB
- **gpu-high · rb-grip-check-4x** (22.9 s, 1374 frames): rapier.wasm 1875; (browser) 593; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 277; three/build/three.module.js 177; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/world.ts 110; react-dom/cjs/react-dom-client.production.js 106; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/run/robot-run-session.ts 67; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/sensors/contacts.ts 62. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 104 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/sensors/contacts.ts 76 MiB; @dimforge/rapier3d-deterministic/dynamics/rigid_body.js 57 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/world.ts 55 MiB; @dimforge/rapier3d-deterministic/geometry/broad_phase.js 47 MiB

## Before the first frame (profile pass: navigation → the scene drawn, main thread self time by what ran, ms)

| profile · scenario | first frame | busy | three | blockly | react-dom | r3f | ui: robot3d | sim | webgl calls | browser | gc |
|---|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high · rb-grip-pick | 889–895 | 283–406 | 94–109 | 27–128 | 13–15 | 9–12 | 0 | 1–2 | 6–7 | 40–46 | 8–10 |
| gpu-high · rb-grip-deliver | 889–894 | 297–301 | 98–104 | 27–29 | 12–21 | 9–12 | 0 | 1–2 | 6–7 | 39–46 | 9–10 |
| gpu-high · rb-grip-sort | 886–893 | 271–297 | 91–97 | 26–31 | 13–17 | 8–11 | 0 | 1–3 | 6–7 | 39–43 | 7–9 |
| gpu-high · rb-grip-stack | 887–1391 | 276–328 | 91–124 | 26–30 | 13–14 | 8–12 | 0 | 2–2 | 6–6 | 36–45 | 9–10 |
| gpu-high · rb-grip-check-4x | 886–890 | 279–294 | 88–97 | 28–29 | 13–16 | 9–10 | 0 | 1–3 | 6–7 | 39–40 | 8–11 |

- **gpu-high · rb-grip-pick**: blockly/blockly_compressed.js 127; three/build/three.module.js 66; (browser) 46; three/build/three.core.js 26; react-use-measure/dist/index.js 15; react-dom/cjs/react-dom-client.production.js 13; three/examples/jsm/loaders/GLTFLoader.js 13; zod/v4/core/schemas.js 9; (unknown) 9; @react-three/fiber/dist/events-9ce18a08.esm.js 9
- **gpu-high · rb-grip-deliver**: three/build/three.module.js 63; (browser) 39; three/build/three.core.js 27; blockly/blockly_compressed.js 26; react-dom/cjs/react-dom-client.production.js 16; react-use-measure/dist/index.js 14; (gc) 10; @react-three/fiber/dist/events-9ce18a08.esm.js 10; three/examples/jsm/loaders/GLTFLoader.js 9; (unknown) 8
- **gpu-high · rb-grip-sort**: three/build/three.module.js 56; (browser) 43; blockly/blockly_compressed.js 29; three/build/three.core.js 26; react-dom/cjs/react-dom-client.production.js 17; react-use-measure/dist/index.js 16; (unknown) 12; three/examples/jsm/loaders/GLTFLoader.js 10; @react-three/fiber/dist/events-9ce18a08.esm.js 10; (gc) 9
- **gpu-high · rb-grip-stack**: three/build/three.module.js 62; (browser) 45; three/build/three.core.js 34; blockly/blockly_compressed.js 29; three/examples/jsm/loaders/GLTFLoader.js 23; react-dom/cjs/react-dom-client.production.js 14; react-use-measure/dist/index.js 13; @react-three/fiber/dist/events-9ce18a08.esm.js 12; (unknown) 11; (gc) 10
- **gpu-high · rb-grip-check-4x**: three/build/three.module.js 58; (browser) 39; blockly/blockly_compressed.js 27; three/build/three.core.js 26; react-dom/cjs/react-dom-client.production.js 15; react-use-measure/dist/index.js 15; (unknown) 11; (gc) 11; @react-three/fiber/dist/events-9ce18a08.esm.js 10; three/examples/jsm/loaders/GLTFLoader.js 9

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| gpu-high · rb-grip-pick | 83 (75, 54) | 9 | 54 Standard, 10 Basic, 7 Sprite, 3 Physical | 76724 | 127758 | 13 | 51.5: 20.2 + 2.9 + 16 + 12.5 | PMREM.cubeUv 768×1024 other; MeshStandardMaterial 1360×720 canvas aniso 8; birch_face 2048×256 ImageBitmap aniso 8; walnut 512×512 ImageBitmap aniso 8 |

## Bundle (gzip -6)

| file | bytes | gzip | holds |
|---|---|---|---|
| test-hooks-f6unhMn2.js | 1489736 | 422712 | — |
| RobotLab-C-g1jzYv.js | 1451949 | 419065 | three, r3f, gltfLoader, meshopt |
| index-BTFSF14i.js | 484533 | 146082 | — |
| rapier-DZ_EfFMH.js | 295823 | 52055 | rapier |
| rolldown-runtime-hePW80VL.js | 716 | 428 | — |
| rapier_wasm3d_bg-DZsYp9WG.wasm | 3105893 | 1180561 | |
| arena-props-low.glb | 242472 | 101999 | |
| arena-props.glb | 376440 | 190892 | |
| robot-kit-low.glb | 560644 | 218123 | |
| robot-kit.glb | 928028 | 411784 | |

Entry HTML loads: /favicon.svg, /assets/index-BTFSF14i.js, /assets/rolldown-runtime-hePW80VL.js, /assets/test-hooks-f6unhMn2.js, /assets/index-CgMmDkmz.css.

## Served headers (vite preview)

| path | Cache-Control | Content-Encoding | ETag |
|---|---|---|---|
| / | no-cache | none | yes |
| /assets/RobotLab-*.js | no-cache | gzip | yes |
| /robot3d/robot-kit.glb?v=1 | no-cache | none | yes |
| /assets/rapier_wasm3d_bg-*.wasm | no-cache | none | yes |
