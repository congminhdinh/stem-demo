# bench:robot3d — 2026-10-27T07:57:28.969Z — e9b-school

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 8760350. Sensor overlays on (where the build has them). Repeats 3, window 8 s, soak 10 min, switches 20. 1-minute load average from 3.7–9.79 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 419.1 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | Run → moving (warm), every profile | 77 ms | ≤ 300 ms | ok | 12 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 27 | idle before a run, a parked robot, after an orbit settles |
| target | school: p95 frame time running at 1× | 20 ms | ≤ 33 ms | ok | 12 | every run scenario, low tier |
| target | school: p95 frame time of Kiểm tra 4× (rb-grip-check-4x) | 31.8 ms | ≤ 33 ms | ok | 3 | the whole check of a gripper lesson at 4× |
| target | school and ss-low-4x: long tasks > 100 ms in Kiểm tra 4× (rb-grip-check-4x) | 0  | ≤ 0  | ok | 3 | the whole check; tasks of 50 to 100 ms are in the frames table |
| target | school: long tasks > 100 ms during a run | 0  | ≤ 0  | ok | 12 | in the measuring window |
| target | school: first frame | 4075 ms | ≤ 2500 ms | not met | 15 | lesson page navigation → the scene drawn |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · rb-grip-pick | 59.9–60.2 | 51–52.6 | 16.6–16.7 / 19–19.6 / 22.1–24.1 | 7.5–7.7 / 12.1–13.3 | 1.4–1.5 | 48 + 0 | 0 (0) 0 | 17.7 (—) | 507–532 (152–158) | 87.3–88.4 (5.23–5.3) | 16.6–16.7 (0.99–1) | 1.7 | 90–94 | 4.06–5.48 |
| school · rb-grip-deliver | 59.9–60.2 | 50.8–53.2 | 16.6–16.7 / 18.8–19.7 / 22.9–27.7 | 7.1–7.2 / 11.4–11.7 | 1.5 | 63 + 0 | 0 (0) 0 | 11.7–11.9 (—) | 470–476 (144–148) | 105.8–106.3 (6.31–6.36) | 16.4–16.5 (0.98–0.99) | 7.1 | 95–99 | 4.2–7.46 |
| school · rb-grip-sort | 59.5–60.2 | 50–50.8 | 16.6–16.8 / 19.7–20 / 30–31.9 | 7–7.7 / 13.3–14 | 1.4–1.5 | 52 + 0 | 0 (0) 0 | 17.8 (—) | 498–525 (151–164) | 93.5–95.3 (5.6–5.71) | 16.6–16.6 (0.99–1) | 1.2 | 96–98 | 4.94–7.52 |
| school · rb-grip-stack | 59.9 | 50.5–51.8 | 16.7 / 19.3–19.8 / 29.9–30.8 | 7.4–7.5 / 12.5–13 | 1.3–1.4 | 53 + 0 | 0 (0) 0 | 13.7–14.1 (—) | 507–511 (143–146) | 94–95.5 (5.63–5.72) | 16.5–16.6 (0.99) | 1.7 | 96–100 | 3.7–6.23 |
| school · rb-grip-check-4x | 56.2–57.5 | 31.4–32.5 | 17.4–17.8 / 30.8–31.8 / 53.9–264.1 | 10.5–10.8 / 20.1–20.7 | 1.5–1.6 | 52 + 0 | 2 (0) 64–78 | 33.4–33.8 (—) | 702–717 (76–81) | 48.9–49.5 (2.77–2.83) | 17.6–18 (1.01) | 0.9 | 95–97 | 6.25–8.15 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| school · rb-grip-pick | 2467–4075 | 481–642 | 1139–2645 | 840–1056 | 1253–2782 | 1491–3006 → 1530–3049 | 1228–2745 | 2059–3916 | 803–1052 (325–404) | 227–256 | 11 | 8.8 | 112–119 | 69–75 | 0 | 0 |
| school · rb-grip-deliver | 2496–2713 | 488–527 | 1165–1214 | 844–883 | 1287–1330 | 1524–1567 → 1575–1616 | 1256–1304 | 2146–2199 | 773–833 (333–340) | 233–246 | 11 | 11 | 118–120 | 72–73 | 0 | 0 |
| school · rb-grip-sort | 2478–2523 | 492–508 | 1181–1214 | 849–866 | 1305–1346 | 1533–1571 → 1579–1618 | 1282–1319 | 1966–2228 | 833–873 (334–352) | 250–266 | 11 | 10.6 | 125–132 | 74–77 | 0 | 0 |
| school · rb-grip-stack | 2510–2546 | 499–518 | 1193–1211 | 859–877 | 1302–1333 | 1544–1574 → 1598–1621 | 1994–2033 | 2171–2220 | 1223–1260 (388–402) | 225–250 | 10 | 8.9 | 120–131 | 72–76 | 0 | 0 |
| school · rb-grip-check-4x | 2511–2539 | 497–531 | 1202–1218 | 858–893 | 1327–1345 | 1560–1573 → 1605–1615 | 1301–1318 | 2213–2248 | 846–873 (336–366) | 245–250 | 11 | 10.6 | — | — | 0 | — |

