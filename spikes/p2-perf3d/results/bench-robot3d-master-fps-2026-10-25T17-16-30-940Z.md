# bench:robot3d — 2026-10-25T17:16:30.940Z — master-fps

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 518f6a2. Sensor overlays on (where the build has them). Repeats 3, window 8 s, soak 10 min, switches 20. 1-minute load average from 1.59–9.17 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 378.5 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | gpu-high: median fps of every run | 59.9 fps | ≥ 50 fps | ok | 18 | the plan’s ≥ 50 fps mid-range |
| budget | ss-low-4x: p5 fps of every run | 54.1 fps | ≥ 30 fps | ok | 18 | the plan’s ≥ 30 fps low tier at 4× |
| budget | Run → moving (warm), every profile | 44 ms | ≤ 300 ms | ok | 36 | click to the first render with the robot moved |
| budget | ss-low-4x: first Run → moving (physics loads) | 278 ms | ≤ 1500 ms | ok | 12 | the plan’s init physics ≤ 1.5 s at 4× |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 99 | idle before a run, a parked robot, after an orbit settles |
| target | school: p95 frame time running at 1× | 19.8 ms | ≤ 33 ms | ok | 18 | every run scenario, low tier |
| target | school: p95 frame time running at 4× | 23.7 ms | ≤ 33 ms | ok | 3 | sim speed 4× and Kiểm tra 4× |
| target | school: long tasks > 100 ms during a run | 1  | ≤ 0  | not met | 21 | in the measuring window |
| target | school: first frame | 3826 ms | ≤ 2500 ms | not met | 27 | lesson page navigation → the scene drawn |
| target | gpu-high: GPU resources growth over the 2D↔3D switches | 0  | ≤ 0  | ok | 1 | live WebGL contexts, geometries, textures |
| target | gpu-high: GPU resources growth over the 2D↔3D switches | 0  | ≤ 0  | ok | 1 | live WebGL contexts, geometries, textures |
| target | gpu-high: GPU resources growth over the 2D↔3D switches | 0  | ≤ 0  | ok | 1 | live WebGL contexts, geometries, textures |
| target | ss-low-4x: GPU resources growth over the 2D↔3D switches | 0  | ≤ 0  | ok | 1 | live WebGL contexts, geometries, textures |
| target | ss-low-4x: GPU resources growth over the 2D↔3D switches | 0  | ≤ 0  | ok | 1 | live WebGL contexts, geometries, textures |
| target | ss-low-4x: GPU resources growth over the 2D↔3D switches | 0  | ≤ 0  | ok | 1 | live WebGL contexts, geometries, textures |
| target | school: GPU resources growth over the 2D↔3D switches | 0  | ≤ 0  | ok | 1 | live WebGL contexts, geometries, textures |
| target | school: GPU resources growth over the 2D↔3D switches | 0  | ≤ 0  | ok | 1 | live WebGL contexts, geometries, textures |
| target | school: GPU resources growth over the 2D↔3D switches | 0  | ≤ 0  | ok | 1 | live WebGL contexts, geometries, textures |
| target | gpu-high: p95 frame time running | 18.8 ms | ≤ 20 ms | ok | 18 | every run scenario |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high · idle | 59.9–60.2 | 55.2–55.6 | 16.6–16.7 / 18–18.1 / 18.6–21.9 | 1.1–1.6 / 3.1–3.3 | 0.9–1.2 | 78 + 51 | 0 (0) 0 | — (—) | 106–145 (76–106) | 1.7–2.3 (0.1–0.14) | 3.2–4.5 (0.19–0.26) | 2.7–2.9 | 16–24 | 2.34–3.12 |
| gpu-high · drive-to-zone | 59.9–60.2 | 54.1–55.2 | 16.6–16.7 / 18.1–18.5 / 18.7–19.6 | 1.4–1.8 / 3.3–4.7 | 0.6–0.8 | 81 + 49 | 0 (0) 0 | 10–10.2 (—) | 104–140 (54–74) | 1.6–2 (0.1–0.12) | 3.5–4.5 (0.21–0.27) | 0.2 | 23–25 | 1.59–2.12 |
| gpu-high · line-follow | 59.9–60.2 | 53.8–54.6 | 16.6–16.7 / 18.3–18.6 / 19.3–19.6 | 1.5–1.9 / 4.2–4.6 | 0.6–0.8 | 84 + 51 | 0 (0) 0 | 10.6–10.7 (—) | 117–142 (57–71) | 1.6–1.9 (0.1–0.11) | 3.2–3.8 (0.19–0.23) | 0 | 16–24 | 1.74–4.03 |
| gpu-high · mini-mission | 60.2 | 53.2–54.1 | 16.6 / 18.5–18.8 / 19.3–19.8 | 1.7–1.8 / 4.4–4.6 | 0.7–0.8 | 83 + 54 | 0 (0) 0 | 11.6–11.7 (—) | 136–144 (70–75) | 1.9–1.9 (0.11–0.12) | 3.7–3.8 (0.22–0.23) | 1.4 | 22–25 | 2.54–3.1 |
| gpu-high · check-1x | 59.9–60.2 | 53.2–54.1 | 16.6–16.7 / 18.5–18.8 / 19.5–19.7 | 1.8–2.2 / 4.4–4.8 | 0.8–0.9 | 83 + 54 | 0 (0) 0 | 12.7 (—) | 147–154 (78–83) | 1.9–2.2 (0.12–0.13) | 3.9–4.1 (0.24–0.25) | 1.4 | 23–25 | 2.11–2.3 |
| gpu-high · check-4x | 59.9–60.2 | 52.6–54.1 | 16.6–16.7 / 18.5–19 / 20.6–21 | 2–2.5 / 4.7–4.9 | 0.6–0.7 | 85 + 54 | 1 (0) 50–51 | 34.3 (—) | 158–187 (37–40) | 1–1.1 (0.06–0.07) | 4–4.6 (0.24–0.28) | 1.4 | 17–19 | 1.78–2.51 |
| gpu-high · follow | 59.9 | 55.2–55.6 | 16.7 / 18–18.1 / 18.5–18.6 | 3–3.1 / 4.2–4.5 | 1.4 | 76 + 51 | 0 (0) 0 | 10.6–10.7 (—) | 175–185 (94–99) | 2.4–2.5 (0.14–0.15) | 4.5–4.7 (0.27–0.28) | 0 | 17 | 2.8–3.2 |
| gpu-high · teleop | 59.9–60.2 | 54.3–55.2 | 16.6–16.7 / 18.1–18.4 / 18.8–19 | 2.6–2.8 / 3.8 | 1.2–1.3 | 83 + 54 | 0 (0) 0 | 11.9–12.1 (—) | 145–152 (76–80) | 2.6–2.7 (0.16) | 4–4.2 (0.24–0.25) | 0 | 17–22 | 2.72–2.85 |
| gpu-high · switch | — | — | — / — / — | — / — | — | — + — | — (—) — | — (—) | — (—) | — (—) | — (—) | — | 17–23 | 3.13–3.68 |
| ss-low-4x · idle | 59.9–60.2 | 55.6–56.5 | 16.6–16.7 / 17.7–18 / 18.3–18.4 | 1.2–1.3 / 2.3–2.6 | 0.8 | 41 + 0 | 0 (0) 0 | — (—) | 123–134 (67–71) | 90.6–91.5 (5.25–5.3) | 14.5–14.6 (0.84) | 2.9 | 60–61 | 2.07–2.77 |
| ss-low-4x · drive-to-zone | 59.9–60.2 | 55.2–55.6 | 16.6–16.7 / 18–18.1 / 18.7–19 | 2.2–2.3 / 4.2–4.4 | 0.7 | 42 + 0 | 0 (0) 0 | 10–10.2 (—) | 156–163 (62–65) | 82.8–83.5 (4.96–5) | 14.4–14.4 (0.86) | 0.2 | 59–63 | 1.64–2.3 |
| ss-low-4x · line-follow | 60.2 | 54.9–55.2 | 16.6 / 18.1–18.2 / 18.7–18.9 | 2.5–3.1 / 4.6–5.3 | 0.7–0.8 | 48 + 0 | 0 (0) 0 | 10.7 (—) | 176–207 (65–76) | 99–100.1 (5.93–6) | 14.3–14.5 (0.86–0.87) | 0 | 62–65 | 2.4–5.7 |
| ss-low-4x · mini-mission | 59.9–60.2 | 54.1–54.6 | 16.6–16.7 / 18.3–18.5 / 18.9–19.2 | 2.6–2.7 / 5–5.1 | 0.7 | 47 + 0 | 0 (0) 0 | 11.7 (—) | 185–191 (74–76) | 100.4–100.6 (6.02–6.03) | 14.4–14.4 (0.86) | 1.4 | 64–66 | 4.7–5.69 |
| ss-low-4x · check-1x | 60.2 | 54.9 | 16.6 / 18.2 / 19–19.2 | 2.6–3.5 / 5.1–6 | 0.7–0.8 | 47 + 0 | 0 (0) 0 | 12.7 (—) | 189–242 (79–94) | 97.7–104.3 (5.82–6.26) | 14.4–14.8 (0.87–0.88) | 1.4 | 63–65 | 5.4–6.45 |
| ss-low-4x · check-4x | 59.2–59.9 | 20.4–51.5 | 16.7–16.9 / 19.4–49.1 / 51.4–165.3 | 3.9–4.1 / 7.1–8.3 | 0.8–0.9 | 49 + 0 | 1 (1) 200–201 | 31.8–34.3 (—) | 291–308 (67–77) | 63.5–64.1 (3.48–3.77) | 15.3–16.6 (0.9–0.91) | 1.2–1.3 | 64–65 | 6.43–7.25 |
| ss-low-4x · follow | 59.9 | 56.2–56.5 | 16.7 / 17.7–17.8 / 18.1–18.4 | 2.5–3.1 / 4.4–5.5 | 0.6–0.7 | 42 + 0 | 0 (0) 0 | 10.7–13 (—) | 173–205 (61–74) | 94.3–100.8 (5.65–6.06) | 14.3–14.4 (0.86–0.87) | 0 | 64–67 | 7.2–7.82 |
| ss-low-4x · teleop | 59.9–60.2 | 55.2–55.6 | 16.6–16.7 / 18–18.1 / 18.5–19.1 | 3.2–3.4 / 4.5–4.9 | 0.8 | 43 + 0 | 0 (0) 0 | 11.9–12.1 (—) | 206–222 (76–81) | 130.1–132.5 (7.8–7.95) | 14.6–14.7 (0.88) | 0 | 64–65 | 7.45–8.01 |
| ss-low-4x · switch | — | — | — / — / — | — / — | — | — + — | — (—) — | — (—) | — (—) | — (—) | — (—) | — | 63–65 | 2.13–6.15 |
| school · idle | 59.2–60.2 | 52.9–54.3 | 16.6–16.9 / 18.4–18.9 / 19.6–20.2 | 1.8–2.2 / 3.2–3.9 | 1.2–1.3 | 41 + 0 | 0 (0) 0 | — (—) | 174–188 (96–101) | 91.3–93.3 (5.25–5.36) | 16–16.1 (0.92) | 2.8 | 92–96 | 2.43–2.58 |
| school · drive-to-zone | 60.2–60.6 | 51.5–51.8 | 16.5–16.6 / 19.3–19.4 / 20.5–21.4 | 3.3–4.6 / 6.3–7.9 | 1.1–1.3 | 42 + 0 | 0 (0) 0 | 10–10.2 (—) | 237–307 (95–121) | 81.3–84.7 (4.86–5.07) | 15.7–16 (0.94–0.96) | 0.2 | 93–94 | 1.96–2.03 |
| school · line-follow | 59.9–60.2 | 50.5–51.8 | 16.6–16.7 / 19.3–19.8 / 20.4–21.1 | 3.7–4.8 / 7.1–8.8 | 1.1–1.2 | 48 + 0 | 0 (0) 0 | 10.7–13.1 (—) | 260–323 (102–123) | 99.9–107.1 (6–6.43) | 15.6–15.9 (0.93–0.95) | 0 | 95–98 | 4.3–6.14 |
| school · mini-mission | 59.9–60.2 | 50.5–51.8 | 16.6–16.7 / 19.3–19.8 / 20.8–21.2 | 3.6–4.8 / 7.3–8.5 | 1.1–1.2 | 47 + 0 | 1 (0) 51–53 | 11.6–11.7 (—) | 265–320 (108–127) | 98.4–100.7 (5.88–6.01) | 15.7–16 (0.94–0.95) | 1.4 | 95–97 | 5.33–7.05 |
| school · check-1x | 59.9–60.2 | 52.9–53.2 | 16.6–16.7 / 18.8–18.9 / 19.8–20.6 | 4.4–4.8 / 8.1–8.7 | 1.2–1.3 | 47 + 0 | 1 (0) 52–65 | 12.7 (—) | 311–337 (127–136) | 98.2–101.5 (5.87–6.04) | 16–16.1 (0.95–0.96) | 1.4 | 97–98 | 4.91–5.08 |
| school · check-4x | 59.9–60.2 | 42.2–46.7 | 16.6–16.7 / 21.4–23.7 / 80.6–85.9 | 6–7.1 / 10.8–12.9 | 1.3–1.4 | 49 + 0 | 20 (1) 316–332 | 33.2–33.5 (—) | 432–504 (102–116) | 57.6–62.8 (3.28–3.65) | 16.9–17.5 (0.98–1) | 1.4–1.5 | 97–102 | 5.39–6.26 |
| school · follow | 59.9–60.2 | 55.9 | 16.6–16.7 / 17.9 / 18.2–18.7 | 3.8–5.4 / 7.1–9.2 | 1–1.3 | 42 + 0 | 0 (0) 0 | 10.7–13 (—) | 263–357 (89–132) | 91–100.8 (5.45–6.04) | 15.6–16 (0.94–0.96) | 0 | 97–98 | 5.76–7.35 |
| school · teleop | 59.9–60.2 | 53.2–53.8 | 16.6–16.7 / 18.6–18.8 / 19.7–22.7 | 5.5–5.6 / 7.9 | 1.3 | 43 + 0 | 0 (0) 0 | 11.9 (—) | 355–366 (125–128) | 121–126.8 (7.2–7.6) | 16.1–16.3 (0.97) | 0 | 95–98 | 7.92–8.59 |
| school · switch | — | — | — / — / — | — / — | — | — + — | — (—) — | — (—) | — (—) | — (—) | — (—) | — | 97–99 | 4.92–9.17 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high · idle | 914–1060 | 118–123 | 590–608 | 420–431 | 551–573 | 648–665 → 682–698 | 708–723 | 708–723 | 203–221 (120–139) | 16 | 16 | 54.5 | — | — | 0 | 0 |
| gpu-high · drive-to-zone | 909–967 | 114–116 | 501–514 | 416–427 | 464–479 | 555–570 → 587–613 | 610–645 | 610–645 | 74–75 (74–75) | 16–17 | 16 | 49.1 | 77–87 | 9–18 | 0 | 0 |
| gpu-high · line-follow | 948–975 | 115–127 | 497–521 | 417–435 | 460–486 | 554–578 → 598–620 | 624–644 | 624–644 | 131–134 (80–84) | 15–17 | 16 | 54.5 | 68–87 | 10–19 | 0 | — |
| gpu-high · mini-mission | 911–966 | 114–116 | 492–514 | 410–425 | 454–479 | 546–571 → 587–612 | 611–645 | 611–645 | 88–141 (88–91) | 16–17 | 15 | 55.3 | 78–87 | 15–19 | 0 | — |
| gpu-high · check-1x | 908–964 | 113–115 | 505–511 | 418–423 | 469–475 | 562–569 → 603–609 | 627–630 | 627–630 | 92 (92) | 16–18 | 15 | 55.3 | — | — | 0 | — |
| gpu-high · check-4x | 965–1000 | 123–161 | 512–542 | 424–458 | 476–505 | 571–603 → 621–647 | 642–682 | 642–682 | 148–153 (96–99) | 17–18 | 15 | 55.3 | — | — | 0 | — |
| gpu-high · follow | 951–969 | 125–126 | 502–511 | 420–429 | 465–476 | 561–575 → 604–620 | 628–643 | 628–643 | 136–141 (85–90) | 16–18 | 16 | 54.5 | 85–87 | 11–19 | 0 | — |
| gpu-high · teleop | 957–961 | 125–127 | 498–507 | 418–423 | 462–470 | 555–564 → 601–610 | 635–642 | 635–642 | 134–135 (83) | 16–17 | 17 | 57.1 | — | — | 0 | — |
| gpu-high · switch | 908–964 | 120–125 | 501–515 | 419–426 | 466–481 | 560–577 → 605–620 | 627–645 | 627–645 | 88–135 (83–88) | 16–19 | 16 | 51.3 | — | — | 0 | — |
| ss-low-4x · idle | 3452–3563 | 322–385 | 2080–2187 | 641–725 | 2272–2384 | 2413–2518 → 2446–2553 | 2167–2280 | 3241–3350 | 1742–1828 (1263–1277) | 1437–1452 | 13 | 9.7 | — | — | 0 | 0 |
| ss-low-4x · drive-to-zone | 2111–2121 | 314–327 | 810–831 | 637–651 | 883–903 | 1140–1161 → 1172–1193 | 871–891 | 1744–1749 | 458–472 (202–205) | 135–144 | 13 | 7.8 | 249–268 | 25–26 | 0 | 0 |
| ss-low-4x · line-follow | 2068–2108 | 313–340 | 817–844 | 636–663 | 913–946 | 1147–1176 → 1179–1210 | 901–934 | 1755–1813 | 490–498 (201–210) | 161–167 | 13 | 9.7 | 258–271 | 27–28 | 0 | — |
| ss-low-4x · mini-mission | 2080–2115 | 316–331 | 818–851 | 639–658 | 963–1001 | 1149–1184 → 1179–1214 | 950–987 | 1716–1753 | 539–564 (204–212) | 209–216 | 12 | 9.9 | 256–270 | 27–28 | 0 | — |
| ss-low-4x · check-1x | 2077–2116 | 314–349 | 821–864 | 638–672 | 965–1060 | 1151–1197 → 1181–1228 | 952–998 | 1706–1750 | 539–556 (203–208) | 210–235 | 12 | 9.9 | — | — | 0 | — |
| ss-low-4x · check-4x | 2082–2097 | 319–329 | 831–846 | 648–657 | 975–997 | 1163–1181 → 1193–1211 | 962–983 | 1718–1733 | 541–562 (202–207) | 207–218 | 12 | 9.9 | — | — | 0 | — |
| ss-low-4x · follow | 2073–2092 | 320–329 | 821–841 | 642–655 | 920–940 | 1152–1171 → 1185–1204 | 907–927 | 1754–1777 | 496–501 (205–210) | 159–164 | 13 | 9.7 | 274–278 | 27–30 | 0 | — |
| ss-low-4x · teleop | 2114–2128 | 320–324 | 805–822 | 639–646 | 889–910 | 1134–1152 → 1173–1190 | 1605–1617 | 1764–1773 | 470–902 (207–426) | 146–154 | 13 | 10.4 | — | — | 0 | — |
| ss-low-4x · switch | 2071–2089 | 316–320 | 821–835 | 642–648 | 919–936 | 1151–1166 → 1183–1201 | 907–922 | 1770–1778 | 495–506 (205–209) | 164–168 | 13 | 8.5 | — | — | 0 | — |
| school · idle | 3821–3826 | 455–459 | 2410–2421 | 802–808 | 2569–2576 | 2745–2761 → 2789–2808 | 2541–2550 | 3612–3617 | 815–832 (310–314) | 242–246 | 13 | 9.7 | — | — | 0 | 0 |
| school · drive-to-zone | 2408–2445 | 451–454 | 1069–1077 | 798–801 | 1189–1194 | 1419–1423 → 1464–1471 | 1165–1174 | 2035–2073 | 708–711 (306–310) | 212–220 | 13 | 7.8 | 376–401 | 38–44 | 0 | 0 |
| school · line-follow | 2375–2439 | 454–494 | 1081–1144 | 803–839 | 1235–1310 | 1426–1497 → 1472–1544 | 1209–1285 | 2069–2115 | 747–809 (307–331) | 251–267 | 13 | 9.7 | 386–408 | 42 | 0 | — |
| school · mini-mission | 2396–2515 | 449–473 | 1080–1158 | 794–827 | 1302–1390 | 1456–1543 → 1498–1587 | 1277–1367 | 2027–2147 | 815–870 (306–322) | 320–336 | 12 | 9.9 | 380–395 | 41–43 | 0 | — |
| school · check-1x | 2417–2539 | 461–485 | 1093–1176 | 809–841 | 1318–1413 | 1466–1572 → 1510–1616 | 1291–1387 | 2047–2179 | 815–883 (307–333) | 315–343 | 12 | 9.9 | — | — | 0 | — |
| school · check-4x | 2549–2575 | 497–515 | 1202–1210 | 863–873 | 1437–1452 | 1587–1605 → 1629–1650 | 1407–1424 | 2196–2208 | 894–961 (338–342) | 332–348 | 12 | 9.9 | — | — | 0 | — |
| school · follow | 2381–2469 | 459–476 | 1081–1158 | 805–825 | 1235–1324 | 1426–1504 → 1473–1551 | 1209–1296 | 2082–2169 | 750–850 (310–324) | 250–273 | 13 | 9.7 | 420–450 | 41–44 | 0 | — |
| school · teleop | 2500–2544 | 489–511 | 1116–1161 | 839–861 | 1257–1308 | 1464–1515 → 1520–1567 | 1987–2031 | 2146–2191 | 1238–1302 (450–475) | 238–259 | 13 | 10.4 | — | — | 0 | — |
| school · switch | 2461–3048 | 485–512 | 1137–1317 | 837–868 | 1292–1527 | 1488–1778 → 1534–1833 | 1270–1484 | 2148–2913 | 782–956 (329–341) | 252–333 | 13 | 8.5 | — | — | 0 | — |

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| gpu-high · idle | 90 (78, 53) | 5 | 62 Standard, 10 Basic, 3 Sprite, 4 Physical | 97509 | 156682 | 16 | 54.5: 22.4 + 3.7 + 16 + 12.5 | MeshStandardMaterial 1360×1120 canvas aniso 8; PMREM.cubeUv 768×1024 other; birch_face 2048×256 ImageBitmap aniso 8; MeshStandardMaterial 680×560 canvas |
| ss-low-4x · idle | 52 (40, 0) | 5 | 22 Lambert, 10 Basic, 3 Sprite | 51046 | 36370 | 13 | 9.7: 4.8 + 2.3 + 0 + 2.5 | MeshLambertMaterial 850×700 canvas aniso 8; birch_face 1024×128 ImageBitmap; walnut 256×256 ImageBitmap; pcb_teal 200×256 ImageBitmap |
| school · idle | 52 (40, 0) | 5 | 22 Lambert, 10 Basic, 3 Sprite | 51046 | 36370 | 13 | 9.7: 4.8 + 2.3 + 0 + 2.5 | MeshLambertMaterial 850×700 canvas aniso 8; birch_face 1024×128 ImageBitmap; walnut 256×256 ImageBitmap; pcb_teal 200×256 ImageBitmap |

