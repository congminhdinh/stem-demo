# bench:robot3d — 2026-10-25T16:16:27.621Z — final-ss-profile

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node v24.22.1, Chromium 153.0.8010.12.
Commit 7de18d0. Repeats 3, window 8 s, soak 10 min, switches 20. 1-minute load average from 7.52–19.44 at the cells' start.

## Budgets and targets

| kind | measure | worst | limit | result | n | detail |
|---|---|---|---|---|---|---|
| budget | 3D chunk RobotLab-*.js, gzip -6 | 370 kB | ≤ 600 kB | ok | 1 | robot plan §5 |

## Frames (fps pass): ranges over the repeats

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

## Loading and rest (fps pass)

On the lesson page's clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).

| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

## Where the main thread goes (profile pass, ms per animation frame, ranges over the repeats)

| profile · scenario | busy | sim | render (shadow map) | React | Blockly | scene callbacks | GC | browser (style, layout, paint, GL) | alloc/frame KB | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ss-low-4x · line-follow | 4.65–5.3 | 2.22–2.53 | 0.95–1 (0) | 0.23–0.25 | 0–0.01 | 0.27–0.36 | 0.03–0.04 | 0.85–0.99 | 139.7–144.2 | 64–67 | 11.06–17.11 |
| ss-low-4x · mini-mission | 4.86–5.49 | 2.01–2.33 | 0.9–0.97 (0) | 0.25–0.27 | 0–0.01 | 0.71–0.74 | 0.05 | 0.84–1.04 | 249.1–254.3 | 64–66 | 18.04–19.44 |
| ss-low-4x · check-4x | 7.72–8.7 | 3.59–3.91 | 0.27–0.31 (0) | 0.5–0.53 | 0.01 | 1.86–2.16 | 0.15–0.18 | 1.22–1.38 | 777.5–845.1 | 65–67 | 15.39–18.18 |
| ss-low-4x · follow | 4.5–4.71 | 2.05–2.2 | 0.82–0.96 (0) | 0.19–0.28 | 0–0.01 | 0.33–0.36 | 0.05–0.07 | 0.76–0.88 | 149–151.9 | 64–65 | 12.76–15.3 |
| ss-low-4x · teleop | 4.76–4.88 | 1.83–1.89 | 0.9–0.98 (0) | 0.15–0.17 | 0 | 0.31–0.36 | 0.05–0.07 | 1.21–1.25 | 128.9–130.6 | 64–66 | 17.12–17.83 |
| ss-low-4x · pins | 5.51–5.63 | 2.23–2.27 | 0.95–1.02 (0) | 0.45–0.55 | 0.03–0.04 | 0.27–0.29 | 0.03–0.04 | 1.33–1.42 | 151.3–156.1 | 64–67 | 17.56–18.85 |
| ss-low-4x · cpp | 4.21–5.08 | 1.94–2.38 | 0.79–0.99 (0) | 0.29–0.32 | 0.01–0.02 | 0.26–0.34 | 0.03–0.06 | 0.81–0.91 | 143.8–146.2 | 63–66 | 14.72–18.19 |
| school · line-follow | 6.88–7.46 | 3.24–3.51 | 1.34–1.48 (0) | 0.31–0.47 | 0–0.01 | 0.48–0.5 | 0.05–0.07 | 1.29–1.42 | 136.5–143.1 | 98–101 | 13.48–15.44 |
| school · mini-mission | 7.77–8.05 | 3.32–3.39 | 1.43–1.49 (0) | 0.39–0.41 | 0.01–0.02 | 1.04–1.13 | 0.08–0.12 | 1.33–1.41 | 251.7–255.1 | 97–100 | 15.4–16.2 |
| school · check-4x | 12.7–13.5 | 5.85–6.12 | 0.45–0.48 (0) | 0.82–0.84 | 0.02 | 3.15–3.58 | 0.22–0.28 | 2.01–2.08 | 821.6–893.8 | 96–99 | 13.81–16.25 |
| school · follow | 5.26–6.39 | 2.53–3.01 | 1.01–1.21 (0) | 0.23–0.29 | 0–0.01 | 0.37–0.47 | 0.04–0.08 | 0.99–1.23 | 144.5–147.8 | 97–98 | 7.52–12.21 |
| school · teleop | 6.01–7.11 | 2.35–2.81 | 1.21–1.37 (0) | 0.23–0.25 | 0 | 0.43–0.55 | 0.06–0.08 | 1.6–1.89 | 126.2–130.6 | 99–100 | 7.66–8.71 |
| school · pins | 9.03–9.72 | 3.77–4.07 | 1.5–1.6 (0) | 0.72–0.92 | 0.04–0.05 | 0.51–0.57 | 0.06–0.07 | 2.21–2.42 | 151.8–159.1 | 98–100 | 9.79–10.49 |
| school · cpp | 7.45–7.92 | 3.63–3.81 | 1.48–1.51 (0) | 0.32–0.5 | 0–0.01 | 0.5–0.52 | 0.05 | 1.33–1.43 | 137–144.9 | 97–100 | 9.06–11.61 |
| ss-low-4x-sim4x · line-follow | 7.77–7.86 | 5.1–5.18 | 0.42–0.46 (0) | 0.49–0.5 | 0.01 | 0.19–0.21 | 0.07–0.08 | 1.36–1.38 | 360.1–363 | 64–66 | 8.94–9.97 |
| ss-low-4x-sim4x · mini-mission | 6.42–9.19 | 3.4–4.41 | 0.15–0.22 (0) | 0.39–0.52 | 0.01 | 1.27–2.38 | 0.1–0.14 | 1.04–1.42 | 638.6–887.3 | 64–66 | 9.98–12.76 |
| school-sim4x · line-follow | 10.59–11.08 | 6.99–7.31 | 0.58–0.64 (0) | 0.64–0.72 | 0.01–0.02 | 0.26–0.31 | 0.11–0.12 | 1.86–1.89 | 359.4–363.4 | 95–99 | 9.62–10.32 |
| school-sim4x · mini-mission | 11.42–11.97 | 6.12–6.37 | 0.32–0.39 (0) | 0.65–0.77 | 0.01–0.02 | 2.11–2.15 | 0.15–0.2 | 1.87–2.05 | 656.7–663.2 | 95–105 | 7.52–9.68 |

