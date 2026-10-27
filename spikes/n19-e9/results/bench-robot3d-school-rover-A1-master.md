# bench:robot3d — 2026-10-27T02:09:27.907Z — e910-rover-A1-master

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 46a3f82. Sensor overlays on (where the build has them). Repeats 2, window 8 s, soak 10 min, switches 20. 1-minute load average from 5.61–10.95 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 414.4 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | Run → moving (warm), every profile | 50 ms | ≤ 300 ms | ok | 6 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 16 | idle before a run, a parked robot, after an orbit settles |
| target | school: p95 frame time running at 1× | 20.1 ms | ≤ 33 ms | ok | 8 | every run scenario, low tier |
| target | school: p95 frame time running at 4× | 20.7 ms | ≤ 33 ms | ok | 2 | sim speed 4× and Kiểm tra 4× |
| target | school: long tasks > 100 ms during a run | 0  | ≤ 0  | ok | 10 | in the measuring window |
| target | school: first frame | 4073 ms | ≤ 2500 ms | not met | 12 | lesson page navigation → the scene drawn |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 59.9–61 | 52.9 | 16.4–16.7 / 18.9 / 19.6–20.8 | 2.6–2.7 / 3.9–4.1 | 1.4–1.5 | 41 + 0 | 0 (0) 0 | — (—) | 215–218 (117–126) | 87.9–89.6 (5.16–5.17) | 15.8–16.1 (0.93) | 2.6–3.1 | 98–99 | 5.73–6.59 |
| school · drive-to-zone | 59.5–59.9 | 52.1–53.2 | 16.7–16.8 / 18.8–19.2 / 19.6–20.2 | 4.6–4.9 / 7.8–8.2 | 1.3–1.4 | 42 + 0 | 0 (0) 0 | 10.2 (—) | 313–329 (121–128) | 79.5–81.3 (4.78–4.87) | 15.8–15.9 (0.95) | 0.2 | 97–99 | 5.61–6.51 |
| school · line-follow | 59.9–60.6 | 49.8–52.1 | 16.5–16.7 / 19.2–20.1 / 20–21.3 | 5.6–5.7 / 9–9.8 | 1.4–1.5 | 48 + 0 | 0 (0) 0 | 10.7–12.5 (—) | 367–386 (129–141) | 95.6–99.7 (5.73–5.97) | 16–16.1 (0.96) | 0 | 98–103 | 6.47–6.64 |
| school · mini-mission | 60.2 | 51.3 | 16.6 / 19.5 / 20.8–21.5 | 5.3–5.5 / 8.9–9.3 | 1.3–1.4 | 47 + 0 | 0 (0) 0 | 11.6 (—) | 359–376 (136–139) | 95.4–95.9 (5.72–5.75) | 16–16 (0.96) | 1.4 | 98–99 | 7.48–7.55 |
| school · check-4x | 59.9–60.2 | 48.3–49 | 16.6–16.7 / 20.4–20.7 / 51.3–165.5 | 7.3–7.4 / 12.3–12.6 | 1.5 | 49 + 0 | 0 (0) 0 | 34.1–34.2 (—) | 491–493 (89–94) | 59.7–62.1 (3.56–3.63) | 16.4–16.7 (0.98) | 1.3–1.4 | 97–98 | 8.89–10.95 |
| school · teleop | 59.9 | 51.5–51.8 | 16.7 / 19.3–19.4 / 20.1–20.4 | 5.9–6.1 / 8.6–8.7 | 1.4–1.5 | 43 + 0 | 0 (0) 0 | 12 (—) | 383–392 (135–139) | 125–127.6 (7.49–7.64) | 16.2–16.2 (0.97) | 0 | 98–100 | 10–10.48 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · idle | 4071–4073 | 528–540 | 2617–2628 | 883–910 | 2759–2767 | 2974–2982 → 3023–3030 | 2722–2731 | 3868–3876 | 1023 (364–373) | 252–257 | 13 | 9.7 | — | — | 0 | 0 |
| school · drive-to-zone | 2669–2673 | 542–543 | 1270–1312 | 908–936 | 1392–1433 | 1624–1664 → 1672–1713 | 1363–1403 | 2291–2296 | 906–939 (369–372) | 243–245 | 13 | 7.8 | 79–83 | 43 | 0 | 0 |
| school · line-follow | 2569–2617 | 520–527 | 1233–1279 | 875–894 | 1369–1422 | 1590–1635 → 1637–1683 | 1338–1379 | 2251–2301 | 892–921 (357–359) | 257–269 | 13 | 9.7 | 84–88 | 44–50 | 0 | — |
| school · mini-mission | 2561–2573 | 523–528 | 1248–1256 | 879–887 | 1388–1393 | 1603–1610 → 1649–1654 | 1357–1366 | 2046–2197 | 916–929 (362–365) | 265–266 | 12 | 9.9 | 86–87 | 43–45 | 0 | — |
| school · check-4x | 2552–2559 | 518–526 | 1241–1243 | 873–882 | 1381 | 1593–1595 → 1640 | 1351 | 2047–2183 | 915 (356–364) | 263–266 | 12 | 9.9 | — | — | 0 | — |
| school · teleop | 2591–2610 | 525–526 | 1205–1218 | 877–880 | 1312–1325 | 1555–1570 → 1612–1632 | 2075–2094 | 2232–2252 | 1433–1444 (462–464) | 228–230 | 13 | 10.4 | — | — | 0 | — |

