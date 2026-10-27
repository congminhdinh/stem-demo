# bench:robot3d — 2026-10-27T07:29:46.981Z — e9b-ss-low-4x

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 8760350. Sensor overlays on (where the build has them). Repeats 3, window 8 s, soak 10 min, switches 20. 1-minute load average from 2.71–8.34 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 419.1 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | ss-low-4x: p5 fps of every run | 51.5 fps | ≥ 30 fps | ok | 12 | the plan’s ≥ 30 fps low tier at 4× |
| budget | ss-low-4x: p5 fps of Kiểm tra 4× (rb-grip-check-4x) | 37.5 fps | ≥ 30 fps | ok | 3 | the plan’s ≥ 30 fps low tier at 4×, the whole check of a gripper lesson |
| budget | Run → moving (warm), every profile | 51 ms | ≤ 300 ms | ok | 12 | click to the first render with the robot moved |
| budget | ss-low-4x: first Run → moving (physics loads) | 87 ms | ≤ 1500 ms | ok | 12 | the plan’s init physics ≤ 1.5 s at 4× |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 27 | idle before a run, a parked robot, after an orbit settles |
| target | school and ss-low-4x: long tasks > 100 ms in Kiểm tra 4× (rb-grip-check-4x) | 0  | ≤ 0  | ok | 3 | the whole check; tasks of 50 to 100 ms are in the frames table |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ss-low-4x · rb-grip-pick | 60.2 | 52.1–53.5 | 16.6 / 18.7–19.2 / 20.2–21.7 | 5–5.1 / 8–8.8 | 0.9 | 48 + 0 | 0 (0) 0 | 17.7 (—) | 336–355 (101–103) | 88.6–89.2 (5.31–5.35) | 15.3–15.3 (0.91–0.92) | 1.7 | 60–66 | 2.71–4.48 |
| ss-low-4x · rb-grip-deliver | 59.9 | 52.9–53.8 | 16.7 / 18.6–18.9 / 26.2–32.5 | 4.7–4.9 / 7.6–7.8 | 1 | 63 + 0 | 0 (0) 0 | 11.7–12 (—) | 313–327 (98–100) | 104–106 (6.18–6.34) | 15.1–15.3 (0.9–0.91) | 7.1 | 63–66 | 5.87–8.34 |
| ss-low-4x · rb-grip-sort | 59.9–60.2 | 51.5–53.2 | 16.6–16.7 / 18.8–19.4 / 23.4–32.1 | 4.6–4.9 / 9–9.1 | 0.9–1 | 52 + 0 | 0 (0) 0 | 17.8 (—) | 331–345 (102–104) | 92.1–94.8 (5.52–5.68) | 15.2–15.2 (0.91) | 1.2 | 64–65 | 5.7–6.14 |
| ss-low-4x · rb-grip-stack | 59.9 | 51.8–54.3 | 16.7 / 18.4–19.3 / 31.5–33.2 | 4.9–5 / 8.4–8.9 | 0.9 | 53 + 0 | 0 (0) 0 | 13.9–14.1 (—) | 333–342 (92–96) | 94.2–96.4 (5.65–5.78) | 15.2–15.2 (0.91) | 1.7 | 63–64 | 5.39–6.94 |
| ss-low-4x · rb-grip-check-4x | 59.5–59.9 | 37.5–44.1 | 16.7–16.8 / 22.7–26.7 / 69.9–269 | 7.1–7.4 / 13.1–13.4 | 1–1.1 | 52 + 0 | 0 (0) 0 | 34.2–34.3 (—) | 481–492 (52–56) | 47.4–49.6 (2.81–2.91) | 15.8–16.2 (0.93–0.94) | 0.8–1 | 63–65 | 5.58–6.89 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ss-low-4x · rb-grip-pick | 2119–3699 | 351–429 | 871–2330 | 679–788 | 944–2428 | 1203–2666 → 1232–2699 | 928–2399 | 1834–3546 | 489–725 (219–283) | 150–179 | 11 | 8.8 | 78–81 | 44–49 | 0 | 0 |
| ss-low-4x · rb-grip-deliver | 2134–2322 | 343–365 | 871–891 | 676–697 | 948–967 | 1205–1226 → 1236–1258 | 932–952 | 1811–1855 | 504–513 (220–229) | 154–155 | 11 | 11 | 79–86 | 48–50 | 0 | 0 |
| ss-low-4x · rb-grip-sort | 2150–2154 | 352–357 | 877–880 | 683–686 | 960–963 | 1214–1215 → 1245–1247 | 945–947 | 1851–1864 | 508–511 (220–222) | 159–162 | 11 | 10.6 | 81–87 | 48–49 | 0 | 0 |
| ss-low-4x · rb-grip-stack | 2138–2156 | 354–370 | 877–905 | 684–701 | 944–974 | 1210–1237 → 1245–1274 | 1627–1646 | 1809–1829 | 876–892 (369) | 145–148 | 10 | 8.9 | 79–82 | 49–51 | 0 | 0 |
| ss-low-4x · rb-grip-check-4x | 2152–2188 | 354–377 | 889–922 | 686–710 | 973–1009 | 1225–1259 → 1259–1291 | 958–993 | 1675–1890 | 521–543 (220–236) | 161–170 | 11 | 10.6 | — | — | 0 | — |

