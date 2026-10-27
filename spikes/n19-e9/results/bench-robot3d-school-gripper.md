# bench:robot3d — 2026-10-27T02:01:37.723Z — e910-gripper

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 46a3f82. Sensor overlays on (where the build has them). Repeats 3, window 8 s, soak 10 min, switches 20. 1-minute load average from 6.14–13.8 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 414.6 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | Run → moving (warm), every profile | 85 ms | ≤ 300 ms | ok | 12 | click to the first render with the robot moved |
| budget | draws per second at rest | 10 /s | ≤ 0 /s | MISSED | 27 | idle before a run, a parked robot, after an orbit settles |
| target | school: p95 frame time running at 1× | 20.8 ms | ≤ 33 ms | ok | 12 | every run scenario, low tier |
| target | school: long tasks > 100 ms during a run | 0  | ≤ 0  | ok | 12 | in the measuring window |
| target | school: first frame | 4086 ms | ≤ 2500 ms | not met | 15 | lesson page navigation → the scene drawn |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · rb-grip-pick | 59.9–60.6 | 50.5–51 | 16.5–16.7 / 19.6–19.8 / 21.6–24.8 | 8–8.3 / 12.3–13.8 | 1.5 | 49 + 0 | 0 (0) 0 | 17.6–17.7 (—) | 529–553 (150–158) | 89–89.7 (5.33–5.37) | 16.6–16.7 (1) | 1 | 102–107 | 6.14–6.63 |
| school · rb-grip-deliver | 59.9 | 49.8–51 | 16.7 / 19.6–20.1 / 24.5–32.5 | 7.4–7.5 / 12.1–12.5 | 1.6 | 63 + 0 | 0 (0) 0 | 11.7–11.9 (—) | 498–500 (149–156) | 105.8–106.9 (6.31–6.41) | 16.5–16.6 (0.99) | 5 | 97–100 | 7.89–12.39 |
| school · rb-grip-sort | 59.5–59.9 | 48.1–49 | 16.7–16.8 / 20.4–20.8 / 29.8–32.7 | 7.1–7.6 / 14.2–15.3 | 1.5–1.6 | 52 + 0 | 0 (0) 0 | 17.8 (—) | 512–533 (153–166) | 95.3–96.2 (5.71–5.76) | 16.6–16.8 (0.99–1) | 1.3 | 99 | 11.62–13.8 |
| school · rb-grip-stack | 59.9–60.2 | 48.3–49.3 | 16.6–16.7 / 20.3–20.7 / 30.4–32 | 7.7–7.9 / 13.2–13.3 | 1.4–1.5 | 53 + 0 | 0 (0) 0 | 13.7–14.2 (—) | 516–534 (147–152) | 96.2–96.9 (5.77–5.81) | 16.5–16.6 (0.99) | 0.9 | 98–99 | 10.48–12.75 |
| school · rb-grip-check-4x | 52.9–56.5 | 29–32.4 | 17.7–18.9 / 30.9–34.5 / 62–242 | 11.3–11.6 / 20.7–22.4 | 1.6–1.7 | 52 + 0 | 2–3 (0) 68–79 | 33.2–33.3 (—) | 733–752 (80–86) | 49.1–50.3 (2.77–2.84) | 17.8–18.3 (1.01–1.02) | 1.3–1.6 | 98–99 | 8.36–9.44 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · rb-grip-pick | 2556–4086 | 537–590 | 1256–2647 | 904–990 | 1382–2790 | 1613–3011 → 1659–3055 | 1350–2750 | 2254–3937 | 897–1065 (368–404) | 249–265 | 11 | 8.8 | 127–134 | 79–83 | 0 | 0 |
| school · rb-grip-deliver | 2565–2642 | 537–551 | 1257–1260 | 894–912 | 1380–1383 | 1612–1617 → 1656–1665 | 1350–1354 | 2260–2293 | 892–910 (373–380) | 251–254 | 11 | 11 | 129–131 | 77–78 | 0 | 0 |
| school · rb-grip-sort | 2528–2546 | 521–529 | 1223–1236 | 874–890 | 1359–1365 | 1581–1589 → 1626–1634 | 1329–1338 | 2013–2253 | 893–895 (358–363) | 256–265 | 11 | 10.6 | 129–134 | 82–85 | 0 | 0 |
| school · rb-grip-stack | 2547–2554 | 531–543 | 1237–1244 | 889–898 | 1355–1361 | 1595–1596 → 1647–1648 | 2035–2039 | 2216–2224 | 1259–1286 (386–391) | 239–244 | 10 | 8.9 | 125–127 | 77–80 | 0 | 9.99–10 |
| school · rb-grip-check-4x | 2543–2785 | 522–576 | 1222–1283 | 878–942 | 1356–1419 | 1578–1641 → 1626–1688 | 1327–1390 | 2030–2274 | 890–916 (359–381) | 258–262 | 11 | 10.6 | — | — | 0 | — |