## Where the main thread goes (profile pass, ms per animation frame, ranges over the repeats)

| profile · scenario | busy | sim | render (shadow map) | React | Blockly | scene callbacks | GC | browser (style, layout, paint, GL) | alloc/frame KB | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|
| school · line-follow | 7.8–7.86 | 1.77–1.83 | 1.47–1.5 (0) | 0.47–0.48 | 0 | 0.47–0.51 | 0.08–0.1 | 1.46–1.49 | 137.3–137.9 | 98 | 10.34–10.56 |
| school · mini-mission | 7.62–7.71 | 1.76–1.79 | 1.48–1.5 (0) | 0.36–0.38 | 0 | 0.65–0.66 | 0.09 | 1.35–1.54 | 171.2–171.9 | 98–99 | 8.18–8.91 |
| school · check-4x | 10.12–10.39 | 3.44–3.48 | 0.47–0.5 (0) | 0.86–0.88 | 0.01 | 0.26–0.29 | 0.15–0.18 | 2.13–2.16 | 350.4–357.3 | 99 | 7.59–9.23 |
| school · teleop | 7.74–7.81 | 1.91–1.94 | 1.49–1.63 (0) | 0.25–0.29 | 0 | 0.53–0.54 | 0.05–0.1 | 2.03–2.05 | 120.5–123.1 | 98–99 | 9.77–10.11 |

## The busiest sources (profile pass, self time in the window, ms; the first repeat)

- **school · line-follow** (8 s, 482 frames): (browser) 705; rapier.wasm 664; three/build/three.module.js 585; three/build/three.core.js 207; e910-master/src/core/run/robot-run-session.ts 122; react-dom/cjs/react-dom-client.production.js 120; e910-master/src/core/run/virtual-clock.ts 106; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 97. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; three/build/three.module.js 5 MiB; e910-master/src/core/world/units.ts 4 MiB; e910-master/src/core/world/world.ts 4 MiB; e910-master/src/core/world/arena/ground-paint.ts 4 MiB
- **school · mini-mission** (8 s, 477 frames): (browser) 737; rapier.wasm 624; three/build/three.module.js 583; three/build/three.core.js 191; e910-master/src/core/run/robot-run-session.ts 130; e910-master/src/core/run/virtual-clock.ts 109; react-dom/cjs/react-dom-client.production.js 95; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 95. Allocates most: e910-master/src/ui/robot3d/camera-studio.ts 13 MiB; e910-master/src/core/world/arena/ground-paint.ts 7 MiB; three/build/three.module.js 6 MiB; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 5 MiB; e910-master/src/core/world/world.ts 4 MiB
- **school · check-4x** (34.5 s, 2025 frames): rapier.wasm 4848; (browser) 4376; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 1464; react-dom/cjs/react-dom-client.production.js 943; three/build/three.module.js 798; e910-master/src/core/world/arena/ground-paint.ts 662; e910-master/src/core/world/world.ts 592; e910-master/src/core/run/virtual-clock.ts 574. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 77 MiB; e910-master/src/core/world/world.ts 67 MiB; @dimforge/rapier3d-deterministic/pipeline/world.js 63 MiB; e910-master/src/core/world/sensors/contacts.ts 51 MiB; e910-master/src/core/world/robot/assembly.ts 47 MiB
- **school · teleop** (8.1 s, 488 frames): (browser) 1001; rapier.wasm 688; three/build/three.module.js 567; three/build/three.core.js 243; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 121; e910-master/src/core/world/world.ts 112; e910-master/src/core/run/robot-run-session.ts 102; WebGL calls (through the bench probe) 101. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; three/build/three.module.js 5 MiB; e910-master/src/core/world/world.ts 5 MiB; e910-master/src/core/world/units.ts 4 MiB; e910-master/src/core/world/arena/ground-paint.ts 4 MiB