## The busiest sources (profile pass, self time in the window, ms; the first repeat)

- **ss-low-4x · line-follow** (8 s, 477 frames): (browser) 473; rapier.wasm 414; three/build/three.module.js 402; three/build/three.core.js 131; src/core/run/virtual-clock.ts 108; WebGL calls (through the bench probe) 80; src/core/run/robot-run-session.ts 77; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 75. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; three/build/three.module.js 5 MiB; src/core/world/world.ts 4 MiB; src/core/world/units.ts 4 MiB; src/core/world/arena/ground-paint.ts 4 MiB
- **ss-low-4x · mini-mission** (8 s, 472 frames): (browser) 490; rapier.wasm 404; three/build/three.module.js 386; src/ui/robot3d/camera-studio.ts 169; three/build/three.core.js 122; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 85; src/core/run/virtual-clock.ts 79; src/core/run/robot-run-session.ts 78. Allocates most: src/ui/robot3d/camera-studio.ts 45 MiB; src/core/world/arena/ground-paint.ts 7 MiB; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; three/build/three.module.js 6 MiB; src/ui/robot3d/parts/zone-tag-layout.ts 4 MiB
- **ss-low-4x · check-4x** (37.8 s, 2025 frames): src/ui/robot3d/camera-studio.ts 3992; rapier.wasm 3125; (browser) 2800; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 1051; react-dom/cjs/react-dom-client.production.js 593; three/build/three.module.js 483; src/core/run/virtual-clock.ts 428; WebGL calls (through the bench probe) 418. Allocates most: src/ui/robot3d/camera-studio.ts 979 MiB; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 80 MiB; src/core/world/world.ts 63 MiB; src/core/world/sensors/contacts.ts 53 MiB; src/core/world/robot/assembly.ts 48 MiB
- **ss-low-4x · follow** (8 s, 481 frames): (browser) 421; rapier.wasm 389; three/build/three.module.js 377; three/build/three.core.js 123; src/core/run/virtual-clock.ts 81; src/core/world/world.ts 61; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 61; src/core/run/robot-run-session.ts 60. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; three/build/three.module.js 6 MiB; src/ui/robot3d/camera-studio.ts 5 MiB; src/core/world/world.ts 4 MiB; src/core/world/units.ts 4 MiB
- **ss-low-4x · teleop** (8.1 s, 477 frames): (browser) 598; rapier.wasm 407; three/build/three.module.js 364; three/build/three.core.js 129; WebGL calls (through the bench probe) 121; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 95; src/core/run/robot-run-session.ts 59; src/core/world/world.ts 53. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; src/core/world/world.ts 5 MiB; three/build/three.module.js 5 MiB; src/core/world/units.ts 4 MiB; src/core/world/arena/ground-paint.ts 4 MiB
- **ss-low-4x · pins** (8 s, 475 frames): (browser) 641; three/build/three.module.js 398; rapier.wasm 392; three/build/three.core.js 135; react-dom/cjs/react-dom-client.production.js 124; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 79; src/core/run/virtual-clock.ts 73; src/core/run/robot-run-session.ts 63. Allocates most: three/build/three.module.js 6 MiB; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 5 MiB; src/core/world/units.ts 4 MiB; src/core/world/world.ts 4 MiB; @dimforge/rapier3d-deterministic/math.js 4 MiB
- **ss-low-4x · cpp** (8 s, 481 frames): (browser) 438; rapier.wasm 410; three/build/three.module.js 382; three/build/three.core.js 116; react-dom/cjs/react-dom-client.production.js 91; src/core/run/virtual-clock.ts 83; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 72; WebGL calls (through the bench probe) 68. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; three/build/three.module.js 6 MiB; src/core/world/world.ts 4 MiB; src/core/world/units.ts 4 MiB; src/core/world/arena/ground-paint.ts 4 MiB
- **school · line-follow** (8 s, 480 frames): (browser) 634; rapier.wasm 590; three/build/three.module.js 585; three/build/three.core.js 169; src/core/run/virtual-clock.ts 121; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 118; src/core/run/robot-run-session.ts 109; src/core/program/ybc-interpreter.ts 83. Allocates most: three/build/three.module.js 6 MiB; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; src/core/world/units.ts 4 MiB; src/core/world/world.ts 4 MiB; src/core/world/sensors/contacts.ts 4 MiB
- **school · mini-mission** (8 s, 462 frames): (browser) 650; rapier.wasm 631; three/build/three.module.js 569; src/ui/robot3d/camera-studio.ts 260; three/build/three.core.js 195; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 118; react-dom/cjs/react-dom-client.production.js 95; src/core/run/virtual-clock.ts 88. Allocates most: src/ui/robot3d/camera-studio.ts 44 MiB; src/core/world/arena/ground-paint.ts 7 MiB; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; three/build/three.module.js 5 MiB; src/ui/robot3d/parts/zone-tag-layout.ts 4 MiB
- **school · check-4x** (41.6 s, 2026 frames): src/ui/robot3d/camera-studio.ts 6661; rapier.wasm 4892; (browser) 4223; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 1563; react-dom/cjs/react-dom-client.production.js 926; three/build/three.module.js 750; src/core/run/virtual-clock.ts 580; src/core/world/arena/ground-paint.ts 563. Allocates most: src/ui/robot3d/camera-studio.ts 1079 MiB; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 79 MiB; src/core/world/world.ts 63 MiB; src/core/world/sensors/contacts.ts 53 MiB; src/core/world/robot/assembly.ts 51 MiB
- **school · follow** (8 s, 481 frames): rapier.wasm 479; (browser) 478; three/build/three.module.js 402; three/build/three.core.js 110; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 97; src/core/run/virtual-clock.ts 97; src/core/run/robot-run-session.ts 69; src/core/world/world.ts 63. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; three/build/three.module.js 5 MiB; src/ui/robot3d/camera-studio.ts 5 MiB; src/core/world/world.ts 4 MiB; src/core/world/units.ts 4 MiB
- **school · teleop** (8.1 s, 485 frames): (browser) 776; rapier.wasm 528; three/build/three.module.js 486; three/build/three.core.js 167; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 107; WebGL calls (through the bench probe) 72; src/core/run/robot-run-session.ts 68; react-dom/cjs/react-dom-client.production.js 62. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; three/build/three.module.js 5 MiB; src/core/world/world.ts 5 MiB; src/core/world/units.ts 4 MiB; src/core/world/arena/ground-paint.ts 4 MiB
- **school · pins** (8 s, 481 frames): (browser) 1062; three/build/three.module.js 650; rapier.wasm 607; three/build/three.core.js 207; react-dom/cjs/react-dom-client.production.js 188; src/core/run/virtual-clock.ts 157; src/core/run/robot-run-session.ts 125; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 114. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; three/build/three.module.js 6 MiB; src/core/world/units.ts 4 MiB; src/core/world/world.ts 4 MiB; src/core/world/arena/ground-paint.ts 4 MiB
- **school · cpp** (8 s, 478 frames): (browser) 685; rapier.wasm 646; three/build/three.module.js 593; three/build/three.core.js 188; src/core/run/virtual-clock.ts 146; src/core/run/robot-run-session.ts 119; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 115; WebGL calls (through the bench probe) 93. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 6 MiB; three/build/three.module.js 5 MiB; src/core/world/units.ts 4 MiB; src/core/world/world.ts 4 MiB; src/core/world/sensors/contacts.ts 4 MiB
- **ss-low-4x-sim4x · line-follow** (8 s, 478 frames): rapier.wasm 849; (browser) 651; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 234; three/build/three.module.js 179; src/core/run/virtual-clock.ts 173; src/core/hardware/binding.ts 162; react-dom/cjs/react-dom-client.production.js 140; src/core/program/ybc-interpreter.ts 129. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 20 MiB; src/core/world/world.ts 15 MiB; src/core/world/sensors/contacts.ts 12 MiB; src/core/world/units.ts 12 MiB; src/core/world/robot/assembly.ts 11 MiB
- **ss-low-4x-sim4x · mini-mission** (8 s, 420 frames): src/ui/robot3d/camera-studio.ts 926; rapier.wasm 742; (browser) 598; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 181; react-dom/cjs/react-dom-client.production.js 121; src/core/run/virtual-clock.ts 105; src/core/world/world.ts 96; src/core/run/robot-run-session.ts 89. Allocates most: src/ui/robot3d/camera-studio.ts 223 MiB; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 18 MiB; src/core/world/world.ts 13 MiB; src/core/world/sensors/contacts.ts 11 MiB; src/core/world/units.ts 10 MiB
- **school-sim4x · line-follow** (8 s, 482 frames): rapier.wasm 1166; (browser) 911; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 307; three/build/three.module.js 241; src/core/hardware/binding.ts 239; src/core/run/virtual-clock.ts 227; src/core/program/ybc-interpreter.ts 212; react-dom/cjs/react-dom-client.production.js 182. Allocates most: @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 20 MiB; src/core/world/world.ts 15 MiB; src/core/world/sensors/contacts.ts 12 MiB; src/core/world/robot/assembly.ts 11 MiB; src/core/world/units.ts 11 MiB
- **school-sim4x · mini-mission** (8 s, 430 frames): rapier.wasm 1118; (browser) 882; src/ui/robot3d/camera-studio.ts 794; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 278; react-dom/cjs/react-dom-client.production.js 173; src/core/run/virtual-clock.ts 160; three/build/three.module.js 136; src/core/run/robot-run-session.ts 113. Allocates most: src/ui/robot3d/camera-studio.ts 132 MiB; @dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js 20 MiB; src/core/world/world.ts 13 MiB; src/core/world/sensors/contacts.ts 11 MiB; src/core/world/units.ts 11 MiB