## Where the main thread goes (profile pass, ms per animation frame, ranges over the repeats)

| profile · scenario | busy | sim | render (shadow map) | React | Blockly | scene callbacks | GC | browser (style, layout, paint, GL) | alloc/frame KB | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ss-low-4x · rb-grip-pick | 6.89–7.2 | 2.24–2.32 | 0.99–1.07 (0) | 0.29–0.32 | 0 | 0.47–0.55 | 0.07–0.09 | 1.15–1.25 | 228.4–231.8 | 65–66 | 6.21–7.82 |
| ss-low-4x · rb-grip-deliver | 6.33–6.5 | 2.16–2.21 | 1.06–1.14 (0) | 0.23–0.26 | 0 | 0.41–0.47 | 0.05–0.06 | 0.9–0.95 | 225.9–226.8 | 64–65 | 6.48–8.12 |
| ss-low-4x · rb-grip-sort | 6.75–6.94 | 2.23–2.24 | 0.99–1.04 (0) | 0.31–0.33 | 0 | 0.56–0.58 | 0.08–0.09 | 1.14–1.21 | 250–255.2 | 64 | 6.94–8.05 |
| ss-low-4x · rb-grip-stack | 6.9–7.01 | 2.12–2.28 | 0.97–1.09 (0) | 0.29–0.32 | 0.01 | 0.44–0.47 | 0.05–0.1 | 1.11–1.16 | 222.1–232.4 | 63–65 | 4.73–6.53 |
| ss-low-4x · rb-grip-check-4x | 9.67–9.93 | 5.4–5.45 | 0.28–0.31 (0) | 0.47–0.49 | 0–0.01 | 0.18–0.21 | 0.09–0.12 | 1.38–1.45 | 518.3–523.8 | 62–66 | 4.12–5.98 |

## The busiest sources (profile pass, self time in the window, ms; the first repeat)

- **ss-low-4x · rb-grip-pick** (6 s, 361 frames): rapier.wasm 628; (browser) 427; three/build/three.module.js 300; three/build/three.core.js 108; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 87; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/run/virtual-clock.ts 67; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/world.ts 67; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/run/robot-run-session.ts 61. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 9 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/arena/ground-paint.ts 6 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/ui/robot3d/camera-studio.ts 6 MiB; three/build/three.module.js 4 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/world.ts 4 MiB
- **ss-low-4x · rb-grip-deliver** (8 s, 477 frames): rapier.wasm 805; three/build/three.module.js 465; (browser) 451; three/build/three.core.js 140; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 112; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/world.ts 98; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/run/robot-run-session.ts 75; WebGL calls (through the bench probe) 68. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 13 MiB; three/build/three.module.js 8 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/world.ts 7 MiB; @dimforge/rapier3d-deterministic/dynamics/rigid_body.js 6 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/units.ts 6 MiB
- **ss-low-4x · rb-grip-sort** (6 s, 360 frames): rapier.wasm 610; (browser) 437; three/build/three.module.js 296; three/build/three.core.js 109; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 90; WebGL calls (through the bench probe) 70; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/run/robot-run-session.ts 67; react-dom/cjs/react-dom-client.production.js 60. Allocates most: Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/ui/robot3d/camera-studio.ts 10 MiB; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 9 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/arena/ground-paint.ts 7 MiB; @dimforge/rapier3d-deterministic/math.js 5 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/world.ts 5 MiB
- **ss-low-4x · rb-grip-stack** (8 s, 481 frames): rapier.wasm 838; (browser) 536; three/build/three.module.js 442; three/build/three.core.js 151; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 134; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/world.ts 99; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/run/robot-run-session.ts 93; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/run/virtual-clock.ts 85. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 13 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/world.ts 6 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/ui/robot3d/camera-studio.ts 6 MiB; three/build/three.module.js 6 MiB; @dimforge/rapier3d-deterministic/dynamics/rigid_body.js 5 MiB
- **ss-low-4x · rb-grip-check-4x** (23.2 s, 1350 frames): rapier.wasm 5825; (browser) 1889; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 938; react-dom/cjs/react-dom-client.production.js 375; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/world.ts 362; three/build/three.module.js 331; WebGL calls (through the bench probe) 325; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/run/robot-run-session.ts 257. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 105 MiB; @dimforge/rapier3d-deterministic/dynamics/rigid_body.js 56 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/world.ts 55 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/sensors/contacts.ts 54 MiB; @dimforge/rapier3d-deterministic/pipeline/world.js 45 MiB