## Where the main thread goes (profile pass, ms per animation frame, ranges over the repeats)

| profile · scenario | busy | sim | render (shadow map) | React | Blockly | scene callbacks | GC | browser (style, layout, paint, GL) | alloc/frame KB | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|
| school · rb-grip-pick | 10.67–10.96 | 3.4–3.57 | 1.5–1.64 (0–0.01) | 0.41–0.48 | 0 | 0.76–0.78 | 0.11–0.13 | 1.86–1.95 | 225.6–230.1 | 98–99 | 7.67–8.34 |
| school · rb-grip-deliver | 9.95–10.5 | 3.46–3.65 | 1.73–1.78 (0–0.01) | 0.36–0.38 | 0–0.01 | 0.58–0.66 | 0.06–0.07 | 1.45–1.53 | 225–229.9 | 98–99 | 6.55–9.92 |
| school · rb-grip-sort | 10.37–10.88 | 3.58–3.69 | 1.63–1.64 (0) | 0.5–0.54 | 0–0.01 | 0.71–0.78 | 0.09–0.14 | 1.8–1.95 | 234.6–236.9 | 98–100 | 10.53–10.68 |
| school · rb-grip-stack | 10.62–10.67 | 3.46–3.53 | 1.55–1.62 (0) | 0.42–0.51 | 0–0.01 | 0.7–0.72 | 0.07–0.11 | 1.67–1.68 | 229.5–234.4 | 99–100 | 9.42–10.89 |
| school · rb-grip-check-4x | 15.6–16.11 | 8.67–8.73 | 0.46–0.5 (0) | 0.78–0.81 | 0 | 0.29–0.3 | 0.17–0.19 | 2.22–2.25 | 516.2–520 | 98 | 7.09–9.3 |

## The busiest sources (profile pass, self time in the window, ms; the first repeat)

- **school · rb-grip-pick** (6 s, 360 frames): rapier.wasm 965; (browser) 703; three/build/three.module.js 477; three/build/three.core.js 175; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 130; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/run/robot-run-session.ts 117; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/world.ts 114; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/run/virtual-clock.ts 91. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 9 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/ui/robot3d/camera-studio.ts 6 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/arena/ground-paint.ts 6 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/sensors/contacts.ts 6 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/world.ts 5 MiB
- **school · rb-grip-deliver** (8 s, 480 frames): rapier.wasm 1246; three/build/three.module.js 715; (browser) 694; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 220; three/build/three.core.js 200; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/world.ts 145; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/run/robot-run-session.ts 122; react-dom/cjs/react-dom-client.production.js 93. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 13 MiB; three/build/three.module.js 8 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/world.ts 7 MiB; @dimforge/rapier3d-deterministic/dynamics/rigid_body.js 6 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/sensors/contacts.ts 5 MiB
- **school · rb-grip-sort** (6 s, 360 frames): rapier.wasm 963; (browser) 648; three/build/three.module.js 473; three/build/three.core.js 176; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 168; react-dom/cjs/react-dom-client.production.js 103; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/run/robot-run-session.ts 103; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/world.ts 78. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 9 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/arena/ground-paint.ts 7 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/ui/robot3d/camera-studio.ts 6 MiB; three/build/three.module.js 5 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/world.ts 5 MiB
- **school · rb-grip-stack** (8 s, 478 frames): rapier.wasm 1277; (browser) 799; three/build/three.module.js 615; three/build/three.core.js 212; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 197; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/world.ts 155; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/run/robot-run-session.ts 124; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/run/virtual-clock.ts 118. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 13 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/ui/robot3d/camera-studio.ts 11 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/world.ts 6 MiB; three/build/three.module.js 6 MiB; @dimforge/rapier3d-deterministic/dynamics/rigid_body.js 5 MiB
- **school · rb-grip-check-4x** (25 s, 1351 frames): rapier.wasm 9297; (browser) 3036; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 1532; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/world.ts 644; WebGL calls (through the bench probe) 627; react-dom/cjs/react-dom-client.production.js 578; three/build/three.module.js 502; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/run/robot-run-session.ts 443. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 104 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/sensors/contacts.ts 55 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e910/src/core/world/world.ts 54 MiB; @dimforge/rapier3d-deterministic/dynamics/rigid_body.js 54 MiB; @dimforge/rapier3d-deterministic/pipeline/world.js 44 MiB

## Before the first frame (profile pass: navigation → the scene drawn, main thread self time by what ran, ms)

