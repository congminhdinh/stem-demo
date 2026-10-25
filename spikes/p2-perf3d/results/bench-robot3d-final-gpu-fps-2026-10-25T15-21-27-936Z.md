# bench:robot3d — 2026-10-25T15:21:27.936Z — final-gpu-fps

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit a4717b0. Repeats 3, window 8 s, soak 10 min, switches 20. 1-minute load average from 1.63–75.36 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 370 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | gpu-high: median fps of every run | 59.9 fps | ≥ 50 fps | ok | 24 | the plan’s ≥ 50 fps mid-range |
| budget | Run → moving (warm), every profile | 17 ms | ≤ 300 ms | ok | 24 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 48 | idle before a run, a parked robot, after an orbit settles |
| budget | gpu-high: JS heap growth over the soak (minute 1 → end) | -2 % | ≤ 5 % | ok | 1 | 10 min, 2 runs |
| budget | gpu-high: JS heap growth over the soak (minute 1 → end) | -2.5 % | ≤ 5 % | ok | 1 | 10 min, 2 runs |
| budget | gpu-high: JS heap growth over the soak (minute 1 → end) | -2.8 % | ≤ 5 % | ok | 1 | 10 min, 2 runs |
| target | gpu-high: GPU resources growth over the 2D↔3D switches | 0  | ≤ 0  | ok | 1 | live WebGL contexts, geometries, textures |
| target | gpu-high: GPU resources growth over the 2D↔3D switches | 0  | ≤ 0  | ok | 1 | live WebGL contexts, geometries, textures |
| target | gpu-high: GPU resources growth over the 2D↔3D switches | 0  | ≤ 0  | ok | 1 | live WebGL contexts, geometries, textures |
| target | gpu-high: p95 frame time running | 17.7 ms | ≤ 20 ms | ok | 24 | every run scenario |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high · idle | 59.9–60.2 | 57.1–57.5 | 16.6–16.7 / 17.4–17.5 / 17.6–17.8 | 1–1.1 / 1.4–1.7 | 0.7–0.8 | 77 + 51 | 0 (0) 0 | — (—) | 87–102 (59–64) | 1.6–1.8 (0.1) | 2.8–3.1 (0.16–0.18) | 14.1–17.67 |
| gpu-high · drive-to-zone | 60.2 | 56.8–57.1 | 16.6 / 17.5–17.6 / 18 | 1.6–2.2 / 3.4–4 | 0.7–0.8 | 77 + 49 | 0 (0) 0 | 10–10.2 (—) | 127–146 (68–78) | 1.8–2 (0.11–0.12) | 3.7–4.2 (0.22–0.25) | 12.13–17.07 |
| gpu-high · line-follow | 60.2 | 56.5–57.8 | 16.6 / 17.3–17.7 / 17.6–18.3 | 1.7–2.9 / 4–4.1 | 0.7–1.4 | 80 + 51 | 0 (0) 0 | 10.6–10.7 (—) | 139–171 (70–88) | 1.9–2.2 (0.11–0.13) | 3.6–4.3 (0.21–0.26) | 7.56–9.39 |
| gpu-high · mini-mission | 59.9–60.2 | 56.5–56.8 | 16.6–16.7 / 17.6–17.7 / 18.1–18.3 | 2.2–2.6 / 3.8–4.1 | 0.7–1.2 | 79 + 54 | 0 (0) 0 | 11.6–11.7 (—) | 149–161 (78–84) | 2–2.1 (0.12–0.13) | 3.8–4.2 (0.23–0.25) | 5.06–6.27 |
| gpu-high · check-1x | 59.9–60.2 | 56.5–57.1 | 16.6–16.7 / 17.5–17.7 / 17.9–18.5 | 1.6–2.3 / 3.2–4.2 | 0.7–0.9 | 79 + 54 | 0 (0) 0 | 12.7 (—) | 122–154 (62–80) | 1.8–2.2 (0.11–0.13) | 3.3–4 (0.2–0.24) | 3.9–4.25 |
| gpu-high · check-4x | 59.9 | 55.6–56.5 | 16.7 / 17.7–18 / 20.8–28.4 | 2–2.2 / 3.3–4.4 | 0.7 | 81 + 54 | 1 (0) 74–78 | 34.3–34.4 (—) | 145–169 (36–39) | 1.1–1.2 (0.07) | 4–4.4 (0.24–0.26) | 3.45–5.43 |
| gpu-high · follow | 59.9 | 57.1–58.1 | 16.7 / 17.2–17.5 / 17.6–17.7 | 1.6–1.7 / 2.3–2.4 | 0.7 | 73 + 51 | 0 (0) 0 | 10.7 (—) | 109–111 (53–54) | 1.6–1.6 (0.1) | 2.9–3 (0.17–0.18) | 7.82–9.42 |
| gpu-high · teleop | 59.9–60.2 | 56.8–57.1 | 16.6–16.7 / 17.5–17.6 / 17.7–17.8 | 1.8 / 2.2–2.6 | 0.7–0.8 | 80 + 54 | 0 (0) 0 | 11.9–12 (—) | 115–120 (56–57) | 2.2–2.4 (0.13–0.14) | 3.5–3.6 (0.21–0.22) | 10.75–13.04 |
| gpu-high · pins | 59.9–60.2 | 56.5–56.8 | 16.6–16.7 / 17.6–17.7 / 17.9–18 | 1.6–1.8 / 2.7–2.8 | 0.6–0.7 | 80 + 51 | 0 (0) 0 | 20.7 (—) | 125–130 (56–59) | 1.7–1.8 (0.1–0.11) | 3.3–3.5 (0.2–0.21) | 12.55–13.17 |
| gpu-high · cpp | 59.9–60.2 | 56.8–57.1 | 16.6–16.7 / 17.5–17.6 / 17.8–17.9 | 1.6 / 2.2–2.3 | 0.7 | 80 + 51 | 0 (0) 0 | 11.5 (—) | 107–109 (51–51) | 1.6–1.6 (0.1) | 2.9–3 (0.18) | 11.78–12.45 |
| gpu-high · switch | — | — | — / — / — | — / — | — | — + — | — (—) — | — (—) | — (—) | — (—) | — (—) | 6.56–11.66 |
| gpu-high · soak | — | — | — / — / — | — / — | — | — + — | — (—) — | — (—) | — (—) | — (—) | — (—) | 14.38–75.36 |
| gpu-high-sim4x · line-follow | 59.9–60.2 | 56.5–57.8 | 16.6–16.7 / 17.3–17.7 / 17.6–18 | 2.3–2.4 / 3.4–4.6 | 0.6 | 80 + 51 | 0 (0) 0 | 30 (—) | 151–165 (30–31) | 1–1 (0.06) | 3.6–4 (0.22–0.24) | 1.63–2.44 |
| gpu-high-sim4x · mini-mission | 59.9 | 56.2–57.8 | 16.7 / 17.3–17.8 / 199.7–201.9 | 1.7–2.1 / 4–4.5 | 0.6–0.7 | 81 + 54 | 0 (0) 0 | 30.4 (—) | 125–155 (24–30) | 0.7–0.8 (0.04–0.05) | 3.2–3.8 (0.19–0.23) | 3.02–3.13 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high · idle | 976–1787 | 212–310 | 730–847 | 495–570 | 709–862 | 825–1184 → 869–1236 | 914–1277 | 914–1277 | 390–496 (181–227) | 29–93 | 15 | 54.4 | — | — | 0 | 0 |
| gpu-high · drive-to-zone | 945–1143 | 178–301 | 564–684 | 471–589 | 534–669 | 644–796 → 700–870 | 737–922 | 737–922 | 181–303 (106–152) | 23–37 | 15 | 49 | 102–134 | 9–10 | 0 | 0 |
| gpu-high · line-follow | 945–948 | 177–180 | 562–565 | 469–472 | 532–537 | 645–651 → 707–715 | 742–760 | 742–760 | 194–197 (119–122) | 23–24 | 15 | 54.4 | 107–118 | 13–16 | 0 | — |
| gpu-high · mini-mission | 944–954 | 178–187 | 565–573 | 472–479 | 535–543 | 649–658 → 700–725 | 728–759 | 728–759 | 210–213 (135–137) | 23–24 | 14 | 55.2 | 103–113 | 10–15 | 0 | — |
| gpu-high · check-1x | 945–958 | 177–191 | 563–573 | 470–480 | 533–545 | 645–656 → 703–715 | 741–748 | 741–748 | 210–215 (135–138) | 24 | 14 | 55.2 | — | — | 0 | — |
| gpu-high · check-4x | 960–976 | 190–205 | 576–592 | 481–496 | 549–563 | 660–678 → 721–738 | 758–772 | 758–772 | 216–220 (138–141) | 25–26 | 14 | 55.2 | — | — | 0 | — |
| gpu-high · follow | 979–1108 | 210–266 | 589–654 | 498–564 | 563–639 | 674–760 → 738–856 | 778–906 | 778–906 | 199–310 (122–155) | 28–36 | 15 | 54.4 | 132–166 | 11–13 | 0 | — |
| gpu-high · teleop | 1005–1483 | 219–270 | 598–634 | 507–536 | 586–632 | 700–950 → 788–1022 | 829–1069 | 829–1069 | 137–260 (79–155) | 28–82 | 16 | 57 | — | — | 0 | — |
| gpu-high · pins | 979–1005 | 211–235 | 592–611 | 499–520 | 565–598 | 679–703 → 745–768 | 783–817 | 783–817 | 201–212 (123–131) | 24–38 | 15 | 54.4 | 111–156 | 11–14 | 0 | — |
| gpu-high · cpp | 970–1088 | 216–248 | 586–633 | 494–532 | 563–610 | 673–737 → 747–820 | 787–859 | 787–859 | 198–298 (122–150) | 24–30 | 15 | 54.4 | 121–140 | 10–11 | 0 | — |
| gpu-high · switch | 946–977 | 179–215 | 564–593 | 471–499 | 534–570 | 646–679 → 712–743 | 742–788 | 742–788 | 195–203 (120–125) | 23–29 | 15 | 51.2 | — | — | 0 | — |
| gpu-high · soak | 1002–1765 | 239–446 | 626–852 | 527–759 | 599–907 | 723–1231 → 798–1343 | 842–1407 | 842–1407 | 228–365 (113–159) | 28–159 | 16 | 57 | — | — | 0 | — |
| gpu-high-sim4x · line-follow | 945–954 | 177–188 | 561–695 | 467–477 | 531–667 | 643–784 → 707–825 | 741–872 | 741–872 | 195–375 (120–172) | 23 | 15 | 54.4 | 98–99 | 9–13 | 0 | — |
| gpu-high-sim4x · mini-mission | 939–948 | 175–179 | 558–563 | 466–468 | 526–535 | 640–650 → 698–703 | 725–740 | 725–740 | 211–214 (135–140) | 22–25 | 14 | 55.2 | 99–100 | 11–17 | 0 | — |

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| gpu-high · idle | 87 (77, 53) | 4 | 62 Standard, 8 Basic, 2 Sprite, 4 Physical | 97102 | 156672 | 15 | 54.4: 22.3 + 3.6 + 16 + 12.5 | MeshStandardMaterial 1360×1120 canvas aniso 8; PMREM.cubeUv 768×1024 other; birch_face 2048×256 ImageBitmap aniso 8; MeshStandardMaterial 680×560 canvas |
| gpu-high-sim4x · line-follow | 87 (76, 53) | 4 | 62 Standard, 8 Basic, 2 Sprite, 4 Physical | 97102 | 157192 | 15 | 54.4: 22.3 + 3.6 + 16 + 12.5 | MeshStandardMaterial 1360×1120 canvas aniso 8; PMREM.cubeUv 768×1024 other; birch_face 2048×256 ImageBitmap aniso 8; MeshStandardMaterial 680×560 canvas |

