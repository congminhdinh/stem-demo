# bench:robot3d — 2026-10-25T14:35:01.005Z — fps

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 83aec85. Repeats 3, window 8 s, soak 10 min, switches 20. 1-minute load average from 3.47–22.9 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 370 kB | ≤ 600 kB | ok | 1 | robot plan §5 |
| budget | gpu-high: median fps of every run | 59.9 fps | ≥ 50 fps | ok | 24 | the plan’s ≥ 50 fps mid-range |
| budget | ss-low-4x: p5 fps of every run | 15.2 fps | ≥ 30 fps | MISSED | 24 | the plan’s ≥ 30 fps low tier at 4× |
| budget | Run → moving (warm), every profile | 82 ms | ≤ 300 ms | ok | 48 | click to the first render with the robot moved |
| budget | draws per second at rest | 0 /s | ≤ 0 /s | ok | 103 | idle before a run, a parked robot, after an orbit settles |
| target | school: p95 frame time running at 1× | 79.8 ms | ≤ 33 ms | not met | 16 | every run scenario, low tier |
| target | school: p95 frame time running at 4× | 112.6 ms | ≤ 33 ms | not met | 3 | sim speed 4× and Kiểm tra 4× |
| target | school: long tasks > 100 ms during a run | 3  | ≤ 0  | not met | 19 | in the measuring window |
| target | school: first frame | 7519 ms | ≤ 2500 ms | not met | 22 | lesson page navigation → the scene drawn |
| target | gpu-high: GPU resources growth over the 2D↔3D switches | 0  | ≤ 0  | ok | 1 | live WebGL contexts, geometries, textures |
| target | gpu-high: GPU resources growth over the 2D↔3D switches | 0  | ≤ 0  | ok | 1 | live WebGL contexts, geometries, textures |
| target | gpu-high: GPU resources growth over the 2D↔3D switches | 0  | ≤ 0  | ok | 1 | live WebGL contexts, geometries, textures |
| target | gpu-high: p95 frame time running | 17.6 ms | ≤ 20 ms | ok | 24 | every run scenario |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | load |
|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high · idle | 59.9 | 56.8–57.1 | 16.7 / 17.5–17.6 / 17.8 | 1 / 1.4–2.1 | 0.7–0.8 | 77 + 51 | 0 (0) 0 | — (—) | 89–96 (61–62) | 7.5–10.08 |
| gpu-high · drive-to-zone | 59.9 | 56.8–57.8 | 16.7 / 17.3–17.6 / 17.6–18.1 | 1.5–1.7 / 2.6–3.4 | 0.7 | 77 + 49 | 0 (0) 0 | 10–10.2 (—) | 112–123 (58–65) | 6.3–7 |
| gpu-high · line-follow | 60.2 | 57.1–57.5 | 16.6 / 17.4–17.5 / 17.7–18 | 1.7–1.8 / 2.9–3.5 | 0.7 | 80 + 51 | 0 (0) 0 | 10.7 (—) | 123–130 (58–64) | 7.92–12.53 |
| gpu-high · mini-mission | 59.9 | 57.1–58.1 | 16.7 / 17.2–17.5 / 17.4–17.9 | 1.6 / 2.4–2.6 | 0.6–0.7 | 79 + 54 | 0 (0) 0 | 11.5–11.7 (—) | 108–111 (53–54) | 7.72–9.06 |
| gpu-high · check-1x | 59.9–60.2 | 56.8–57.1 | 16.6–16.7 / 17.5–17.6 / 17.9–18.2 | 1.5–1.8 / 2.3–2.9 | 0.6–0.7 | 79 + 54 | 0 (0) 0 | 12.7 (—) | 108–124 (53–61) | 6.87–7.54 |
| gpu-high · check-4x | 59.9 | 56.2–57.1 | 16.7 / 17.5–17.8 / 22.1–29.6 | 1.9–2 / 3.2–3.5 | 0.7 | 81 + 54 | 1 (0–1) 89–107 | 34.3–34.4 (—) | 142–148 (35–37) | 11.27–13.52 |
| gpu-high · follow | 59.9 | 57.1–57.5 | 16.7 / 17.4–17.5 / 17.6–17.7 | 1.7–2.6 / 3.8–4.4 | 0.7–1.3 | 73 + 51 | 0 (0) 0 | 10.6–10.7 (—) | 132–161 (68–87) | 7.8–11.56 |
| gpu-high · teleop | 59.9 | 56.8–57.8 | 16.7 / 17.3–17.6 / 17.9–18 | 1.7–1.9 / 3.1–3.8 | 0.7–0.8 | 80 + 54 | 0 (0) 0 | 11.9–12.1 (—) | 119–147 (57–74) | 5.22–6.66 |
| gpu-high · pins | 59.9–60.2 | 56.8–57.1 | 16.6–16.7 / 17.5–17.6 / 17.7–17.9 | 1.7–1.8 / 2.8–3.1 | 0.7 | 80 + 51 | 0 (0) 0 | 20.7 (—) | 128–140 (58–64) | 5.27–5.43 |
| gpu-high · cpp | 59.9 | 57.1–57.5 | 16.7 / 17.4–17.5 / 17.7–17.9 | 1.6–1.7 / 2.3–4 | 0.7 | 80 + 51 | 0 (0) 0 | 11.5 (—) | 110–135 (53–67) | 4.47–4.91 |
| gpu-high · switch | — | — | — / — / — | — / — | — | — + — | — (—) — | — (—) | — (—) | 3.47–5.65 |
| ss-low-4x · idle | 59.9–60.6 | 54.9–55.2 | 16.5–16.7 / 18.1–18.2 / 20.3–25.3 | 2.3–2.6 / 3.5–3.9 | 1.2–1.4 | 40 + 0 | 0 (0) 0 | — (—) | 218–240 (117–132) | 5.15–5.67 |
| ss-low-4x · drive-to-zone | 56.5–58.8 | 20.4–43.5 | 17–17.7 / 23–49.1 / 28.5–86.4 | 5–5.3 / 8.3–9.4 | 1.2–1.3 | 38 + 0 | 0 (0) 0 | 10–10.2 (—) | 279–349 (85–121) | 5.52–8.54 |
| ss-low-4x · line-follow | 59.9–60.2 | 46.7–54.3 | 16.6–16.7 / 18.4–21.4 / 19–50.6 | 4.6–5.6 / 7.3–9.4 | 1.1–1.4 | 44 + 0 | 0 (0) 0 | 10.6–10.7 (—) | 308–367 (102–121) | 10.87–13.13 |
| ss-low-4x · mini-mission | 60.2 | 40.3–53.2 | 16.6 / 18.8–24.8 / 29.9–63.2 | 4.7–5.8 / 8.1–10.7 | 1.1–1.4 | 43 + 0 | 1 (0) 54–69 | 11.6–12.1 (—) | 323–391 (116–136) | 10.16–10.77 |
| ss-low-4x · check-1x | 60.2 | 36.8–51.3 | 16.6 / 19.5–27.2 / 40.8–61.1 | 5.2–5.9 / 8.8–9.9 | 1.3–1.4 | 43 + 0 | 1–2 (0) 70–80 | 12.1–12.5 (—) | 352–378 (128–138) | 11.19–11.92 |
| ss-low-4x · check-4x | 60.2 | 16.6–20.1 | 16.6 / 49.7–60.2 / 96.4–116.1 | 7.3–7.6 / 12.5–12.6 | 1.3–1.4 | 45 + 0 | 22–23 (1) 312–330 | 31.9–32.6 (—) | 506–513 (109–114) | 8.98–12.32 |
| ss-low-4x · follow | 49.3–59.9 | 16.8–55.9 | 16.7–20.3 / 17.9–59.4 / 22.4–76.8 | 5.1–6.6 / 8.4–13.7 | 1.1–1.5 | 39 + 0 | 0 (0) 0 | 10.6–12.9 (—) | 331–367 (101–115) | 10.2–14.21 |
| ss-low-4x · teleop | 33.2–37 | 22.1–23.6 | 27–30.1 / 42.3–45.2 / 50.9–72.1 | 7.4–7.5 / 10.8–11.3 | 1.3–1.5 | 40 + 0 | 0 (0) 0 | 12 (—) | 270–297 (72–83) | 17.97–19.6 |
| ss-low-4x · pins | 40.2–60.2 | 15.2–53.2 | 16.6–24.9 / 18.8–65.8 / 19.5–78.1 | 5.3–9 / 10.8–16.3 | 1.2–1.5 | 42–44 + 0 | 0 (0) 0 | 20.5–21.7 (—) | 393–462 (113–151) | 15.82–21.08 |
| ss-low-4x · cpp | 49.8–59.5 | 28.2–37.3 | 16.8–20.1 / 26.8–35.5 / 32.9–55.9 | 5.8–6.6 / 9.6–11.4 | 1.3–1.4 | 42–44 + 0 | 0 (0) 0 | 12.1–14 (—) | 345–377 (102–124) | 16.03–18.93 |
| school · idle | 41–46.3 | 29.2–33.9 | 21.6–24.4 / 29.5–34.3 / 33.2–49.8 | 3.5–4.2 / 6.1–6.9 | 2–2.4 | 40 + 0 | 0 (0) 0 | — (—) | 275–315 (141–158) | 17.73–19.85 |
| school · drive-to-zone | 48.5–58.1 | 31.6–37.9 | 17.2–20.6 / 26.4–31.6 / 31.3–52.1 | 7.2–8.5 / 14–14.3 | 1.8–2 | 38 + 0 | 0 (0) 0 | 10.2 (—) | 433–455 (142–155) | 16.18–17.84 |
| school · line-follow | 43.3–56.2 | 21.6–27.7 | 17.8–23.1 / 36.1–46.4 / 87.7–90 | 9.6–10.5 / 19.1–19.5 | 2.1 | 44 + 0 | 0 (0) 0 | 10.2–11.6 (—) | 465–524 (136–157) | 16.72–19.79 |
| school · mini-mission | 40.5–56.5 | 13.5–28.8 | 17.7–24.7 / 34.7–74.2 / 89.6–103.4 | 8.7–11.4 / 17.3–21.9 | 2.1–2.3 | 45 + 0 | 1 (1) 102–106 | 10.6–11.2 (—) | 473–525 (149–177) | 19.58–20.04 |
| school · check-1x | 46.7–55.9 | 16.7–21.2 | 17.9–21.4 / 47.2–60 / 102.2–114.1 | 9.2–9.8 / 18.1–20.1 | 2.1–2.2 | 43 + 0 | 2 (1–2) 103–114 | 11.6–12.2 (—) | 470–525 (166–186) | 19.95–20.42 |
| school · check-4x | 44.1–59.5 | 8.9–20 | 16.8–22.7 / 50–112.6 / 141.5–218.5 | 10.6–12.1 / 19.2–21.2 | 1.9–2.1 | 45 + 0 | 26–48 (2–3) 494–540 | 25–30.4 (—) | 671–719 (157–177) | 14.23–20.96 |
| school · follow | 38.9–56.8 | 12.5–23 | 17.6–25.7 / 43.5–79.8 / 79.9–122.1 | 10.1–12.5 / 19.2–24.9 | 2.1–2.2 | 37–39 + 0 | 0 (0) 0 | 10.4–10.9 (—) | 458–502 (128–155) | 18.19–22 |
| school · teleop | 41 | 24.6 | 24.4 / 40.7 / 61.3 | 11 / 18 | 2.2 | 40 + 0 | 0 (0) 0 | 11.9 (—) | 451 (127) | 22.9 |

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high · idle | 950–1201 | 186–214 | 699–749 | 474–506 | 669–730 | 789–849 → 833–893 | 872–944 | 872–944 | 379–422 (173–191) | 24–32 | 15 | 54.4 | — | — | 0 | 0 |
| gpu-high · drive-to-zone | 946–1036 | 180–273 | 566–669 | 471–566 | 536–656 | 649–793 → 695–887 | 743–929 | 743–929 | 187–322 (110–161) | 25–40 | 15 | 49 | 101–128 | 9–13 | 0 | 0 |
| gpu-high · line-follow | 946–1731 | 178–303 | 565–698 | 471–582 | 538–750 | 651–1110 → 716–1207 | 739–769 | 747–1266 | 201–228 (110–125) | 26–103 | 15 | 54.4 | 103–192 | 14 | 0 | — |
| gpu-high · mini-mission | 948–950 | 181–184 | 567–571 | 473–476 | 536–544 | 649–655 → 697–716 | 724–748 | 724–748 | 212–215 (136–139) | 23–25 | 14 | 55.2 | 104–114 | 10–13 | 0 | — |
| gpu-high · check-1x | 956–1079 | 188–249 | 575–631 | 482–531 | 547–610 | 659–744 → 717–826 | 759–866 | 759–866 | 215–344 (137–193) | 24–32 | 14 | 55.2 | — | — | 0 | — |
| gpu-high · check-4x | 1055–1126 | 231–296 | 604–679 | 507–573 | 579–658 | 711–795 → 823–908 | 872–952 | 872–952 | 268–361 (178–193) | 28–34 | 14 | 55.2 | — | — | 0 | — |
| gpu-high · follow | 944–948 | 178–181 | 561–566 | 467–471 | 532–536 | 646–651 → 709–716 | 745–750 | 745–750 | 195–198 (119–123) | 23–25 | 15 | 54.4 | 116–118 | 10 | 0 | — |
| gpu-high · teleop | 946–1058 | 180–299 | 557–668 | 468–577 | 528–641 | 640–756 → 703–842 | 745–887 | 745–887 | 195–237 (119–126) | 23–27 | 16 | 57 | — | — | 0 | — |
| gpu-high · pins | 945–948 | 177–180 | 560–565 | 467–472 | 531–535 | 644–650 → 708–714 | 743–744 | 743–744 | 195–197 (119–122) | 24–25 | 15 | 54.4 | 106–126 | 11–17 | 0 | — |
| gpu-high · cpp | 951–997 | 186–223 | 569–606 | 476–513 | 538–576 | 653–696 → 726–761 | 757–802 | 757–802 | 198–206 (121–127) | 24–25 | 15 | 54.4 | 99–114 | 10–13 | 0 | — |
| gpu-high · switch | 946–956 | 183–191 | 568–572 | 475–478 | 539–543 | 651–656 → 714–720 | 757–760 | 757–760 | 197–199 (120–122) | 23–24 | 15 | 51.2 | — | — | 0 | — |
| ss-low-4x · idle | 4910–4949 | 506–538 | 3219–3269 | 853–880 | 3350–3398 | 3554–3604 → 3604–3655 | 3324–3371 | 4843–4892 | 905–927 (328–342) | 219–229 | 11 | 9.6 | — | — | 0 | 0 |
| ss-low-4x · drive-to-zone | 2744–2805 | 504–536 | 1166–1200 | 849–867 | 1256–1300 | 1501–1536 → 1552–1586 | 1236–1269 | 2388–2498 | 731–757 (324–333) | 184–200 | 11 | 7.7 | 392–416 | 38–43 | 0 | 0 |
| ss-low-4x · line-follow | 2620–2695 | 505–526 | 1150–1195 | 842–863 | 1276–1337 | 1486–1537 → 1536–1593 | 1253–1308 | 2337–2465 | 754–814 (318–341) | 218–235 | 11 | 9.6 | 396–400 | 39–41 | 0 | — |
| ss-low-4x · mini-mission | 2565–2646 | 487–503 | 1109–1165 | 824–839 | 1311–1375 | 1435–1507 → 1487–1559 | 1284–1342 | 2216–2301 | 829–864 (318–329) | 299–302 | 10 | 9.8 | 379–417 | 41–42 | 0 | — |
| ss-low-4x · check-1x | 2616–2746 | 490–508 | 1143–1232 | 828–872 | 1345–1447 | 1476–1576 → 1529–1628 | 1322–1414 | 2262–2413 | 841–950 (323–329) | 296–314 | 10 | 9.8 | — | — | 0 | — |
| ss-low-4x · check-4x | 2609–2794 | 486–574 | 1150–1289 | 830–922 | 1352–1509 | 1478–1646 → 1526–1696 | 1328–1475 | 2265–2443 | 833–984 (318–350) | 303–320 | 10 | 9.8 | — | — | 0 | — |
| ss-low-4x · follow | 2596–2910 | 493–681 | 1110–1420 | 832–1056 | 1245–1555 | 1446–1755 → 1496–1809 | 1219–1526 | 2356–2629 | 768–958 (323–411) | 223–233 | 11 | 9.6 | 442–567 | 40–50 | 0 | — |
| ss-low-4x · teleop | 3219–3789 | 644–683 | 1336–1423 | 988–1045 | 1488–1577 | 1680–1768 → 1743–1829 | 1455–1543 | 2957–3692 | 943–1006 (396–428) | 257–267 | 12 | 10.3 | — | — | 0 | — |
| ss-low-4x · pins | 2687–3340 | 542–655 | 1201–1437 | 885–1005 | 1334–1608 | 1537–1836 → 1587–1906 | 1305–1570 | 2406–3223 | 783–1026 (337–394) | 225–288 | 11 | 9.6 | 397–442 | 47–51 | 0 | — |
| ss-low-4x · cpp | 2685–3261 | 528–642 | 1185–1408 | 864–988 | 1318–1583 | 1519–1755 → 1574–1820 | 1290–1543 | 2413–3072 | 799–1014 (344–411) | 225–293 | 11 | 9.6 | 458–502 | 47–59 | 0 | — |
| school · idle | 5953–7519 | 895–1046 | 4115–5295 | 1438–1724 | 4316–5539 | 4543–5830 → 4616–5925 | 4274–5490 | 5905–7458 | 3690–4767 (2214–3074) | 2399–3280 | 11 | 9.6 | — | — | 0 | 0 |
| school · drive-to-zone | 3340–4101 | 730–932 | 1679–2196 | 1197–1588 | 1826–2375 | 2034–2597 → 2108–2686 | 1788–2328 | 2991–3837 | 1260–1736 (512–628) | 300–379 | 11 | 7.7 | 597–668 | 61–78 | 0 | 0 |
| school · line-follow | 3240–3914 | 706–995 | 1626–2055 | 1176–1548 | 1831–2291 | 2026–2502 → 2100–2594 | 1792–2252 | 3020–3772 | 1267–1633 (488–666) | 360–424 | 11 | 9.6 | 628–743 | 58–77 | 0 | — |
| school · mini-mission | 3495–4151 | 783–956 | 1752–2063 | 1272–1519 | 2051–2427 | 2247–2665 → 2317–2754 | 2015–2381 | 2978–3897 | 1472–1813 (527–650) | 455–547 | 10 | 9.8 | 612–756 | 64–77 | 0 | — |
| school · check-1x | 3899–4066 | 883–970 | 1957–2082 | 1432–1530 | 2313–2455 | 2537–2695 → 2618–2782 | 2267–2404 | 3379–3765 | 1679–1799 (597–645) | 532–561 | 10 | 9.8 | — | — | 0 | — |
| school · check-4x | 3278–4263 | 708–1010 | 1617–2185 | 1170–1614 | 1925–2594 | 2112–2852 → 2180–2945 | 1885–2533 | 2927–3957 | 1367–1906 (490–643) | 459–586 | 10 | 9.8 | — | — | 0 | — |
| school · follow | 3777–4175 | 919–972 | 2070–2122 | 1481–1579 | 2309–2364 | 2543–2631 → 2627–2724 | 2265–2317 | 3502–3934 | 1658–1673 (631–668) | 421–429 | 11 | 9.6 | 646–813 | 60–82 | 0 | — |
| school · teleop | 3768 | 744 | 1634 | 1214 | 1818 | 2044 → 2141 | 1783 | 3376 | 1240 (510) | 342 | 12 | 10.3 | — | — | 0 | — |