## Before the first frame (profile pass: navigation → the scene drawn, main thread self time by what ran, ms)

| profile · scenario | first frame | busy | three | blockly | react-dom | r3f | ui: robot3d | sim | webgl calls | browser | gc |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ss-low-4x · line-follow | 2085–3710 | 1452–3221 | 747–1020 | 119–212 | 49–56 | 45–48 | 103–120 | 15–18 | 18–1339 | 152–295 | 12–17 |
| ss-low-4x · mini-mission | 2091–2109 | 1416–1435 | 632–653 | 126–136 | 50–55 | 43–47 | 159–161 | 19–21 | 14–19 | 154–189 | 15–17 |
| ss-low-4x · check-4x | 2074–2098 | 1381–1408 | 632–660 | 120–123 | 47–54 | 42–46 | 157–164 | 15–18 | 15–16 | 141–152 | 13–15 |
| ss-low-4x · follow | 2016–2089 | 1348–1434 | 672–739 | 115–121 | 50–56 | 39–45 | 103–111 | 15–20 | 16–17 | 145–152 | 11–14 |
| ss-low-4x · teleop | 2130–2177 | 1438–1490 | 779–820 | 103–113 | 50–53 | 42–44 | 103–107 | 15–17 | 11–19 | 146–147 | 11–16 |
| ss-low-4x · pins | 2073–2099 | 1402–1432 | 698–745 | 113–122 | 49–53 | 39–45 | 108–114 | 15–20 | 17–17 | 144–155 | 10–16 |
| ss-low-4x · cpp | 2033–2123 | 1362–1472 | 686–767 | 115–119 | 46–47 | 42–45 | 105–112 | 15–22 | 14–17 | 146–158 | 11–17 |
| school · line-follow | 2051–4055 | 1878–3730 | 810–1162 | 185–276 | 81–82 | 68–71 | 154–176 | 25–29 | 25–28 | 227–1607 | 19–31 |
| school · mini-mission | 2016–2049 | 1901–1917 | 719–756 | 184–192 | 79–89 | 62–74 | 236–243 | 25–35 | 16–29 | 239–247 | 24–31 |
| school · check-4x | 2008–2056 | 1870–1949 | 703–749 | 184–197 | 71–87 | 66–73 | 237–247 | 24–30 | 20–26 | 229–251 | 23–24 |
| school · follow | 1944–2033 | 1754–1809 | 751–764 | 166–189 | 69–83 | 59–70 | 151–156 | 29–31 | 19–25 | 214–237 | 18–21 |
| school · teleop | 1995–2431 | 1768–1929 | 812–903 | 150–166 | 68–77 | 68–72 | 146–165 | 22–30 | 21–26 | 218–240 | 20–26 |
| school · pins | 2044–2084 | 1891–1915 | 796–825 | 189–198 | 73–80 | 65–77 | 160–167 | 26–37 | 22–28 | 245–248 | 19–24 |
| school · cpp | 2047–2136 | 1902–1964 | 795–823 | 188–202 | 79–86 | 63–68 | 162–176 | 22–32 | 22–25 | 240–253 | 14–25 |
| ss-low-4x-sim4x · line-follow | 2149–3602 | 1460–3120 | 736–973 | 124–200 | 50–57 | 42–48 | 107–112 | 20–21 | 15–1309 | 155–210 | 10–16 |
| ss-low-4x-sim4x · mini-mission | 2031–2178 | 1378–1595 | 648–752 | 122–132 | 48–58 | 47–49 | 147–171 | 14–20 | 13–15 | 143–228 | 12–20 |
| school-sim4x · line-follow | 1951–3909 | 1765–3528 | 743–1108 | 172–274 | 73–84 | 62–69 | 152–158 | 21–31 | 22–27 | 236–1510 | 14–24 |
| school-sim4x · mini-mission | 1975–2494 | 1846–1981 | 723–761 | 171–207 | 80–88 | 65–71 | 224–239 | 27–31 | 24–27 | 243–247 | 23–31 |

