# bench:robot3d — 2026-10-25T17:22:13.580Z — master-fps-sim4x

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 518f6a2. Sensor overlays on (where the build has them). Repeats 3, window 8 s, soak 10 min, switches 20. 1-minute load average from 6.6–13.26 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 378.5 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | Run → moving (warm), every profile | 47 ms | ≤ 300 ms | ok | 18 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 18 | idle before a run, a parked robot, after an orbit settles |
| target | school: p95 frame time running at 4× | 21.8 ms | ≤ 33 ms | ok | 6 | sim speed 4× and Kiểm tra 4× |
| target | school: long tasks > 100 ms during a run | 0  | ≤ 0  | ok | 6 | in the measuring window |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high-sim4x · line-follow | 59.9 | 54.3–54.9 | 16.7 / 18.2–18.4 / 18.6–18.9 | 1.6–1.7 / 2.4–2.6 | 0.5 | 82 + 51 | 0 (0) 0 | 30 (—) | 107–114 (24–25) | 0.9–0.9 (0.05–0.06) | 2.6–2.8 (0.16–0.17) | 0.6 | 16 | 6.6–8.09 |
| gpu-high-sim4x · mini-mission | 59.9–60.2 | 55.2–57.5 | 16.6–16.7 / 17.4–18.1 / 181.8–183.6 | 1.2–1.4 / 2.1–2.2 | 0.5 | 85 + 54 | 0 (0) 0 | 30.4 (—) | 85–92 (19–20) | 0.6–0.7 (0.04) | 2.3–2.4 (0.14) | 0.7 | 17–18 | 7.51–8.12 |
| ss-low-4x-sim4x · line-follow | 59.9–60.6 | 52.4–53.5 | 16.5–16.7 / 18.7–19.1 / 19.5–19.9 | 5.5–5.9 / 8.2–8.8 | 0.9–1 | 46 + 0 | 0 (0) 0 | 30–30.1 (—) | 354–381 (59–74) | 48.9–54.7 (2.93–3.28) | 15.1–15.2 (0.9–0.91) | 0.4–0.6 | 64–68 | 7.42–12.76 |
| ss-low-4x-sim4x · mini-mission | 59.5–59.9 | 23.2–51 | 16.7–16.8 / 19.6–43.1 / 150.5–182.3 | 3.2–4.6 / 6.2–7.7 | 0.8–0.9 | 49 + 0 | 0 (0) 0 | 30.1 (—) | 234–315 (47–60) | 28.4–34.6 (1.69–2.06) | 14.5–15 (0.86–0.89) | 0.7 | 64–66 | 9.54–13.26 |
| school-sim4x · line-follow | 59.9–60.6 | 50.3–51.5 | 16.5–16.7 / 19.4–19.9 / 21.2–23 | 8.1–8.4 / 12.9–13.2 | 1.4 | 46 + 0 | 0 (0) 0 | 30 (—) | 515–540 (89–94) | 54.9–55.7 (3.29–3.34) | 16.4–16.5 (0.98–0.99) | 0.6 | 95–100 | 8.82–9.64 |
| school-sim4x · mini-mission | 59.2–60.6 | 45.9–49.5 | 16.5–16.9 / 20.2–21.8 / 178.3–186.3 | 5.9–7.6 / 10.2–11.8 | 1.2–1.5 | 49 + 0 | 3 (0) 54–59 | 29.9–30 (—) | 408–487 (79–96) | 29.8–31.3 (1.76–1.85) | 16.2–16.6 (0.96–0.98) | 0.7 | 98–99 | 6.87–9.84 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high-sim4x · line-follow | 903–1095 | 127–153 | 502–646 | 423–446 | 467–614 | 560–718 → 603–752 | 634–782 | 634–782 | 133–312 (83–148) | 16–22 | 16 | 54.5 | 71–72 | 7–9 | 0 | — |
| gpu-high-sim4x · mini-mission | 954–966 | 124–138 | 502–513 | 419–430 | 465–479 | 562–573 → 606–628 | 627–648 | 627–648 | 148–153 (96–100) | 16–19 | 15 | 55.3 | 72–83 | 7 | 0 | — |
| ss-low-4x-sim4x · line-follow | 2116–3870 | 324–370 | 857–2399 | 658–697 | 961–2606 | 1190–2734 → 1226–2769 | 949–2494 | 1796–3702 | 527–2056 (210–1499) | 171–1683 | 13 | 9.7 | 263–301 | 27–29 | 0 | — |
| ss-low-4x-sim4x · mini-mission | 2082–2170 | 323–370 | 830–890 | 647–697 | 977–1108 | 1162–1228 → 1193–1260 | 964–1027 | 1716–1818 | 540–580 (201–223) | 213–287 | 12 | 9.9 | 252–273 | 26–28 | 0 | — |
| school-sim4x · line-follow | 2375–4006 | 463–492 | 1085–2573 | 811–845 | 1239–2741 | 1431–2930 → 1477–2976 | 1214–2711 | 2043–3818 | 740–888 (303–339) | 253–270 | 13 | 9.7 | 394–409 | 40–47 | 0 | — |
| school-sim4x · mini-mission | 2470–2521 | 469–492 | 1111–1145 | 818–843 | 1345–1375 | 1506–1530 → 1549–1574 | 1319–1350 | 2098–2156 | 842–905 (317–322) | 331–355 | 12 | 9.9 | 392–403 | 39–43 | 0 | — |

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| gpu-high-sim4x · line-follow | 90 (78, 53) | 5 | 62 Standard, 10 Basic, 3 Sprite, 4 Physical | 97509 | 157614 | 16 | 54.5: 22.4 + 3.7 + 16 + 12.5 | MeshStandardMaterial 1360×1120 canvas aniso 8; PMREM.cubeUv 768×1024 other; birch_face 2048×256 ImageBitmap aniso 8; MeshStandardMaterial 680×560 canvas |
| ss-low-4x-sim4x · line-follow | 52 (40, 0) | 5 | 22 Lambert, 10 Basic, 3 Sprite | 51046 | 36754 | 13 | 9.7: 4.8 + 2.3 + 0 + 2.5 | MeshLambertMaterial 850×700 canvas aniso 8; birch_face 1024×128 ImageBitmap; walnut 256×256 ImageBitmap; pcb_teal 200×256 ImageBitmap |
| school-sim4x · line-follow | 52 (40, 0) | 5 | 22 Lambert, 10 Basic, 3 Sprite | 51046 | 36754 | 13 | 9.7: 4.8 + 2.3 + 0 + 2.5 | MeshLambertMaterial 850×700 canvas aniso 8; birch_face 1024×128 ImageBitmap; walnut 256×256 ImageBitmap; pcb_teal 200×256 ImageBitmap |

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