## Scene inventory (the first fps cell of each profile)

| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |
|---|---|---|---|---|---|---|---|---|
| gpu-high · idle | 87 (77, 53) | 4 | 62 Standard, 8 Basic, 2 Sprite, 4 Physical | 97102 | 156672 | 15 | 54.4: 22.3 + 3.6 + 16 + 12.5 | MeshStandardMaterial 1360×1120 canvas aniso 8; PMREM.cubeUv 768×1024 other; birch_face 2048×256 ImageBitmap aniso 8; MeshStandardMaterial 680×560 canvas |
| ss-low-4x · idle | 49 (39, 0) | 4 | 22 Lambert, 8 Basic, 2 Sprite | 50664 | 36360 | 11 | 9.6: 4.7 + 2.3 + 0 + 2.5 | MeshLambertMaterial 850×700 canvas aniso 8; birch_face 1024×128 ImageBitmap; walnut 256×256 ImageBitmap; pcb_teal 200×256 ImageBitmap |
| school · idle | 49 (39, 0) | 4 | 22 Lambert, 8 Basic, 2 Sprite | 50664 | 36360 | 11 | 9.6: 4.7 + 2.3 + 0 + 2.5 | MeshLambertMaterial 850×700 canvas aniso 8; birch_face 1024×128 ImageBitmap; walnut 256×256 ImageBitmap; pcb_teal 200×256 ImageBitmap |