| profile · scenario | first frame | busy | three | blockly | react-dom | r3f | ui: robot3d | sim | webgl calls | browser | gc |
|---|---|---|---|---|---|---|---|---|---|---|---|
| school · rb-grip-pick | 1988–3866 | 1973–3572 | 836–1154 | 171–266 | 86–98 | 64–71 | 0 | 2–12 | 27–36 | 242–1462 | 17–25 |
| school · rb-grip-deliver | 1990–2609 | 1815–2001 | 704–889 | 173–177 | 87–101 | 70–78 | 0 | 5–7 | 21–23 | 244–247 | 19–32 |
| school · rb-grip-sort | 1970–1986 | 1802–1806 | 681–689 | 171–181 | 96–107 | 64–73 | 0 | 3–12 | 23–26 | 231–249 | 16–22 |
| school · rb-grip-stack | 1988–2124 | 1769–1913 | 653–795 | 177–183 | 84–96 | 69–77 | 0 | 4–7 | 27–29 | 234–255 | 21–25 |
| school · rb-grip-check-4x | 1987–2611 | 1814–2016 | 684–862 | 173–180 | 101–106 | 74–78 | 0 | 7–10 | 24–26 | 236–261 | 19–24 |

- **school · rb-grip-pick**: (browser) 1462; three/build/three.module.js 945; blockly/blockly_compressed.js 256; three/build/three.core.js 126; react-dom/cjs/react-dom-client.production.js 86; (unknown) 75; @react-three/fiber/dist/events-9ce18a08.esm.js 70; zod/v4/core/schemas.js 61; three/examples/jsm/loaders/GLTFLoader.js 59; react-use-measure/dist/index.js 57
- **school · rb-grip-deliver**: three/build/three.module.js 648; (browser) 244; blockly/blockly_compressed.js 165; three/build/three.core.js 156; react-dom/cjs/react-dom-client.production.js 101; @react-three/fiber/dist/events-9ce18a08.esm.js 74; (unknown) 67; three/examples/jsm/loaders/GLTFLoader.js 61; zod/v4/core/schemas.js 58; react-use-measure/dist/index.js 58
- **school · rb-grip-sort**: three/build/three.module.js 477; (browser) 231; blockly/blockly_compressed.js 172; three/build/three.core.js 133; react-dom/cjs/react-dom-client.production.js 107; @react-three/fiber/dist/events-9ce18a08.esm.js 73; zod/v4/core/schemas.js 64; (unknown) 63; react-use-measure/dist/index.js 61; three/examples/jsm/loaders/GLTFLoader.js 51
- **school · rb-grip-stack**: three/build/three.module.js 433; (browser) 252; blockly/blockly_compressed.js 167; three/build/three.core.js 148; react-dom/cjs/react-dom-client.production.js 94; @react-three/fiber/dist/events-9ce18a08.esm.js 65; react-use-measure/dist/index.js 62; (unknown) 62; three/examples/jsm/loaders/GLTFLoader.js 53; zod/v4/core/schemas.js 52
- **school · rb-grip-check-4x**: three/build/three.module.js 491; (browser) 236; blockly/blockly_compressed.js 170; three/build/three.core.js 128; react-dom/cjs/react-dom-client.production.js 101; @react-three/fiber/dist/events-9ce18a08.esm.js 69; (unknown) 65; react-use-measure/dist/index.js 61; three/examples/jsm/loaders/GLTFLoader.js 57; zod/v4/core/schemas.js 46

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| school · rb-grip-pick | 51 (43, 0) | 9 | 22 Lambert, 10 Basic, 7 Sprite | 43325 | 30960 | 11 | 8.8: 4.3 + 1.9 + 0 + 2.5 | MeshLambertMaterial 850×450 canvas aniso 8; birch_face 1024×128 ImageBitmap; walnut 256×256 ImageBitmap; pcb_teal 200×256 ImageBitmap |

## Bundle (gzip -6)

| file | bytes | gzip | holds |
|---|---|---|---|
| test-hooks-f6unhMn2.js | 1489736 | 422712 | — |
| RobotLab-DBvKAsuJ.js | 1440268 | 414560 | three, r3f, gltfLoader, meshopt |
| index-CAy5vDL4.js | 484533 | 146084 | — |
| rapier-DZ_EfFMH.js | 295823 | 52055 | rapier |
| rolldown-runtime-hePW80VL.js | 716 | 428 | — |
| rapier_wasm3d_bg-DZsYp9WG.wasm | 3105893 | 1180561 | |
| arena-props-low.glb | 242472 | 101999 | |
| arena-props.glb | 376440 | 190892 | |
| robot-kit-low.glb | 560668 | 218033 | |
| robot-kit.glb | 928072 | 411573 | |

Entry HTML loads: /favicon.svg, /assets/index-CAy5vDL4.js, /assets/rolldown-runtime-hePW80VL.js, /assets/test-hooks-f6unhMn2.js, /assets/index-CgMmDkmz.css.

## Served headers (vite preview)

| path | Cache-Control | Content-Encoding | ETag |
|---|---|---|---|
| / | no-cache | none | yes |
| /assets/RobotLab-*.js | no-cache | gzip | yes |
| /robot3d/robot-kit.glb?v=1 | no-cache | none | yes |
| /assets/rapier_wasm3d_bg-*.wasm | no-cache | none | yes |