## Soak

| profile | repeat | minutes | runs | heap after GC, minute 1 → end (MiB) | growth | frames/min | p95 frame ms (min–max over minutes) | live contexts | geometries / textures (end) |
|---|---|---|---|---|---|---|---|---|---|
| gpu-high | 1 | 10 | 2 | 20.93 → 20.51 | -1.97 % | 3511–3562 | 17.3–17.6 | 1 | 80 / 22 |
| gpu-high | 2 | 10 | 2 | 21.11 → 20.58 | -2.5 % | 3517–3562 | 17.4–17.5 | 1 | 80 / 22 |
| gpu-high | 3 | 10 | 2 | 20.93 → 20.35 | -2.79 % | 3535–3553 | 17.5–17.8 | 1 | 80 / 22 |

## Switches (growth from the first switch to the last; the scenario switches load the lesson frame again, so its contexts and renderer are new)

| profile | repeat | kind | switches | heap KB | live contexts | geometries | textures | programs | documents | listeners |
|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high | 1 | 2D ↔ 3D | 20 | 3921 | 0 | 0 | 0 | 0 | 0 | 19 |
| gpu-high | 1 | tier high ↔ low (sampled every second) | 10 | 1606 | 0 | 0 | 0 | 0 | 0 | 18 |
| gpu-high | 1 | scenario | 10 | 127 | 0 | 12 | -1 | 1 | 0 | 0 |
| gpu-high | 2 | 2D ↔ 3D | 20 | 3921 | 0 | 0 | 0 | 0 | 0 | 19 |
| gpu-high | 2 | tier high ↔ low (sampled every second) | 10 | 1578 | 0 | 0 | 0 | 0 | 0 | 18 |
| gpu-high | 2 | scenario | 10 | 127 | 0 | 12 | -1 | 1 | 0 | 0 |
| gpu-high | 3 | 2D ↔ 3D | 20 | 3923 | 0 | 0 | 0 | 0 | 0 | 19 |
| gpu-high | 3 | tier high ↔ low (sampled every second) | 10 | 1606 | 0 | 0 | 0 | 0 | 0 | 18 |
| gpu-high | 3 | scenario | 10 | 208 | 0 | 12 | -1 | 1 | 0 | 0 |