## Before the first frame (profile pass: navigation → the scene drawn, main thread self time by what ran, ms)

| profile · scenario | first frame | busy | three | blockly | react-dom | r3f | ui: robot3d | sim | webgl calls | browser | gc |
|---|---|---|---|---|---|---|---|---|---|---|---|
| school · line-follow | 2470–3957 | 2034–3477 | 881–952 | 194–279 | 94–107 | 77–82 | 0 | 5–5 | 22–23 | 252–1540 | 19–23 |
| school · mini-mission | 2081–2084 | 1935–1948 | 781–790 | 192–193 | 90–95 | 72–73 | 0 | 4–7 | 24–32 | 246–246 | 19–32 |
| school · check-4x | 2068–2105 | 1928–1978 | 780–795 | 193–205 | 78–105 | 64–71 | 0 | 4–5 | 22–24 | 254–263 | 21–29 |
| school · teleop | 2499–2533 | 1976–1994 | 863–875 | 177–179 | 88–107 | 71–75 | 0 | 6–9 | 26–29 | 237–244 | 25–30 |

- **school · line-follow**: (browser) 1540; three/build/three.module.js 725; blockly/blockly_compressed.js 268; three/build/three.core.js 147; react-dom/cjs/react-dom-client.production.js 94; @react-three/fiber/dist/events-9ce18a08.esm.js 76; (unknown) 65; react-use-measure/dist/index.js 59; three/examples/jsm/loaders/GLTFLoader.js 59; zod/v4/core/schemas.js 55
- **school · mini-mission**: three/build/three.module.js 566; (browser) 246; blockly/blockly_compressed.js 182; three/build/three.core.js 142; react-dom/cjs/react-dom-client.production.js 90; @react-three/fiber/dist/events-9ce18a08.esm.js 69; (unknown) 63; three/examples/jsm/loaders/GLTFLoader.js 61; react-use-measure/dist/index.js 56; zod/v4/core/schemas.js 53
- **school · check-4x**: three/build/three.module.js 557; (browser) 263; blockly/blockly_compressed.js 186; three/build/three.core.js 144; react-dom/cjs/react-dom-client.production.js 78; (unknown) 63; @react-three/fiber/dist/events-9ce18a08.esm.js 62; react-use-measure/dist/index.js 59; zod/v4/core/schemas.js 57; three/examples/jsm/loaders/GLTFLoader.js 53
- **school · teleop**: three/build/three.module.js 645; (browser) 237; blockly/blockly_compressed.js 168; three/build/three.core.js 140; react-dom/cjs/react-dom-client.production.js 88; (unknown) 73; @react-three/fiber/dist/events-9ce18a08.esm.js 72; zod/v4/core/schemas.js 60; three/examples/jsm/loaders/GLTFLoader.js 59; react-use-measure/dist/index.js 50

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| school · idle | 52 (40, 0) | 5 | 22 Lambert, 10 Basic, 3 Sprite | 51046 | 36370 | 13 | 9.7: 4.8 + 2.3 + 0 + 2.5 | MeshLambertMaterial 850×700 canvas aniso 8; birch_face 1024×128 ImageBitmap; walnut 256×256 ImageBitmap; pcb_teal 200×256 ImageBitmap |

## Bundle (gzip -6)

| file | bytes | gzip | holds |
|---|---|---|---|
| test-hooks-f6unhMn2.js | 1489736 | 422712 | — |
| RobotLab-iFTj1is7.js | 1439598 | 414355 | three, r3f, gltfLoader, meshopt |
| index-BPSI07g5.js | 484533 | 146082 | — |
| rapier-DZ_EfFMH.js | 295823 | 52055 | rapier |
| rolldown-runtime-hePW80VL.js | 716 | 428 | — |
| rapier_wasm3d_bg-DZsYp9WG.wasm | 3105893 | 1180561 | |
| arena-props-low.glb | 242472 | 101999 | |
| arena-props.glb | 376440 | 190892 | |
| robot-kit-low.glb | 560668 | 218033 | |
| robot-kit.glb | 928072 | 411573 | |

Entry HTML loads: /favicon.svg, /assets/index-BPSI07g5.js, /assets/rolldown-runtime-hePW80VL.js, /assets/test-hooks-f6unhMn2.js, /assets/index-CgMmDkmz.css.

## Served headers (vite preview)

| path | Cache-Control | Content-Encoding | ETag |
|---|---|---|---|
| / | no-cache | none | yes |
| /assets/RobotLab-*.js | no-cache | gzip | yes |
| /robot3d/robot-kit.glb?v=1 | no-cache | none | yes |
| /assets/rapier_wasm3d_bg-*.wasm | no-cache | none | yes |