## Where the main thread goes (profile pass, ms per animation frame, ranges over the repeats)

| profile · scenario | busy | sim | render (shadow map) | React | Blockly | scene callbacks | GC | browser (style, layout, paint, GL) | alloc/frame KB | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|
| school · rb-grip-pick | 10.55–10.88 | 3.4–3.45 | 1.57–1.64 (0) | 0.45–0.46 | 0–0.01 | 0.7–0.83 | 0.09–0.14 | 1.8–1.85 | 229.4–235.2 | 98–99 | 6.22–7.21 |
| school · rb-grip-deliver | 9.78–9.92 | 3.28–3.43 | 1.72–1.76 (0) | 0.34–0.36 | 0–0.01 | 0.57–0.62 | 0.07–0.11 | 1.38–1.45 | 225.3–226 | 95–99 | 4.8–9.79 |
| school · rb-grip-sort | 10.2–10.37 | 3.28–3.5 | 1.51–1.61 (0) | 0.45–0.47 | 0–0.01 | 0.74–0.81 | 0.12–0.13 | 1.75–1.83 | 234.8–240.5 | 96–99 | 5.26–7.31 |
| school · rb-grip-stack | 10.25–10.53 | 3.3–3.45 | 1.51–1.57 (0) | 0.47–0.49 | 0–0.01 | 0.65–0.72 | 0.07–0.08 | 1.62–1.76 | 222.6–225.9 | 94–95 | 4.34–5.01 |
| school · rb-grip-check-4x | 14.72–15.25 | 8.16–8.39 | 0.44–0.46 (0) | 0.73–0.76 | 0–0.01 | 0.31–0.34 | 0.14–0.18 | 2.11–2.16 | 519.6–526.8 | 95–98 | 6.29–7.53 |

## The busiest sources (profile pass, self time in the window, ms; the first repeat)

- **school · rb-grip-pick** (6 s, 359 frames): rapier.wasm 919; (browser) 646; three/build/three.module.js 470; three/build/three.core.js 159; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 148; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/run/robot-run-session.ts 120; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/run/virtual-clock.ts 100; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/world.ts 96. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 9 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/arena/ground-paint.ts 6 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/ui/robot3d/camera-studio.ts 6 MiB; @dimforge/rapier3d-deterministic/math.js 5 MiB; three/build/three.module.js 5 MiB
- **school · rb-grip-deliver** (8 s, 480 frames): rapier.wasm 1176; three/build/three.module.js 710; (browser) 698; three/build/three.core.js 220; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 212; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/world.ts 166; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/run/robot-run-session.ts 133; react-dom/cjs/react-dom-client.production.js 83. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 13 MiB; three/build/three.module.js 8 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/world.ts 7 MiB; @dimforge/rapier3d-deterministic/dynamics/rigid_body.js 6 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/units.ts 5 MiB
- **school · rb-grip-sort** (6 s, 360 frames): rapier.wasm 890; (browser) 658; three/build/three.module.js 442; three/build/three.core.js 180; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 151; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/world.ts 99; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/run/robot-run-session.ts 91; react-dom/cjs/react-dom-client.production.js 89. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 9 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/arena/ground-paint.ts 7 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/ui/robot3d/camera-studio.ts 5 MiB; three/build/three.module.js 5 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/world.ts 5 MiB
- **school · rb-grip-stack** (8 s, 480 frames): rapier.wasm 1223; (browser) 777; three/build/three.module.js 620; three/build/three.core.js 196; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 168; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/world.ts 145; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/run/robot-run-session.ts 128; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/program/ybc-interpreter.ts 117. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 13 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/ui/robot3d/camera-studio.ts 7 MiB; three/build/three.module.js 6 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/world.ts 6 MiB; @dimforge/rapier3d-deterministic/dynamics/rigid_body.js 5 MiB
- **school · rb-grip-check-4x** (25 s, 1350 frames): rapier.wasm 9010; (browser) 2915; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 1404; react-dom/cjs/react-dom-client.production.js 540; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/world.ts 537; three/build/three.module.js 484; WebGL calls (through the bench probe) 451; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/run/robot-run-session.ts 386. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 106 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/world.ts 56 MiB; @dimforge/rapier3d-deterministic/dynamics/rigid_body.js 55 MiB; Users/hoangminh/Desktop/stem/.worktrees/sd-n19-e9b/src/core/world/sensors/contacts.ts 55 MiB; @dimforge/rapier3d-deterministic/pipeline/world.js 45 MiB