## Switches (growth from the first switch to the last; the scenario switches load the lesson frame again, so its contexts and renderer are new)

| profile | repeat | kind | switches | heap KB | live contexts | geometries | textures | programs | documents | listeners |
|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high | 1 | 2D ↔ 3D | 20 | 4033 | 0 | 0 | 0 | 0 | 0 | 19 |
| gpu-high | 1 | tier high ↔ low (sampled every second) | 10 | 1546 | 0 | 0 | 0 | 0 | 0 | 18 |
| gpu-high | 1 | scenario | 10 | 60 | 0 | 12 | -1 | 1 | 0 | 0 |
| gpu-high | 2 | 2D ↔ 3D | 20 | 4030 | 0 | 0 | 0 | 0 | 0 | 19 |
| gpu-high | 2 | tier high ↔ low (sampled every second) | 10 | 1589 | 0 | 0 | 0 | 0 | 0 | 18 |
| gpu-high | 2 | scenario | 10 | 57 | 0 | 12 | -1 | 1 | 0 | 0 |
| gpu-high | 3 | 2D ↔ 3D | 20 | 4014 | 0 | 0 | 0 | 0 | 0 | 19 |
| gpu-high | 3 | tier high ↔ low (sampled every second) | 10 | 1559 | 0 | 0 | 0 | 0 | 0 | 18 |
| gpu-high | 3 | scenario | 10 | 60 | 0 | 12 | -1 | 1 | 0 | 0 |
| ss-low-4x | 1 | 2D ↔ 3D | 20 | 3612 | 0 | 0 | 0 | 0 | 0 | 19 |
| ss-low-4x | 1 | tier high ↔ low (sampled every second) | 10 | 1612 | 0 | 0 | 0 | 0 | 0 | 18 |
| ss-low-4x | 1 | scenario | 10 | 8 | 0 | 8 | -1 | 1 | 0 | 0 |
| ss-low-4x | 2 | 2D ↔ 3D | 20 | 3569 | 0 | 0 | 0 | 0 | 0 | 19 |
| ss-low-4x | 2 | tier high ↔ low (sampled every second) | 10 | 1587 | 0 | 0 | 0 | 0 | 0 | 18 |
| ss-low-4x | 2 | scenario | 10 | -14 | 0 | 8 | -1 | 1 | 0 | 0 |
| ss-low-4x | 3 | 2D ↔ 3D | 20 | 3633 | 0 | 0 | 0 | 0 | 0 | 19 |
| ss-low-4x | 3 | tier high ↔ low (sampled every second) | 10 | 1577 | 0 | 0 | 0 | 0 | 0 | 18 |
| ss-low-4x | 3 | scenario | 10 | 30 | 0 | 8 | -1 | 1 | 0 | 0 |
| school | 1 | 2D ↔ 3D | 20 | 3536 | 0 | 0 | 0 | 0 | 0 | 19 |
| school | 1 | tier high ↔ low (sampled every second) | 10 | 1636 | 0 | 0 | 0 | 0 | 0 | 18 |
| school | 1 | scenario | 10 | 8 | 0 | 8 | -1 | 1 | 0 | 0 |
| school | 2 | 2D ↔ 3D | 20 | 3609 | 0 | 0 | 0 | 0 | 0 | 19 |
| school | 2 | tier high ↔ low (sampled every second) | 10 | 1632 | 0 | 0 | 0 | 0 | 0 | 18 |
| school | 2 | scenario | 10 | -15 | 0 | 8 | -1 | 1 | 0 | 0 |
| school | 3 | 2D ↔ 3D | 20 | 3618 | 0 | 0 | 0 | 0 | 0 | 19 |
| school | 3 | tier high ↔ low (sampled every second) | 10 | 1634 | 0 | 0 | 0 | 0 | 0 | 18 |
| school | 3 | scenario | 10 | 11 | 0 | 8 | -1 | 1 | 0 | 0 |

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