## Bundle (gzip -6)

| file | bytes | gzip | holds |
|---|---|---|---|
| test-hooks-SslOmkyj.js | 1438871 | 409492 | — |
| RobotLab-dUgPb8sK.js | 1305693 | 370018 | three, r3f, gltfLoader, meshopt |
| index-CzEPebYH.js | 483855 | 145818 | — |
| rapier-DZ_EfFMH.js | 295823 | 52055 | rapier |
| rolldown-runtime-hePW80VL.js | 716 | 428 | — |
| rapier_wasm3d_bg-DZsYp9WG.wasm | 3105893 | 1180561 | |
| arena-props-low.glb | 194772 | 83286 | |
| arena-props.glb | 303372 | 150186 | |
| robot-kit-low.glb | 495220 | 196824 | |
| robot-kit.glb | 826656 | 369080 | |

Entry HTML loads: /favicon.svg, /assets/index-CzEPebYH.js, /assets/rolldown-runtime-hePW80VL.js, /assets/test-hooks-SslOmkyj.js, /assets/index-C8LDzkpJ.css.

## Served headers (vite preview)

| path | Cache-Control | Content-Encoding | ETag |
|---|---|---|---|
| / | no-cache | none | yes |
| /assets/RobotLab-*.js | no-cache | gzip | yes |
| /robot3d/robot-kit.glb?v=1 | no-cache | none | yes |
| /assets/rapier_wasm3d_bg-*.wasm | no-cache | none | yes |