## Before the first frame (profile pass: navigation → the scene drawn, main thread self time by what ran, ms)

| profile · scenario | first frame | busy | three | blockly | react-dom | r3f | ui: robot3d | sim | webgl calls | browser | gc |
|---|---|---|---|---|---|---|---|---|---|---|---|
| school · rb-grip-pick | 1951–3862 | 1753–3586 | 672–1164 | 165–265 | 90–107 | 62–73 | 0 | 6–8 | 25–36 | 250–1479 | 18–23 |
| school · rb-grip-deliver | 1961–2156 | 1787–1960 | 733–852 | 168–179 | 93–98 | 71–74 | 0 | 5–9 | 24–28 | 247–264 | 19–23 |
| school · rb-grip-sort | 1994–2600 | 1808–2003 | 686–878 | 166–178 | 91–102 | 66–72 | 0 | 5–7 | 24–27 | 237–251 | 21–24 |
| school · rb-grip-stack | 2086–2100 | 1848–1861 | 759–783 | 162–174 | 89–96 | 63–79 | 0 | 2–7 | 23–33 | 240–251 | 20–27 |
| school · rb-grip-check-4x | 1967–2137 | 1783–1920 | 693–837 | 166–169 | 84–91 | 69–77 | 0 | 1–7 | 24–25 | 241–249 | 22–23 |

- **school · rb-grip-pick**: (browser) 1479; three/build/three.module.js 960; blockly/blockly_compressed.js 254; three/build/three.core.js 131; react-dom/cjs/react-dom-client.production.js 90; (unknown) 73; @react-three/fiber/dist/events-9ce18a08.esm.js 61; react-use-measure/dist/index.js 60; zod/v4/core/schemas.js 53; three/examples/jsm/loaders/GLTFLoader.js 52
- **school · rb-grip-deliver**: three/build/three.module.js 490; (browser) 247; blockly/blockly_compressed.js 160; three/build/three.core.js 159; react-dom/cjs/react-dom-client.production.js 93; @react-three/fiber/dist/events-9ce18a08.esm.js 71; three/examples/jsm/loaders/GLTFLoader.js 60; react-use-measure/dist/index.js 60; (unknown) 57; zod/v4/core/schemas.js 53
- **school · rb-grip-sort**: three/build/three.module.js 480; (browser) 251; blockly/blockly_compressed.js 171; three/build/three.core.js 140; react-dom/cjs/react-dom-client.production.js 100; react-use-measure/dist/index.js 79; @react-three/fiber/dist/events-9ce18a08.esm.js 69; (unknown) 56; three/examples/jsm/loaders/GLTFLoader.js 49; zod/v4/core/schemas.js 47
- **school · rb-grip-stack**: three/build/three.module.js 569; (browser) 251; blockly/blockly_compressed.js 165; three/build/three.core.js 149; react-dom/cjs/react-dom-client.production.js 93; react-use-measure/dist/index.js 67; @react-three/fiber/dist/events-9ce18a08.esm.js 63; (unknown) 59; zod/v4/core/schemas.js 53; three/examples/jsm/loaders/GLTFLoader.js 50
- **school · rb-grip-check-4x**: three/build/three.module.js 628; (browser) 241; blockly/blockly_compressed.js 158; three/build/three.core.js 139; react-dom/cjs/react-dom-client.production.js 90; @react-three/fiber/dist/events-9ce18a08.esm.js 75; (unknown) 64; react-use-measure/dist/index.js 61; three/examples/jsm/loaders/GLTFLoader.js 51; zod/v4/core/schemas.js 50

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| school · rb-grip-pick | 51 (43, 0) | 9 | 22 Lambert, 10 Basic, 7 Sprite | 43329 | 30958 | 11 | 8.8: 4.3 + 1.9 + 0 + 2.5 | MeshLambertMaterial 850×450 canvas aniso 8; birch_face 1024×128 ImageBitmap; walnut 256×256 ImageBitmap; pcb_teal 200×256 ImageBitmap |

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