## Switches (growth from the first switch to the last; the scenario switches load the lesson frame again, so its contexts and renderer are new)

| profile | repeat | kind | switches | heap KB | live contexts | geometries | textures | programs | documents | listeners |
|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high | 1 | 2D ↔ 3D | 20 | 3954 | 0 | 0 | 0 | 0 | 0 | 19 |
| gpu-high | 1 | tier high ↔ low (sampled every second) | 10 | 1623 | 0 | 0 | 0 | 0 | 0 | 18 |
| gpu-high | 1 | scenario | 10 | 131 | 0 | 12 | -1 | 1 | 0 | 0 |
| gpu-high | 2 | 2D ↔ 3D | 20 | 3955 | 0 | 0 | 0 | 0 | 0 | 19 |
| gpu-high | 2 | tier high ↔ low (sampled every second) | 10 | 1623 | 0 | 0 | 0 | 0 | 0 | 18 |
| gpu-high | 2 | scenario | 10 | 126 | 0 | 12 | -1 | 1 | 0 | 0 |
| gpu-high | 3 | 2D ↔ 3D | 20 | 3956 | 0 | 0 | 0 | 0 | 0 | 19 |
| gpu-high | 3 | tier high ↔ low (sampled every second) | 10 | 1595 | 0 | 0 | 0 | 0 | 0 | 18 |
| gpu-high | 3 | scenario | 10 | 129 | 0 | 12 | -1 | 1 | 0 | 0 |

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