## Before the first frame (profile pass: navigation → the scene drawn, main thread self time by what ran, ms)

| profile · scenario | first frame | busy | three | blockly | react-dom | r3f | ui: robot3d | sim | webgl calls | browser | gc |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ss-low-4x · rb-grip-pick | 2076–3468 | 1456–3043 | 764–1014 | 107–193 | 59–66 | 45–48 | 0 | 4–6 | 17–1186 | 154–216 | 12–15 |
| ss-low-4x · rb-grip-deliver | 2093–2115 | 1475–1512 | 775–796 | 109–118 | 64–68 | 46–51 | 0 | 1–5 | 16–19 | 152–159 | 13–20 |
| ss-low-4x · rb-grip-sort | 2084–2126 | 1472–1520 | 771–811 | 109–116 | 55–61 | 42–49 | 0 | 1–4 | 15–17 | 153–161 | 14–17 |
| ss-low-4x · rb-grip-stack | 2075–2099 | 1369–1398 | 690–691 | 106–108 | 54–60 | 48–50 | 0 | 4–7 | 14–17 | 152–157 | 13–18 |
| ss-low-4x · rb-grip-check-4x | 2094–2120 | 1487–1498 | 763–783 | 110–113 | 61–64 | 41–54 | 0 | 3–7 | 14–17 | 157–163 | 10–19 |

- **ss-low-4x · rb-grip-pick**: WebGL calls (through the bench probe) 1186; three/build/three.module.js 882; (browser) 216; blockly/blockly_compressed.js 187; three/build/three.core.js 85; react-dom/cjs/react-dom-client.production.js 66; (unknown) 48; @react-three/fiber/dist/events-9ce18a08.esm.js 46; react-use-measure/dist/index.js 42; zod/v4/core/schemas.js 36
- **ss-low-4x · rb-grip-deliver**: three/build/three.module.js 653; (browser) 158; blockly/blockly_compressed.js 108; three/build/three.core.js 95; react-dom/cjs/react-dom-client.production.js 68; @react-three/fiber/dist/events-9ce18a08.esm.js 45; (unknown) 41; react-use-measure/dist/index.js 39; zod/v4/core/schemas.js 35; three/examples/jsm/loaders/GLTFLoader.js 31
- **ss-low-4x · rb-grip-sort**: three/build/three.module.js 635; (browser) 161; blockly/blockly_compressed.js 111; three/build/three.core.js 93; react-dom/cjs/react-dom-client.production.js 55; @react-three/fiber/dist/events-9ce18a08.esm.js 39; react-use-measure/dist/index.js 39; (unknown) 37; three/examples/jsm/loaders/GLTFLoader.js 32; zod/v4/core/schemas.js 31
- **ss-low-4x · rb-grip-stack**: three/build/three.module.js 559; (browser) 157; blockly/blockly_compressed.js 103; three/build/three.core.js 79; react-dom/cjs/react-dom-client.production.js 57; @react-three/fiber/dist/events-9ce18a08.esm.js 46; react-use-measure/dist/index.js 41; (unknown) 41; three/examples/jsm/loaders/GLTFLoader.js 40; zod/v4/core/schemas.js 39
- **ss-low-4x · rb-grip-check-4x**: three/build/three.module.js 655; (browser) 160; blockly/blockly_compressed.js 107; three/build/three.core.js 80; react-dom/cjs/react-dom-client.production.js 61; @react-three/fiber/dist/events-9ce18a08.esm.js 50; (unknown) 39; react-use-measure/dist/index.js 37; zod/v4/core/schemas.js 36; three/examples/jsm/loaders/GLTFLoader.js 34

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| ss-low-4x · rb-grip-pick | 51 (43, 0) | 9 | 22 Lambert, 10 Basic, 7 Sprite | 43329 | 30958 | 11 | 8.8: 4.3 + 1.9 + 0 + 2.5 | MeshLambertMaterial 850×450 canvas aniso 8; birch_face 1024×128 ImageBitmap; walnut 256×256 ImageBitmap; pcb_teal 200×256 ImageBitmap |

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