- **ss-low-4x · line-follow**: WebGL calls (through the bench probe) 1339; three/build/three.module.js 891; (browser) 212; blockly/blockly_compressed.js 205; three/build/three.core.js 84; react-dom/cjs/react-dom-client.production.js 53; (unknown) 49; @react-three/fiber/dist/events-9ce18a08.esm.js 45; react-use-measure/dist/index.js 40; src/ui/robot3d/camera-studio.ts 39
- **ss-low-4x · mini-mission**: three/build/three.module.js 514; (browser) 189; blockly/blockly_compressed.js 119; src/ui/robot3d/camera-studio.ts 83; three/build/three.core.js 80; react-dom/cjs/react-dom-client.production.js 52; @react-three/fiber/dist/events-9ce18a08.esm.js 42; (unknown) 38; react-use-measure/dist/index.js 35; three/examples/jsm/loaders/GLTFLoader.js 27
- **ss-low-4x · check-4x**: three/build/three.module.js 537; (browser) 141; blockly/blockly_compressed.js 118; src/ui/robot3d/camera-studio.ts 88; three/build/three.core.js 79; react-dom/cjs/react-dom-client.production.js 50; (unknown) 44; @react-three/fiber/dist/events-9ce18a08.esm.js 41; react-use-measure/dist/index.js 34; three/examples/jsm/loaders/GLTFLoader.js 30
- **ss-low-4x · follow**: three/build/three.module.js 565; (browser) 145; blockly/blockly_compressed.js 111; three/build/three.core.js 80; react-dom/cjs/react-dom-client.production.js 50; src/ui/robot3d/camera-studio.ts 42; @react-three/fiber/dist/events-9ce18a08.esm.js 38; (unknown) 34; three/examples/jsm/loaders/GLTFLoader.js 31; react-use-measure/dist/index.js 30
- **ss-low-4x · teleop**: three/build/three.module.js 683; (browser) 147; blockly/blockly_compressed.js 104; three/build/three.core.js 92; react-dom/cjs/react-dom-client.production.js 50; @react-three/fiber/dist/events-9ce18a08.esm.js 40; src/ui/robot3d/camera-studio.ts 35; (unknown) 34; react-use-measure/dist/index.js 32; three/examples/jsm/loaders/GLTFLoader.js 27
- **ss-low-4x · pins**: three/build/three.module.js 613; (browser) 144; blockly/blockly_compressed.js 116; three/build/three.core.js 90; react-dom/cjs/react-dom-client.production.js 49; @react-three/fiber/dist/events-9ce18a08.esm.js 43; (unknown) 39; src/ui/robot3d/camera-studio.ts 39; react-use-measure/dist/index.js 35; three/examples/jsm/loaders/GLTFLoader.js 26
- **ss-low-4x · cpp**: three/build/three.module.js 590; (browser) 154; blockly/blockly_compressed.js 109; three/build/three.core.js 85; react-dom/cjs/react-dom-client.production.js 46; @react-three/fiber/dist/events-9ce18a08.esm.js 44; (unknown) 40; src/ui/robot3d/camera-studio.ts 36; react-use-measure/dist/index.js 34; three/examples/jsm/loaders/GLTFLoader.js 28
- **school · line-follow**: (browser) 1607; three/build/three.module.js 949; blockly/blockly_compressed.js 266; three/build/three.core.js 138; react-dom/cjs/react-dom-client.production.js 82; (unknown) 67; @react-three/fiber/dist/events-9ce18a08.esm.js 67; src/ui/robot3d/camera-studio.ts 60; react-use-measure/dist/index.js 55; three/examples/jsm/loaders/GLTFLoader.js 49
- **school · mini-mission**: three/build/three.module.js 557; (browser) 247; blockly/blockly_compressed.js 180; three/build/three.core.js 131; src/ui/robot3d/camera-studio.ts 125; react-dom/cjs/react-dom-client.production.js 88; @react-three/fiber/dist/events-9ce18a08.esm.js 60; (unknown) 59; react-use-measure/dist/index.js 56; three/examples/jsm/loaders/GLTFLoader.js 50
- **school · check-4x**: three/build/three.module.js 548; (browser) 251; blockly/blockly_compressed.js 189; three/build/three.core.js 131; src/ui/robot3d/camera-studio.ts 128; react-dom/cjs/react-dom-client.production.js 87; @react-three/fiber/dist/events-9ce18a08.esm.js 69; (unknown) 64; react-use-measure/dist/index.js 54; three/examples/jsm/loaders/GLTFLoader.js 46
- **school · follow**: three/build/three.module.js 582; (browser) 237; blockly/blockly_compressed.js 163; three/build/three.core.js 123; react-dom/cjs/react-dom-client.production.js 71; @react-three/fiber/dist/events-9ce18a08.esm.js 61; (unknown) 59; src/ui/robot3d/camera-studio.ts 53; react-use-measure/dist/index.js 47; three/examples/jsm/loaders/GLTFLoader.js 42
- **school · teleop**: three/build/three.module.js 717; (browser) 236; blockly/blockly_compressed.js 148; three/build/three.core.js 131; react-dom/cjs/react-dom-client.production.js 77; @react-three/fiber/dist/events-9ce18a08.esm.js 71; (unknown) 64; src/ui/robot3d/camera-studio.ts 51; react-use-measure/dist/index.js 44; zod/v4/core/schemas.js 38
- **school · pins**: three/build/three.module.js 639; (browser) 245; blockly/blockly_compressed.js 184; three/build/three.core.js 122; react-dom/cjs/react-dom-client.production.js 80; @react-three/fiber/dist/events-9ce18a08.esm.js 62; (unknown) 62; src/ui/robot3d/camera-studio.ts 59; react-use-measure/dist/index.js 59; three/examples/jsm/loaders/GLTFLoader.js 49
- **school · cpp**: three/build/three.module.js 593; (browser) 253; blockly/blockly_compressed.js 187; three/build/three.core.js 133; react-dom/cjs/react-dom-client.production.js 85; (unknown) 65; src/ui/robot3d/camera-studio.ts 63; @react-three/fiber/dist/events-9ce18a08.esm.js 60; react-use-measure/dist/index.js 57; three/examples/jsm/loaders/GLTFLoader.js 51
- **ss-low-4x-sim4x · line-follow**: WebGL calls (through the bench probe) 1309; three/build/three.module.js 845; (browser) 210; blockly/blockly_compressed.js 194; three/build/three.core.js 82; react-dom/cjs/react-dom-client.production.js 50; @react-three/fiber/dist/events-9ce18a08.esm.js 47; src/ui/robot3d/camera-studio.ts 40; (unknown) 39; react-use-measure/dist/index.js 37
- **ss-low-4x-sim4x · mini-mission**: three/build/three.module.js 625; (browser) 228; blockly/blockly_compressed.js 115; three/build/three.core.js 88; src/ui/robot3d/camera-studio.ts 87; @react-three/fiber/dist/events-9ce18a08.esm.js 49; react-dom/cjs/react-dom-client.production.js 48; (unknown) 39; react-use-measure/dist/index.js 35; zod/v4/core/schemas.js 26
- **school-sim4x · line-follow**: (browser) 1510; three/build/three.module.js 903; blockly/blockly_compressed.js 267; three/build/three.core.js 136; react-dom/cjs/react-dom-client.production.js 84; @react-three/fiber/dist/events-9ce18a08.esm.js 67; react-use-measure/dist/index.js 61; src/ui/robot3d/camera-studio.ts 61; (unknown) 59; three/examples/jsm/loaders/GLTFLoader.js 49
- **school-sim4x · mini-mission**: three/build/three.module.js 520; (browser) 243; blockly/blockly_compressed.js 162; three/build/three.core.js 137; src/ui/robot3d/camera-studio.ts 126; react-dom/cjs/react-dom-client.production.js 80; @react-three/fiber/dist/events-9ce18a08.esm.js 66; (unknown) 53; react-use-measure/dist/index.js 49; zod/v4/core/schemas.js 44

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