## Cells that failed

- school · teleop (fps #2): frame.evaluate: Target page, context or browser has been closed
- school · teleop (fps #3): browser.newContext: Target page, context or browser has been closed
- school · pins (fps #1): browser.newContext: Target page, context or browser has been closed
- school · pins (fps #2): browser.newContext: Target page, context or browser has been closed
- school · pins (fps #3): browser.newContext: Target page, context or browser has been closed
- school · cpp (fps #1): browser.newContext: Target page, context or browser has been closed
- school · cpp (fps #2): browser.newContext: Target page, context or browser has been closed
- school · cpp (fps #3): browser.newContext: Target page, context or browser has been closed
- school · switch (fps #1): browser.newContext: Target page, context or browser has been closed
- school · switch (fps #2): browser.newContext: Target page, context or browser has been closed
- school · switch (fps #3): browser.newContext: Target page, context or browser has been closed
- gpu-high-sim4x · line-follow (fps #1): cdpSession.send: Target page, context or browser has been closed
- gpu-high-sim4x · line-follow (fps #2): browser.newContext: Target page, context or browser has been closed
- gpu-high-sim4x · line-follow (fps #3): browser.newContext: Target page, context or browser has been closed
- gpu-high-sim4x · mini-mission (fps #1): browser.newContext: Target page, context or browser has been closed
- gpu-high-sim4x · mini-mission (fps #2): browser.newContext: Target page, context or browser has been closed
- gpu-high-sim4x · mini-mission (fps #3): browser.newContext: Target page, context or browser has been closed
- ss-low-4x-sim4x · line-follow (fps #1): page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5301/lesson?lab=http%3A%2F%2Flocalhost%3A5300%2F%3Fembed%3D1%26lab%3Drobot%26template%3Drb-line-follow%26origin%3Dhttp%253A%252F%252Flocalhost%253A5301&sandbox=allow-scripts%20allow-same-origin%20allow-downloads
- ss-low-4x-sim4x · line-follow (fps #2): page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5301/lesson?lab=http%3A%2F%2Flocalhost%3A5300%2F%3Fembed%3D1%26lab%3Drobot%26template%3Drb-line-follow%26origin%3Dhttp%253A%252F%252Flocalhost%253A5301&sandbox=allow-scripts%20allow-same-origin%20allow-downloads
- ss-low-4x-sim4x · line-follow (fps #3): page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5301/lesson?lab=http%3A%2F%2Flocalhost%3A5300%2F%3Fembed%3D1%26lab%3Drobot%26template%3Drb-line-follow%26origin%3Dhttp%253A%252F%252Flocalhost%253A5301&sandbox=allow-scripts%20allow-same-origin%20allow-downloads
- ss-low-4x-sim4x · mini-mission (fps #1): page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5301/lesson?lab=http%3A%2F%2Flocalhost%3A5300%2F%3Fembed%3D1%26lab%3Drobot%26template%3Drb-mini-mission%26origin%3Dhttp%253A%252F%252Flocalhost%253A5301&sandbox=allow-scripts%20allow-same-origin%20allow-downloads
- ss-low-4x-sim4x · mini-mission (fps #2): page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5301/lesson?lab=http%3A%2F%2Flocalhost%3A5300%2F%3Fembed%3D1%26lab%3Drobot%26template%3Drb-mini-mission%26origin%3Dhttp%253A%252F%252Flocalhost%253A5301&sandbox=allow-scripts%20allow-same-origin%20allow-downloads
- ss-low-4x-sim4x · mini-mission (fps #3): page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5301/lesson?lab=http%3A%2F%2Flocalhost%3A5300%2F%3Fembed%3D1%26lab%3Drobot%26template%3Drb-mini-mission%26origin%3Dhttp%253A%252F%252Flocalhost%253A5301&sandbox=allow-scripts%20allow-same-origin%20allow-downloads
- school-sim4x · line-follow (fps #1): page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5301/lesson?lab=http%3A%2F%2Flocalhost%3A5300%2F%3Fembed%3D1%26lab%3Drobot%26template%3Drb-line-follow%26origin%3Dhttp%253A%252F%252Flocalhost%253A5301&sandbox=allow-scripts%20allow-same-origin%20allow-downloads
- school-sim4x · line-follow (fps #2): page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5301/lesson?lab=http%3A%2F%2Flocalhost%3A5300%2F%3Fembed%3D1%26lab%3Drobot%26template%3Drb-line-follow%26origin%3Dhttp%253A%252F%252Flocalhost%253A5301&sandbox=allow-scripts%20allow-same-origin%20allow-downloads
- school-sim4x · line-follow (fps #3): page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5301/lesson?lab=http%3A%2F%2Flocalhost%3A5300%2F%3Fembed%3D1%26lab%3Drobot%26template%3Drb-line-follow%26origin%3Dhttp%253A%252F%252Flocalhost%253A5301&sandbox=allow-scripts%20allow-same-origin%20allow-downloads
- school-sim4x · mini-mission (fps #1): page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5301/lesson?lab=http%3A%2F%2Flocalhost%3A5300%2F%3Fembed%3D1%26lab%3Drobot%26template%3Drb-mini-mission%26origin%3Dhttp%253A%252F%252Flocalhost%253A5301&sandbox=allow-scripts%20allow-same-origin%20allow-downloads
- school-sim4x · mini-mission (fps #2): page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5301/lesson?lab=http%3A%2F%2Flocalhost%3A5300%2F%3Fembed%3D1%26lab%3Drobot%26template%3Drb-mini-mission%26origin%3Dhttp%253A%252F%252Flocalhost%253A5301&sandbox=allow-scripts%20allow-same-origin%20allow-downloads
- school-sim4x · mini-mission (fps #3): page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5301/lesson?lab=http%3A%2F%2Flocalhost%3A5300%2F%3Fembed%3D1%26lab%3Drobot%26template%3Drb-mini-mission%26origin%3Dhttp%253A%252F%252Flocalhost%253A5301&sandbox=allow-scripts%20allow-same-origin%20allow-downloads
