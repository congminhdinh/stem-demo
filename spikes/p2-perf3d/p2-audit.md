# P2: performance audit of the 3D robot lab (N18), Phase A and Phase B

**Phase B (2026-10-26), what changed and the targets measured: §9.** Phase A follows as it was written, corrected in §9.5.

The owner asked: "hãy chắc chắn rằng các tính năng 3d phải optimize về hiệu năng nhé" (make sure the 3D features are optimised for
performance). The lab must also stay as beautiful as R4.7 made it. Phase A measures and audits, and changes no product code. Phase B
waits for the controller's go.

- **Branch and base.** `n18/p2-perf3d`. The audit was measured on three bases in turn:
  - R4.7's tip `39a877d`: the branch was cut here, and the first full measurements (`final-*`) and the A/B were taken here.
  - Master `b5c8727` (R4.7 through fix round 2, plus R4.3's sensor overlays): the branch was rebased and measured again
    (`master-*`).
  - Master `16407b8` (R8-a11y merged): the branch is rebased onto it. It was measured interleaved against `b5c8727` on the cells
    the findings rest on (§2.8).
  - Both rebases were clean: my commits touch only `scripts/`, `spikes/` and `package.json`.
  - Master is the target. Where the bases differ, each is given.
- **Machine.** Apple M4 Pro (12 cores: 8 performance, 4 efficiency; 24 GB), Darwin 25.5.0, Node 24.22.1, Chromium 153
  (Playwright 1.63).
- **Load.** The machine was shared with other agents.
  - Another agent ran SwiftShader FPS runs (8–9 cores) and a `pnpm verify` (load up to 92) during part of my session.
  - The cited SwiftShader cells were measured after those runs had stopped. Every cell records its 1-minute load average.
  - The first, noisy pass is kept as `spikes/p2-perf3d/results/rehearsal-fps-high-load.log` and is not cited.
- **Commits on the branch** (on `16407b8`; none touches `src/`):
  - `ae45a68` harness;
  - `6d45283` audit spikes;
  - `804f0b0` harness: per-process CPU, marks, `--report`;
  - `2e36079` harness: CPU calibration loop per cell;
  - `fc40929` harness: `--sensors`, builds without model files, plus the listener spike;
  - `a38d163` harness: tag spot changes, plus the A/B variants;
  - `d126423` spikes: the master runs;
  - the results commit (§8).
- **Checks.** `pnpm verify` is green on the branch rebased onto `16407b8`: 388 files, 9045 passed, 1 skipped.

## 0. Summary

Measured on R4.7's tip (`39a877d`), again on the merged master (`b5c8727`, R4.7 + R4.3), which is the real target, and against
master `16407b8` (R8-a11y). `16407b8` matched `b5c8727` within the spread on every cell (§2.8). All numbers are ranges over 3
repeats with the load beside them (§1.3). The builds agree on every finding below.

**The GPU high tier is fine.** On master, every run gets:
- 59.9–60.2 fps median;
- frame p95 18.0–19.0 ms;
- a main thread at most 4.9 ms at p95;
- 0 long tasks over 100 ms;
- Run → moving in 7–19 ms.

**The work is on the path without a GPU (SwiftShader) and in four places in the code.**

1. **Without a GPU, the picture is the cost.**
   - SwiftShader's GPU process spends **81–133 ms of CPU per animation frame** on master's low tier while a run moves (95–170 on
     `39a877d`). That is **5–8 M4 Pro cores** at 60 fps, while the lab's main thread needs 2.2–5.6 ms (p50).
   - When other work left SwiftShader 0.4–0.5 cores, the low tier drew at **5.8–6.2 fps**. With 1.9–2.2 cores it drew at 23–25 fps.
     The main thread used only 11–12 ms per frame in both.
   - So the "school PC" main-thread profile (CPU 6×) reads 60 fps, but a real 2–4-core PC without a GPU would be held to roughly
     10–15 fps by rasterisation. That is an estimate, §3.1.
   - Against pre-R4.7 master (`1211347`, interleaved on SwiftShader at 4×), this cost is 1.7× (59 → 96–105 ms per frame).
   - Drawing a run at 30 fps cuts it by 40–50 % (A/B §4).
2. **The free view is framed again on every HUD height change, mid-run too, and each framing is an expensive search.**
   - A goal's progress bar appearing and going changes the HUD's height: 6 reframes in 15 s of mini-mission, 19 in one Kiểm tra 4×.
   - `freeViewPose` costs 12.4 ms per call for mini-mission (Node, M4).
   - In a school-profile 4× check it is the busiest source, with 3.1–5.0 ms per frame and 520–790 KB/frame allocated on master,
     and up to 1.08 GiB in one check. It produces 20 long tasks, frame p99 80–86 ms (master).
   - A fit test with the same arithmetic is 5.5–10.6× faster with the same poses to the last digit. With a pose memo it takes the
     check's long tasks **20 → 1** (A/B). `camera-studio.test.ts` passes unchanged.
3. **The first frame without a GPU** is 2.07–2.13 s on master at 4× against 1.27–1.28 s on pre-R4.7 master (interleaved, same CPU
   speed). On the school profile it is 2.4–2.6 s warm and 3.8 s cold; the target is 2.5 s.
   - The largest single part is the first scene render waiting for every shader link: 542 of its 606–629 ms on the school trace. It
     is three's `onFirstUse` queries, which SwiftShader cannot overlap (no KHR_parallel_shader_compile).
   - Turning off `checkShaderErrors` does **not** help (A/B), because the uniform-location queries wait just as long.
   - The rest: the free view's first framing (93 ms), the unused low-tier fibre normal map (31–36 ms), assembly, and GLB parse.
4. **Every 3D canvas mount leaks one document `keydown` listener and 186–212 KB of heap** (master).
   - The cause is OrbitControls. Its `connect()` listens on `domElement.getRootNode()`, the document. `dispose()` runs after R3F
     detached the canvas, when the root is no longer the document, so the removal misses.
   - 20 switches 2D ↔ 3D: +3.5–4.0 MB and +19 listeners. 20 tier switches: +1.5–1.6 MB and +18 listeners.
   - GPU resources are clean: 0 growth in contexts, geometries, textures or programs.
5. **The rest holds on master.**
   - Heap flat over 10-minute soaks:
     - gpu-high −2.0 to −2.8 % (`39a877d`);
     - school, on master with the overlays on: −2.2 / +0.2 / −1.8 %.
   - 0 draws at rest in 99 windows; 0 programs compiled after the first frame.
   - 3D chunk 378.5 kB gzip (budget 600).
   - First Run at 4× ≤ 278 ms (budget 1.5 s).
   - At 4× sim speed the school main thread fits: busy 8.1–8.4 ms p50, p95 frame 19.4–19.9 ms. **A Web Worker for the simulation is
     not justified** (§3.8).
   - R4.3's overlays cost nothing measurable on the main thread or the GPU tier: +3–4 draws, and below 3.3 KB/frame and 0.07
     ms/frame each in the profile. On SwiftShader they add 2–7 ms of GPU-process CPU per frame where the ultrasonic beam shows.

**Proposed Phase B list** (details, risk, effort and files in §5):

| # | change | expected gain (measured basis) |
|---|---|---|
| 1 | Free view: the same-arithmetic fit test, a pose memo, no reframing mid-run; and Rapier instantiated after the first frame, at idle | school 4× check: long tasks 20 → 1 → 0 (A/B, then the check trace: the last one is Rapier's first instantiation, 240–258 ms of wasm at 6×); p99 79–103 → 40–45 ms; first frame −85 ms at 6× |
| 2 | Fix the OrbitControls listener leak | −1 listener and −186–212 KB per 3D mount |
| 3 | A slow-low fallback without a GPU: frame watch on the low tier → a run drawn at 30 fps → offer the 2D map | SwiftShader CPU per animation frame −40–50 % where low is slow (A/B) |
| 4 | Zones' tags without per-frame garbage, with hysteresis (try the last spot first) | 6–15 KB/frame less garbage; tag jumps (1.4–2.9 spot changes/s measured) |
| 5 | First frame without a GPU: start the links earlier (compile the GLB materials as soon as they parse); skip the low tier's unused fibre normal map and roughness canvas | −31–36 ms for certain; up to −250 ms at 6× from overlapping the links, to be A/B'd |
| 6 | Shadow map only when a caster moved | high tier: 49–54 shadow draws and 0.2–0.5 ms → 0 on camera-only frames |
| 7 | Small per-frame costs (`applyRobotWorld`'s colour parsing) | small |
| 8 | Hosting: gzip/br for `.glb`/`.wasm`, immutable caching (deployment docs) | first visit 1.13 → 0.52 MB GLB, 3.1 → 1.18 MB wasm |

Measured and not proposed:
- `checkShaderErrors` off, and the mat's anisotropy off on low: no gain (A/B).
- 0.75 DPR on low: −18–22 % on teleop only.
- A Web Worker.
- A baked static shadow.
- Any physics change (the determinism hashes).

## 1. Method

### 1.1 The harness: `pnpm bench:robot3d` (`scripts/bench-robot3d.mjs`)

- **Production build only.** It runs `vite build --sourcemap hidden` into `node_modules/.cache/bench-robot3d/dist`.
  - The JS is byte-identical to `pnpm build`'s: `cmp` matched all 5 chunks. The maps only name profile frames.
  - `vite preview` serves it with the product's COOP/COEP headers.
  - `e2e/lesson-host.mjs` frames it at 1100 × 640 with the LMS sandbox, and programs arrive over stem-lab/v1 `load-project`.
  - Ports: 5300–5309.
- **No product flag.** The page side is an init script, `scripts/lib/robot3d-probe.js`. It reads production code from outside:
  - three's devtools seam (`__THREE_DEVTOOLS__`): the renderer, whose `render`, `compileAsync` and `GLTFLoader.parse` it times,
    plus `renderer.info`;
  - React's devtools hook: the commits of every root, in production builds too;
  - wrappers for WebGL's draw and bind calls: draws to the screen and to off-screen targets (the shadow map);
  - a wrapper for `requestAnimationFrame`: animation frames, and the main thread's time from each frame's first callback to a
    message posted there (callbacks, the run's microtask ticks, style, layout, paint);
  - long tasks, and performance marks for a trace's timeline;
  - a scene inventory with a GPU-memory estimate: textures, geometry, shadow maps, drawing buffer.
- **Each process's CPU time per frame** comes from CDP `SystemInfo.getProcessInfo`. With SwiftShader, the GPU process's share is the
  rasterisation.
- **Profile pass.** The same windows run under V8's CPU profiler (250 µs samples) and its sampling heap profiler (collected objects
  included).
  - Every sample is mapped through the source maps by `scripts/lib/profile-attribution.mjs`, a small VLQ reader: 20 000 random
    lookups per chunk agree with `source-map-js`.
  - Each sample goes to a bucket by its whole stack: sim (`src/core`, Rapier), three's render (the shadow map split out), Blockly,
    R3F/Konva's reconciler, react-dom, the scene's frame callbacks, GC, and "browser" (V8's `(program)`: style, layout, paint, GL
    submission).
  - The loading phase, from navigation to the first frame, is profiled the same way.
- **Per cell**, each on a new browser context (a cold HTTP cache):
  1. the first frame;
  2. a CPU calibration loop (3·10⁷ steps in the lab frame);
  3. a 3 s idle window: draws per second must be 0;
  4. the first Run (Rapier loads), to its robot moving;
  5. Dừng and Đặt lại, then a warm Run, timed as "Run → moving": from the click to the end of the first render that drew the
     robot's group moved;
  6. warm-up, then an 8 s measuring window;
  7. for drive-to-zone, a rest window after the robot parks.
- **Repeats.** 3 per cell; tables give the ranges. `idle` launches a new browser each time, so its first frame is the cold one (GPU
  process and SwiftShader's shader JIT cold).
- **Outputs.** JSON plus Markdown; budget rows exit 1 when missed. `--report` merges earlier results.

### 1.2 Profiles and scenarios

| profile | browser, GPU | tier | CPU | window | sim speed |
|---|---|---|---|---|---|
| gpu-high | Chromium new headless, ANGLE Metal (M4 Pro), vsync 60 Hz | high | 1× | 1200 × 760, DPR 1 | 1× |
| ss-low-4x | Chromium headless shell, `--use-angle=swiftshader` | low | 4× | 1200 × 760, DPR 1 | 1× |
| school | the same SwiftShader | low | 6× | 1366 × 768, DPR 1 | 1× |
| *-sim4x | each of the three | as above | as above | as above | 4× (8 ticks a frame) |

Scenarios:
- idle: an orbit drag, then its settling;
- runs of drive-to-zone (with the parked rest), line-follow and mini-mission;
- check-1x (mini-mission, an 8 s window) and check-4x (the whole check);
- follow ("Theo xe");
- teleop (the sandbox, keys held);
- pins and cpp (line-follow with the "Cổng & chân" or the C++ tab open);
- soak (the sandbox's loop for 10 min, a new Run when one ends, the heap after GC each minute);
- switch (20 × 2D ↔ 3D, 20 × tier, 10 × scenario).

### 1.3 Caveats (read before the numbers)

- **The CPU throttle slows only the renderer's main thread.** `Emulation.setCPUThrottlingRate` does not slow the GPU process or
  SwiftShader's raster threads, which here run on 12 M4 Pro cores. §3.1 is about that gap.
- **The host moves the throttled thread's speed between cells.** One school stretch had every phase about 0.64× as long as the
  stretch before it:
  - RobotLab.js loaded at 450 instead of 700 ms;
  - the first frame came at 2.4 instead of 3.2 s.
  - The throttle check (`spikes/p2-perf3d/throttle-check.mjs`, 14 contexts) showed the throttle applies to the frame: same process,
    not an out-of-process iframe, and a loop of 96–100 ms at 6× in both the frame and the page.
  - The likely cause is the macOS scheduler putting the thread on efficiency or performance cores.
  - Since `daeee96` each cell records its calibration loop ("CPU loop ms"). Every master cell has it (school 92–102 ms); the
    `39a877d` fps pass predates it.
- **Not measurable here:** GPU time on a real iGPU (fill rate, the high tier's shadow map and MSAA) and real school PCs (§7).

## 2. Measurements

§2.1–2.6 are R4.7's tip `39a877d`; §2.7 is the merged master `b5c8727`; §2.8 compares `16407b8` with it.

The full tables are in `spikes/p2-perf3d/results/`:
- on `39a877d`:
  - `bench-robot3d-final-gpu-fps-*.md` (with the 10-minute soaks and the switches);
  - `-final-gpu-profile-*`;
  - `-final-ss-fps-*` (with switches);
  - `-final-ss-profile-*`;
  - the A/B in `ab/`;
- on master:
  - `-master-fps-*`, `-master-fps-sim4x-*`;
  - `-master-profile-{gpu,school,school-sim4x}-*`;
  - `master-ab/` (overlays, pre-R4.7, the school soak);
  - `master2-ab/` (`16407b8` against `b5c8727`).
- The JSON files are gzipped (`*.json.gz`); `gunzip` them for `--report`.

Below, ranges are over 3 repeats; load is the 1-minute average.

### 2.1 Budgets (robot plan §5) and P2 targets (`39a877d`; master in §2.7)

| measure | worst measured | limit | result |
|---|---|---|---|
| 3D chunk `RobotLab-*.js` gzip -6 | 370 kB | ≤ 600 kB | ok |
| gpu-high median fps, every run scenario (24 cells) | 59.9 | ≥ 50 | ok |
| ss-low-4x p5 fps, every run scenario (24 cells) | 45.5 | ≥ 30 | ok |
| first Run → moving at 4× (physics loads) | 450 ms | ≤ 1.5 s | ok |
| Run → moving (warm), every profile (72 cells) | 88 ms | ≤ 300 ms | ok |
| draws per second at rest (135 windows) | 0 | 0 | ok |
| JS heap growth over 10 min soak, gpu-high (3 runs) | −2.0 / −2.5 / −2.8 % | ≤ 5 % | ok |
| physics ms/tick, headless check 3 × 60 s | not this harness | `pnpm bench:robot` (P1) | — |
| target: school p95 frame, runs at 1× (24 cells) | 30.7 ms | ≤ 33 ms | met |
| target: school p95 frame at 4× (sim 4× and Kiểm tra 4×) | 89.4 ms (check-4x); 18.8–23.3 at sim 4× | ≤ 33 ms | **not met** (check-4x) |
| target: school long tasks > 100 ms in a run | 5 (check-4x), 1 (check-1x) | 0 | **not met** |
| target: school first frame | 2.0–3.3 s warm; 5.3–5.4 s cold | ≤ 2.5 s | **not met** |
| target: school heap growth over 10 min (master, overlays on) | −2.2 / +0.2 / −1.8 % | ≤ 5 % | met |
| target: GPU-resource growth over 20 switches | 0 contexts, geometries, textures, programs | 0 | met (but see the listener leak, §3.6) |
| target: gpu-high p95 frame | 18.0 ms | ≤ 20 ms | met |

### 2.2 Frames (fps pass)

| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | draws screen + shadow | long tasks (> 100), max ms | React commits/s | GPU process ms/frame (cores) | load |
|---|---|---|---|---|---|---|---|---|---|
| gpu-high · line-follow | 60.2 | 56.5–57.8 | 16.6 / 17.3–17.7 / 17.6–18.3 | 1.7–2.9 / 4.0–4.1 | 80 + 51 | 0 | 10.6–10.7 | 1.9–2.2 (0.11–0.13) | 7.6–9.4 |
| gpu-high · mini-mission | 59.9–60.2 | 56.5–56.8 | 16.6–16.7 / 17.6–17.7 / 18.1–18.3 | 2.2–2.6 / 3.8–4.1 | 79 + 54 | 0 | 11.6–11.7 | 2.0–2.1 | 5.1–6.3 |
| gpu-high · check-4x | 59.9 | 55.6–56.5 | 16.7 / 17.7–18.0 / 20.8–28.4 | 2.0–2.2 / 3.3–4.4 | 81 + 54 | 1 (0), 74–78 | 34.3–34.4 | 1.1–1.2 | 3.5–5.4 |
| gpu-high · follow / teleop / pins / cpp | 59.9–60.2 | 56.5–58.1 | 16.6–16.7 / 17.2–17.7 / ≤ 18.0 | ≤ 1.8 / ≤ 2.8 | 73–80 + 51–54 | 0 | 10.7–20.7 | 1.6–2.4 | 7.8–13.2 |
| gpu-high-sim4x · line-follow | 59.9–60.2 | 56.5–57.8 | 16.6–16.7 / 17.3–17.7 / 17.6–18.0 | 2.3–2.4 / 3.4–4.6 | 80 + 51 | 0 | 30 | 1.0 | 1.6–2.4 |
| ss-low-4x · line-follow | 59.9–60.2 | 52.9–53.5 | 16.6–16.7 / 18.7–18.9 / 20.0–20.1 | 3.5–4.3 / 7.0–7.7 | 44 | 0 | 12.6–13 | 124 (7.4) | 4.4–6.6 |
| ss-low-4x · check-4x | 59.9–60.2 | 36.4–46.5 | 16.6–16.7 / 21.5–27.5 / 77.7–81 | 5.5–5.8 / 9.7–10.2 | 45 | 20 (1), 305–314 | 33.4–33.6 | 78 (4.5) | 4.9–7.3 |
| ss-low-4x · teleop | 58.1–60.2 | 45.5–54.1 | 16.6–17.2 / 18.5–22 / 20.4–29.2 | 4.1–5.2 / 5.9–7.7 | 40 | 0 | 11.9 | 168–170 (9.4–10.0) | 7.6–8.7 |
| school · line-follow | 60.2 | 50–52.4 | 16.6 / 19.1–20 / 20.7–21.8 | 6.2–6.5 / 10.4–11.8 | 44 | 0 | 10.7–13.1 | 116–125 (7.0–7.5) | 3.4–11.4 |
| school · mini-mission | 59.9–60.2 | 49–50.8 | 16.6–16.7 / 19.7–20.4 / 21.4–36.8 | 5.4–7.9 / 10.8–14 | 43 | 1 (0), 79–87 | 11.6–11.7 | 118–119 (7.0–7.1) | 8.3–10.4 |
| school · check-1x | 60.2–61 | 32.6–50 | 16.4–16.6 / 20–30.7 / 32.5–67.2 | 6.2–7.8 / 11.2–15.5 | 43 | 2 (0–1), 93–107 | 12.1–12.9 | 122–130 (6.9–7.1) | 7.9–9.5 |
| school · check-4x | 59.9–60.2 | 11.2–32.3 | 16.6–16.7 / 31–89.4 / 121.5–227.8 | 9.3–9.6 / 16.4–16.6 | 45 | 23–27 (2–5), 465–488 | 30.5–32 | 76–77 (4.0–4.3) | 5.5–8.2 |
| school · follow / teleop / pins / cpp | 59.9–60.2 | 50.3–56.2 | 16.6–16.7 / 17.8–19.9 / ≤ 27.4 | 4.1–6.4 / 6.6–11.1 | 39–44 | 0 | 10.7–22.6 | 94–128 (5.5–7.7) | 7.5–15.3 |
| school-sim4x · line-follow | 59.9–60.2 | 49.5–53.2 | 16.6–16.7 / 18.8–20.2 / 20–42.5 | 7.9–8.5 / 11.2–12.3 | 44 | 0 | 29.6–30.1 | 44–47 (2.6–2.8) | 10.7–11.8 |

Notes:
- "Main thread" is the probe's time from a frame's first callback to its posted message.
- "GPU process" is CPU per animation frame.
- Kiểm tra's and sim 4×'s GPU-process time is lower per frame because the robot rests in part of the window (fewer frames drawn).
- mini-mission at sim 4× parks after about 3.5 s of the window, so its p99 (200–254 ms) is the rest's gaps, not jank.

### 2.3 Where the main thread goes (profile pass, ms per animation frame)

| profile · scenario | busy | sim | three render (shadow) | React | scene callbacks | GC | browser | alloc KB/frame | CPU loop ms | load |
|---|---|---|---|---|---|---|---|---|---|---|
| gpu-high · line-follow | 2.19–2.42 | 0.80–0.91 | 0.82–0.98 (0.19–0.23) | 0.06–0.09 | 0.10–0.11 | 0.02–0.03 | 0.28–0.30 | 160–167 | — | 8.1–13.6 |
| gpu-high · check-4x | 3.24–3.60 | 1.48–1.62 | 0.23–0.27 (0.06–0.07) | 0.17–0.19 | 0.69–0.77 | 0.06–0.08 | 0.51–0.52 | 792–795 | — | 6.9–13.1 |
| gpu-high · follow | 3.05–3.41 | 1.08–1.20 | 1.14–1.44 (0.35–0.47) | 0.09–0.14 | 0.17–0.20 | 0.04–0.06 | 0.37–0.41 | 176–184 | — | 5.9–14.0 |
| ss-low-4x · line-follow | 4.65–5.30 | 2.22–2.53 | 0.95–1.00 | 0.23–0.25 | 0.27–0.36 | 0.03–0.04 | 0.85–0.99 | 140–144 | 64–67 | 11.1–17.1 |
| school · line-follow | 6.88–7.46 | 3.24–3.51 | 1.34–1.48 | 0.31–0.47 | 0.48–0.50 | 0.05–0.07 | 1.29–1.42 | 137–143 | 98–101 | 13.5–15.4 |
| school · mini-mission | 7.77–8.05 | 3.32–3.39 | 1.43–1.49 | 0.39–0.41 | 1.04–1.13 | 0.08–0.12 | 1.33–1.41 | 252–255 | 97–100 | 15.4–16.2 |
| school · check-4x | 12.7–13.5 | 5.85–6.12 | 0.45–0.48 | 0.82–0.84 | 3.15–3.58 | 0.22–0.28 | 2.01–2.08 | 822–894 | 96–99 | 13.8–16.3 |
| school · pins | 9.03–9.72 | 3.77–4.07 | 1.50–1.60 | 0.72–0.92 | 0.51–0.57 | 0.06–0.07 | 2.21–2.42 | 152–159 | 98–100 | 9.8–10.5 |
| school · cpp | 7.45–7.92 | 3.63–3.81 | 1.48–1.51 | 0.32–0.50 | 0.50–0.52 | 0.05 | 1.33–1.43 | 137–145 | 97–100 | 9.1–11.6 |
| school-sim4x · line-follow | 10.6–11.1 | 6.99–7.31 | 0.58–0.64 | 0.64–0.72 | 0.26–0.31 | 0.11–0.12 | 1.86–1.89 | 359–363 | 95–99 | 9.6–10.3 |

- **The sim's parts** (school, 1×, line-follow, self time per frame):
  - Rapier: 1.23 wasm + 0.50 JS glue;
  - the world: 0.70 (`world.ts`, `assembly.ts`, `contacts.ts`, `ground-paint.ts`, `units.ts`);
  - session and virtual clock: 0.51;
  - interpreter: 0.23;
  - scoring: 0.08.
  - At sim 4×: Rapier 2.42 + 1.10, world 1.26, `binding.ts` and other core 1.03, session 0.76, interpreter 0.54.
- **The busiest source in every Kiểm tra 4×** is `src/ui/robot3d/camera-studio.ts`:
  - gpu-high: 1415 ms of 35 s, 867 MiB allocated;
  - ss-low-4x: 3992 ms of 37.8 s, 979 MiB;
  - school: 6661 ms of 41.6 s, 1079 MiB.
  - It also appears in mini-mission runs: school 260 ms per 8 s, 44 MiB.
- **The profiler inflates long tasks.** The profile pass counts more long tasks over 100 ms (19–25 per check) than the fps pass
  (1–5). Long tasks are read from the fps pass.

### 2.4 Loading (fps pass; ms on the lesson page's clock)

| profile · scenario | first frame | RobotLab.js loaded | renderer made | GLBs parsed | compileAsync | first scene render ends | TTI | long tasks before, total (max) |
|---|---|---|---|---|---|---|---|---|
| gpu-high · line-follow | 945–948 | 177–180 | 562–565 | 532–537 | 645–651 → 707–715 | 742–760 | 742–760 | 194–197 (119–122) |
| gpu-high · idle (new browser) | 976–1787 | 212–310 | 730–847 | 709–862 | 825–1184 → 869–1236 | 914–1277 | same | 390–496 (181–227) |
| ss-low-4x · line-follow | 2601–2622 | 483–521 | 1139–1146 | 1266–1280 | 1472–1483 → 1525–1534 | 2087–2110 | 2319–2399 | 1326–1383 (561–568) |
| ss-low-4x · idle (new browser) | 4898–4932 | 506–508 | 3203–3220 | 3335–3352 | 3540–3554 → 3590–3602 | 4386–4420 | 4832–4896 | 1746–1780 (776–810) |
| school · line-follow | 3152–3335 | 693–723 | 1588–1627 | 1782–1820 | 1966–2162 → 2037–2232 | 2634–2818 | 2872–3057 | 2007–2169 (574–585) |
| school · pins, cpp, switch (faster stretch) | 2357–2528 | 452–496 | 1070–1210 | 1195–1347 | 1404–1549 → 1452–1601 | 1844–2015 | 2023–2195 | 1113–1352 (380–402) |
| school · idle (new browser) | 5297–5377 | 698–727 | 3513–3561 | 3708–3762 | 3918–3973 → 3987–4047 | 4779–4857 | 5222–5298 | 4183–4293 (1984–1986) |

- **Cold.** On SwiftShader, a new browser makes the renderer about 1.9 s later (3.2–3.6 s against 1.1–1.6 s). In these
  `39a877d` cells the GLB parse took 2.1 s against 0.3 s. Context creation in a cold GPU process falls in the same span, which was
  not traced cold. A real learner pays this once per browser session.
- **Profile pass** (school, CPU loop 95–105 ms): first frame 2.0–2.1 s. Main-thread self time before it is 1.75–1.96 s: three
  0.70–0.82 s, Blockly 150–200 ms, browser 210–250 ms, src/ui/robot3d 150–240 ms (camera-studio 51–128 ms), react-dom 70–88 ms,
  R3F 60–74 ms.
- **Traces.** `spikes/p2-perf3d/loading-trace.mjs` gives the long tasks with what ran in them (§3.3).

### 2.5 Memory

- **GPU memory** (probe estimate, line-follow):

  | tier | total | textures | geometry | shadow map | drawing buffer |
  |---|---:|---:|---:|---:|---:|
  | high | 54.4 MB | 22.3 | 3.6 | 16.0 | 12.5 (MSAA 4×) |
  | low | 9.6 MB | 4.7 | 2.3 | 0 | 2.5 |

  - Biggest textures on high: the mat's colour canvas at 1360 × 1120 (8 px/cm, anisotropy 8), the PMREM at 768 × 1024, the birch
    at 2048 × 256.
  - The low tier's mat is 850 × 700, still with anisotropy 8.
- **Soak, gpu-high, 3 × 10 min** (sandbox, the loop line followed, 2 runs each):
  - heap after GC 20.93 → 20.51, 21.11 → 20.58 and 20.93 → 20.35 MiB: −2.0 to −2.8 %;
  - 3511–3562 frames a minute;
  - p95 17.3–17.8 ms in every minute;
  - geometries and textures 80 / 22 at the end, 1 live context.
- **Soak, school, 3 × 10 min, on master `b5c8727` with the overlays on** (the distance tag repaints while the robot drives the
  sandbox's loop; 2 runs each):
  - heap after GC 20.03 → 19.58, 20.03 → 20.07 and 20.02 → 19.65 MiB: −2.2 %, +0.2 %, −1.8 %;
  - geometries and textures 45 / 17 at the end, 1 live context;
  - 2029–3563 frames a minute;
  - p95 18.5–19.2 ms in quiet minutes and up to 52–68 ms in the minutes when other agents (and my own `pnpm verify`) loaded the
    machine to 14–21. Those slow minutes starved SwiftShader, as in §3.1.
- **Switches**, growth from the first sample to the last:

  | profile | switches | heap | listeners | live contexts | geometries, textures, programs | DOM documents |
  |---|---|---:|---:|---:|---|---:|
  | gpu-high | 20 × 2D ↔ 3D | +3921–3923 KB | +19 | 0 | 0 | 0 |
  | gpu-high | 20 × tier | +1578–1606 KB | +18 | 0 | 0 | 0 |
  | school | 20 × 2D ↔ 3D | +3423–3481 KB | +19 | 0 | 0 | 0 |
  | school | 20 × tier | +1569–1638 KB | +18 | 0 | 0 | 0 |
  | both | 10 × scenario | +16–208 KB | 0 | 0 | differ by pilot | 0 |

### 2.6 Bundle and serving

- **Chunks (gzip -6).**
  - `RobotLab-*.js` 370.0 kB holds three, R3F, GLTFLoader and the meshopt decoder.
  - The entry `index-*.js` (145.8 kB) and the shared `test-hooks-*.js` (409.5 kB) hold none of them.
  - `rapier-*.js` 52.1 kB plus the wasm (1180.6 kB) load on the first Run.
- **GLBs.** `robot-kit.glb` 827 kB (369 kB gzip) and `arena-props.glb` 303 kB (150); the low pair is 495 (197) + 195 (83).
- **`vite preview` headers.** Every file is `Cache-Control: no-cache` with an ETag, so each visit revalidates. JS is gzip-encoded;
  `.glb` and `.wasm` are sent uncompressed (1.13 MB and 3.1 MB). The production host's headers are not known here.

### 2.7 The merged master (R4.7 + R4.3), the real target

- **What was run.** I rebased the branch onto master `b5c8727` (clean: my commits touch only `scripts/`, `spikes/` and
  `package.json`) and measured the same way, with R4.3's sensor overlays on, their default.
- **Load and CPU.** Load 1.6–9.2, mostly 2–7, a quieter stretch than §2.2. CPU loop: school 92–102 ms, ss-low-4x 59–67, GPU
  16–25.
- **Files.** `results/bench-robot3d-master-fps-*.md` (with switches), `-master-fps-sim4x-*`, `-master-profile-*`, and
  `results/master-ab/` (overlays on and off, against pre-R4.7, the school soak).

**Budgets on master.**
- The 3D chunk is **378.5 kB** gzip, +8.5 kB for R4.3.
- gpu-high runs: median 59.9–60.2 fps.
- ss-low-4x: p5 ≥ 54.1 fps.
- Run → moving ≤ 44 ms.
- First Run at 4× ≤ 278 ms.
- 0 draws at rest in 99 windows.

| profile · scenario (master) | fps | p5 fps | frame p95 (p99) ms | main thread p50 / p95 ms | draws | long tasks (> 100), max ms | GPU process ms/frame (cores) | tag spot changes/s |
|---|---|---|---|---|---|---|---|---|
| gpu-high · line-follow | 59.9–60.2 | 53.8–54.6 | 18.3–18.6 (19.3–19.6) | 1.5–1.9 / 4.2–4.6 | 84 + 51 | 0 | 1.6–1.9 (0.10) | 0 |
| gpu-high · mini-mission | 60.2 | 53.2–54.1 | 18.5–18.8 (19.3–19.8) | 1.7–1.8 / 4.4–4.6 | 83 + 54 | 0 | 1.9 | 1.4 |
| gpu-high · check-4x | 59.9–60.2 | 52.6–54.1 | 18.5–19.0 (20.6–21.0) | 2.0–2.5 / 4.7–4.9 | 85 + 54 | 1 (0), 50–51 | 1.0–1.1 | 1.4 |
| gpu-high · follow / teleop | 59.9–60.2 | 54.3–55.6 | 18.0–18.4 | 2.6–3.1 / 3.8–4.5 | 76–83 + 51–54 | 0 | 2.4–2.7 | 0 |
| ss-low-4x · line-follow | 60.2 | 54.9–55.2 | 18.1–18.2 (18.7–18.9) | 2.5–3.1 / 4.6–5.3 | 48 | 0 | 99–100 (5.9–6.0) | 0 |
| ss-low-4x · check-4x | 59.2–59.9 | 20.4–51.5 | 19.4–49.1 (51–165) | 3.9–4.1 / 7.1–8.3 | 49 | 1 (1), 200–201 | 64 (3.5–3.8) | 1.2–1.3 |
| ss-low-4x · teleop | 59.9–60.2 | 55.2–55.6 | 18.0–18.1 | 3.2–3.4 / 4.5–4.9 | 43 | 0 | 130–133 (7.8–8.0) | 0 |
| school · line-follow | 59.9–60.2 | 50.5–51.8 | 19.3–19.8 (20.4–21.1) | 3.7–4.8 / 7.1–8.8 | 48 | 0 | 100–107 (6.0–6.4) | 0 |
| school · mini-mission | 59.9–60.2 | 50.5–51.8 | 19.3–19.8 (20.8–21.2) | 3.6–4.8 / 7.3–8.5 | 47 | 1 (0), 51–53 | 98–101 (5.9–6.0) | 1.4 |
| school · check-1x | 59.9–60.2 | 52.9–53.2 | 18.8–18.9 (19.8–20.6) | 4.4–4.8 / 8.1–8.7 | 47 | 1 (0), 52–65 | 98–102 | 1.4 |
| school · check-4x | 59.9–60.2 | 42.2–46.7 | 21.4–23.7 (80.6–85.9) | 6.0–7.1 / 10.8–12.9 | 49 | **20 (1), 316–332** | 58–63 (3.3–3.7) | 1.4–1.5 |
| school · follow / teleop | 59.9–60.2 | 53.2–55.9 | 17.9–18.8 | 3.8–5.6 / 7.1–9.2 | 42–43 | 0 | 91–127 (5.5–7.6) | 0 |

- **First frame on master.**
  - Warm: GPU 908–1000 ms; ss-low-4x 2068–2128 ms; school 2375–2575 ms (CPU loop 93–102).
  - Cold (a new browser): ss-low-4x 3452–3563 ms; school 3821–3826 ms.
  - Pre-R4.7 master, interleaved: §3.9.
- **A probe caveat on master.** R4.3's overlay draws while the models still load, so the probe's "first scene render" and the TTI
  derived from it come before `compileAsync` there. The first frame (the lab's own `data-drawn`) is the figure to read.
- **Draws.** The overlays add 3–4 screen draws: high 80 → 84, low 44 → 48. The low tier's programs go from 10–12 to 12–13.
- **Memory on master.**
  - 20 × 2D ↔ 3D: +3536–4033 KB and +19 listeners. That is 186–212 KB per mount: the same OrbitControls leak (§3.6).
  - 20 × tier: +1546–1636 KB, +18 listeners.
  - Scenario switches: −15 to +60 KB.
  - No growth in contexts, geometries, textures, programs or documents.

### 2.8 Master `16407b8` (R8-a11y) against `b5c8727`

- **What changed.** R8-a11y touches the render path in a few places:
  - one-hunk edits in `Scene.tsx`, `ZoneTags.tsx`, `mat-paint.ts`, `ArenaView.tsx` and `TopView2D.tsx`;
  - zone patterns painted once into the mat (`zone-pattern.ts`);
  - `CameraRig`'s per-frame `dataset.camera` write made dev-only;
  - the covered scene `inert`.
- **Method.** `spikes/p2-perf3d/master2-ab.sh` runs both builds interleaved, 3 rounds, on the cells the findings rest on. Load
  2.4–7.9; CPU loop school 91–98, ss-low-4x 63–65, GPU 17–25 ms. Results are in `results/master2-ab/`.
- **Result: equal within the spread on every cell.**
  - The findings above hold for `16407b8` unchanged.
  - Each invocation launched a new browser, so ss-low-4x line-follow, the first cell of its browser, is a cold first frame here.

| cell | build | p95 (p99) ms | main p50 ms | long tasks (> 100), max | GPU process ms/frame | first frame ms |
|---|---|---|---|---|---|---|
| school · line-follow | `b5c8727` / `16407b8` | 19.0–19.3 (19.9–20.4) / 18.9–19.2 (19.9–20.4) | 3.8–4.8 / 3.8–4.4 | 0 / 0 | 100.6–106.6 / 102.7–107.0 | 2406–2482 / 2345–2397 |
| school · mini-mission | | 18.8–19.0 / 18.9–19.1 | 3.6–3.8 / 3.7–4.3 | 1 (0), 52–53 / 1 (0), 52–54 | 99–101 / 97–100 | 2374–2450 / 2373–2428 |
| school · check-4x | | 20.2–22.3 (76–80) / 21.0–21.4 (79–80) | 5.3–6.1 / 5.3–5.9 | 19–20 (1), 312–316 / 20 (1), 311–319 | 63–64 / 62–64 | 2379–2438 / 2369–2422 |
| school · idle (new browser) | | 18.0–18.4 / 18.0–18.1 | 2.0–2.3 / 1.7–2.2 | 0 / 0 | 83–93 / 87–91 | 3815–4551 / 3987–4029 |
| ss-low-4x · line-follow (cold) | | 18.0–18.2 / 18.3–18.5 | 2.4–2.9 / 2.6–3.6 | 0 / 0 | 99–104 / 100–106 | 3471–3489 / 3471–3476 |
| gpu-high · line-follow | | 18.1–18.3 / 17.8–18.3 | 1.9 / 1.8–2.0 | 0 / 0 | 1.9 / 1.8–2.1 | 964–975 / 963–969 |
| gpu-high · idle | | 17.4–17.5 / 17.2–17.5 | 1.3–1.4 / 1.2–1.4 | 0 / 0 | 2.0–2.2 / 1.9–2.2 | 1052–1098 / 1068–1094 |

- **The listener leak on `16407b8`** (gpu-high, 20 × 2D ↔ 3D): +4167 KB and +19 listeners. It is unchanged.

## 3. Audit

### 3.1 On a computer without a GPU, the picture costs more than everything else

- **Measured.** With SwiftShader, the browser's software renderer, the GPU process uses 95–170 ms of CPU per animation frame on the
  low tier at 60 fps on `39a877d`, and 81–133 ms on master. That is 5–10 M4 Pro cores.
  - Over the same frames the lab's main thread uses 2–10 ms (p50), and the whole renderer process 14–20 ms.
  - Per scenario on `39a877d` (ss-low-4x and school agree, since the throttle does not touch the GPU process):
    - a moving run in the free view: 116–125 ms;
    - an orbit drag: 110–113 ms;
    - "Theo xe": 111–121 ms;
    - teleop in the sandbox: 119–170 ms.
  - On the GPU the same frames cost the GPU process 1.6–2.7 ms.
  - R4.7's modelled scene made it 1.7× pre-R4.7 master's procedural one: 58.6–58.8 → 96.0–104.8 ms per frame, interleaved, §3.9.
- **Starved, measured by accident.** When the machine's other work left SwiftShader 0.4–0.5 cores (load 18–22), the school
  profile's low tier drew at 5.8–6.2 fps, with frame p95 270–730 ms. With 1.9–2.2 cores it drew 23–25 fps. In both, the main
  thread's time per frame (11–12 ms p50) stayed far below the frame time. That is what a computer without a GPU and with few free
  cores sees.
- **What a real one would get.** This is an estimate, not a measurement. Give a 4-core school CPU cores half as fast as the M4's,
  and it needs about 2 × 110 / 4 ≈ 55 ms of wall time per frame for the raster alone, at best. That is under 20 fps, before the main
  thread's share.
- **When SwiftShader applies.** Chrome uses it only when the GPU is blocklisted or absent: a VM, RDP, or a GPU without a usable
  driver. An integrated GPU with a working driver takes the GPU path, whose cost here is about 2 ms. Which case the school PCs are in
  is not known (§7). The 6× CPU profile says nothing about this cost.
- **Levers on the low tier** (A/B in §4):
  - fewer frames, a run drawn at 30 fps: −40–50 %, measured;
  - fewer pixels, 0.75 DPR: −18–22 % on teleop, inside the spread on line-follow;
  - the mat's anisotropic filtering: no gain, measured;
  - cheaper fragments (Lambert's three lights and fog): not tried, since it would change the look.
  - Falling further back is the frame watch on the low tier, lowering frames, then pixels, then offering the 2D map when even low
    is slow. Today `frame-watch.ts` only moves high to low.

### 3.2 The free view reframes on every HUD resize, and each reframe is an expensive search

- **Where.** `CameraRig.tsx`'s effect on `safe` recomputes `freeViewPose` and moves the camera when all of these hold, during a run
  or a check too:
  - the HUD's or the view tools' corner changed by more than 0.01 NDC (`hud-corner.ts` `sameCorner`);
  - the view is "Tự do";
  - the learner has not touched the camera.
- **How often** (`spikes/p2-perf3d/hud-resizes.mjs`, GPU):
  - The HUD's height toggles between 181, 186 and 191 px, because a goal's progress bar (`Hud.tsx`, shown while a goal
    has progress and is not yet passed) appears and goes.
  - The camera was framed again 6 times in 15 s of a mini-mission run, and 19 times in one Kiểm tra 4× of mini-mission.
  - Each reframe moves the camera with a jump (`camera.position.set`), not a glide.
- **What it costs** (`free-view-cost.mjs`, `framing-fast.mjs`; Node 24, M4 Pro, warm JIT, mean of 40 calls):

  | pilot | ms per call |
  |---|---:|
  | drive-to-zone | 0.87–0.93 |
  | stop-at-wall | 0.84–1.09 |
  | servo-gate | 1.21–1.26 |
  | square-route | 1.68–1.98 |
  | line-follow | 6.0–6.1 |
  | sandbox | 6.4–6.6 |
  | mini-mission | 11.7–12.4 |

  - In the browser: §2.3, and 93 ms at CameraRig's mount on the school trace.
  - Why: `framePoints` bisects the distance 11 times with 40+ steps each. Each step projects every point: the start's
    surroundings, the route sampled every 5 cm, the goals and their tags, the bodies. That happens for up to 5 + goals framing
    choices. `projectToScreen` normalises the pose and builds the camera's axes again for every point, with three new arrays each
    time.
- **The same answer, cheaper** (`spikes/p2-perf3d/framing-fast.mjs`). The fit test makes the axes once per pose, makes no array per
  point, and stops at the first point outside:
  - 5.5–10.6× faster (mini-mission 12.4 → 1.2 ms);
  - every pose identical to the last digit, for four HUD heights in all 7 arenas;
  - `camera-studio.test.ts`'s 18 tests pass unchanged with it.
  - A memo of the pose per scene and safe rect makes a HUD that toggles between heights frame once per height.
  - Not reframing while a run or check goes on (or gliding instead) also removes the mid-run jump.

### 3.3 The first frame without a GPU waits for every shader link

**Trace** (`loading-trace.mjs`, school, second visit, load 3.6–5.8; first frame 3247 and 3332 ms):

| at (ms) | task (ms) | what runs in it |
|---:|---:|---|
| 150 | 320–331 | the entry: Blockly's bundle evaluated (91–93), zod schemas (59–63), rolldown runtime |
| 653 | 117 | the RobotLab chunk evaluated |
| 889–896 | 342–363 | Blockly's workspace injected (194–216); react-use-measure 80–84 (R3F measuring the canvas: a forced layout) |
| 1386–1470 | 83 + 38 | GLTFLoader parse with meshopt decode |
| 1509–1537 | 215–225 | the free view's framing at CameraRig's mount: camera-studio 93 (`room` 37, `projectToScreen` 29, `axesOf` 6, GC 11); R3F 47–54 |
| 1797–1838 | 48–54 | `createTextureSet`: the mat's fibre normal map (fbm 256², `pixels.ts` 31–36), made on the low tier, which never uses it |
| 1845–2029 | 98 + 71 | robot and arena assembly (three.core 59 + 39, `merge.ts` 9 + 10, BufferGeometryUtils) |
| 2029 | 80 | `compileAsync` |
| 2122–2186 | **606–629** | **the first scene render: 542 ms in three's `onFirstUse`** (the program-link waits) |
| 2771–2856 | 196–242 | the next render, when the tags appear (three.module.js 186–234; no program is added, §5, item 5) |

- **Why.** `onFirstUse` (`three.module.js:7022`) runs the first time a program is used. It makes three kinds of synchronous
  queries, and each one waits for that program's link:
  - the diagnostics, when `renderer.debug.checkShaderErrors` is on (the default): `getProgramInfoLog`, `getShaderInfoLog`,
    `getProgramParameter(LINK_STATUS)`;
  - always, the uniform locations: `new WebGLUniforms`, with `ACTIVE_UNIFORMS`, `getActiveUniform`, `getUniformLocation`;
  - always, the attribute locations.
- **Why `compileAsync` does not help here.** Without KHR_parallel_shader_compile, three marks every program ready at once
  (`programReady = (parameters.rendererExtensionParallelShaderCompile === false)`). So `compileAsync` resolves before anything is
  linked, and the first render waits on each link in turn.
  - The probe reads `parallelCompile: false` on SwiftShader and `true` on ANGLE Metal, where the GPU trace shows no such task.
  - The 10–12 low-tier programs are all compiled by the first scene render: the program count is the same at the end of every
    cell.
- **Turning the diagnostics off does not shorten it** (A/B §4: the first scene render 378–427 against 380–418 ms). The location
  queries wait just as long.
- **What can help** is starting the links earlier: issue the programs' compiles while the main thread still has work of its own,
  so that the GPU process links in parallel. That work is the arena and robot assembly (169 ms), the free view's first framing
  (93 ms) and the mat's canvases. For example, compile the GLB templates' materials as soon as the files parse, before assembly.
  Not measured yet: Phase B A/Bs it (§5, item 5).
- **Other parts of the critical path.**
  - Blockly's injection and the forced layout during it: 342–363 ms.
  - The entry's evaluation: 320 ms.
  - Neither is 3D, but both sit before the first 3D frame.

### 3.4 Render path

- **Draws.**
  - High: 77–81 to the screen plus 49–54 to the shadow map (126–135). Low: 37–45. Budget 200 / 350.
  - Meshes: 87 on high (77 visible, 53 casting shadows); 49 on low (38–39 visible).
  - Static parts are already merged by material (`merge.ts`). Nothing repeats enough for instancing to pay.
  - Culling is three's default; the merged bounds are large, so nearly all meshes are drawn.
- **Shadow map** (high: PCF 2048², radius 2.5, `autoUpdate` true).
  - It is redrawn on every drawn frame. That includes frames where only the camera moved: the orbit drag drew 51 shadow draws in
    every one of its frames.
  - Its CPU cost is 0.19–0.23 ms per frame in a run and 0.35–0.49 ms under "Theo xe" and teleop. Its GPU cost was not measurable
    here.
  - Option: `autoUpdate=false` with `needsUpdate` when a caster moved (the robot, a moving body). This saves the pass on
    camera-only frames, not in a moving run.
  - Option: one shadow-only proxy per group (merged geometry, `colorWrite: false`, the parts' `castShadow` off), taking about 50
    shadow draws below 10. three filters the shadow pass by the main camera's layers (`WebGLShadowMap.renderObject`:
    `object.layers.test(camera.layers)`), so a layer-only proxy does not work.
- **PMREM.** RoomEnvironment is made into a PMREM on every high-tier canvas mount: 34 off-screen renders, 38–50 ms on the GPU. Its
  texture is 768 × 1024 HalfFloat, about 6 MB.
- **Anisotropy.** GLB textures use it on high only (R4.7 M6). The mat's colour map still uses `min(8, max)` on both tiers
  (`GltfArena.useMatTextures`). Turning it off on low gave no measurable gain (A/B §4).
- **Textures.**
  - Every GLB image is an `ImageBitmap`, so it is decoded off the main thread.
  - The mat's three canvases are painted on the main thread, the roughness one on low too, where Lambert never reads it.
- **GLB parse.** 23–40 ms on the GPU, 190–450 ms on SwiftShader at 4–6×, 2.1 s cold. The fetch is done before the renderer exists,
  so it is never on the critical path.
- **Tags.** 2–5 sprites, laid out in `useFrame` on every drawn frame. `placeTags` spreads `[...avoid, ...taken]` for every spot of
  every tag, and `ZoneTags` makes two `Vector3`s each frame. Part of "scene callbacks": 0.10–0.26 ms (GPU) and 0.48–1.13 ms (school)
  per frame. `zone-tag-layout.ts` allocates 4–5 MiB per 8 s of mini-mission. No hysteresis: 1.4–2.9 spot changes/s (§3.9).
- **Demand loop.**
  - 0 draws per second at rest in 135 windows, the soak's included.
  - An orbit settles 1.16–1.28 s after the drag.
  - While the models load, R3F draws an empty scene once (0 screen draws).
- **DPR.** High caps at 1.5, so a DPR-2 laptop draws 990 × 745 with MSAA 4×. Low uses 1. Neither cost is measurable on the M4's
  GPU.
- **LOD.** Low draws 36 k triangles a frame against 157 k on high (the shadow pass included).

### 3.5 Main thread

- **Sim.**
  - School 1×: 3.2–4.1 ms per frame, 2 ticks. School 4×: 7.0–7.3 ms, 8 ticks. Half of it is Rapier (wasm plus JS glue).
  - Rapier's step and the world's contact and goal-frame work are the bulk. Changing them changes the determinism hashes, which
    Phase B may not do.
  - The sim allocates 130–140 KB per frame at 1× and 360 KB at 4×, P1's 65–75 KiB per tick, in the browser. It is collected
    young: GC is 0.05–0.12 ms per frame at school 1× and 0.11–0.28 at 4×.
- **three render** (CPU side): 0.8–1.0 ms per frame on GPU high for 126–135 draws, 1.3–1.6 ms on school low for 44 draws.
- **React.**
  - The HUD's clock in tenths gives about 10 commits/s in a run, about 30 at sim 4×.
  - The pins tab adds 10 Hz (R4.5's throttle), 20–23 commits/s in all. Kiểm tra's progress makes 30–34.
  - React's own time is 0.06–0.25 ms per frame on GPU and 0.3–0.9 ms on school.
  - The pins tab costs most of React's time: school 0.72–0.92 ms, against 0.31–0.47 ms in a plain run.
- **Blockly highlight.** 0–0.05 ms per frame (100 ms throttle).
- **"Browser"** (style, layout, paint, GL submission): 1.3–2.4 ms per frame on school, highest with the pins tab (2.2–2.4).
- **Allocation by source.**
  - `camera-studio.ts` is by far the biggest where it runs (§3.2).
  - Otherwise three.module.js 5–18 MiB per 8 s (the render's lists and uniforms), Rapier's glue, `world.ts`, `units.ts`,
    `contacts.ts` and `ground-paint.ts`, at 4–7 MiB each per 8 s.
  - `applyRobotWorld` parses colour strings (`emissive.set('#000000')`) for every lamp and LED on every frame.

### 3.6 Memory: one listener and its scene leak per 3D canvas mount

- **Measured.** `spikes/p2-perf3d/listener-leak.mjs`, CDP `DOMDebugger.getEventListeners` on the lab frame's window and document,
  6 switches of 2D ↔ 3D:
  - `document keydown (capture)` went from 1 to 7, one per switch;
  - everything else changed once (the 2D map's first mount adds window mouse and touch listeners and a `visibilitychange`).
- **Cause.** three's OrbitControls:
  - `connect()` (`OrbitControls.js:506`) adds `_interceptControlDown` on `this.domElement.getRootNode()`, which is the document
    while the canvas is attached.
  - `disconnect()` (`:527`) removes it from `getRootNode()` again. `CameraRig`'s effect cleanup calls `controls.dispose()` when
    R3F unmounts the scene, after the canvas has left the document. By then `getRootNode()` is the detached subtree, so the removal
    misses.
  - The listener keeps the controls, their camera and the old canvas reachable: 180–206 KB a mount on `39a877d`, 186–212 on
    master. GPU resources are freed anyway (R3F's `forceContextLoss`, `releaseGpu`).
- **Where it bites.** Every 2D ↔ 3D switch, tier change, auto-downgrade and "Thử lại 3D" leaks once. A learner who switches 50
  times holds about 10 MB more. The `keydown` handlers are cheap, but they add up.
- **Fix** (Phase B, S). Capture the root at creation and remove the listener from it in the cleanup, or dispose the controls
  before the canvas detaches. A test mounts and unmounts the rig and counts the document's listeners.
- **Everything else is clean.**
  - 0 growth of live WebGL contexts, geometries, textures, programs or DOM documents.
  - Scenario switches (a new lab document) grow the heap by 16–208 KB in 10, with no growing listeners.
  - Soaks are flat (§2.5).

### 3.7 Loading

- **Bundle split is right.** GLTFLoader and the meshopt decoder are only in `RobotLab-*.js`, the lazy 3D chunk; the entry and the
  shared chunk hold none of three, R3F, GLTFLoader, meshopt or Rapier.
- **Preload.** The GLBs are fetched when `SceneHost` mounts (R4.7) and arrive before the renderer exists, at 470–480 ms on the GPU
  and 820–1170 ms on SwiftShader. They are not on the critical path.
- **Caching.**
  - The GLB URLs carry `?v=<hash>` and the JS names are hashed, so a host can cache them immutably.
  - `vite preview` sends `no-cache` and leaves `.glb` and `.wasm` uncompressed.
  - The deployment documentation should ask for `Cache-Control: public, max-age=31536000, immutable` on `/assets/*` and
    `/robot3d/*`, and gzip or brotli for `.glb` and `.wasm`. That takes the first visit's 1.13 + 3.1 MB to about 0.52 + 1.18 MB.
- **What blocks the first frame:** §3.3.

### 3.8 Web Worker for the simulation: not recommended now

**Measured.**
- School 1×:
  - the sim is 3.2–4.1 ms of a 6.9–9.7 ms busy frame;
  - p95 frames 19–20 ms in plain runs, met.
- School 4× (8 ticks):
  - the sim is 7.0–7.3 ms of a 10.6–11.1 ms busy frame;
  - p95 18.8–20.2 ms, which meets the 33 ms target;
  - 0 long tasks.
- At 4× the sim alone stays well inside a 16.7 ms frame, so moving it would not change a frame time that already meets the target.
  The 4× check misses its target because of §3.2, not the sim.
- A worker would cut the main thread to about 4 ms a frame at 4×. That is headroom for a slower real PC than the 6× profile, not a
  fix for a measured miss.
- A worker's per-frame message would be cheap (`snapshot-clone.mjs`): a RobotRunSnapshot is 2.3–2.6 kB, and `structuredClone`
  takes 23–26 µs on the M4, about 0.15 ms at 6×.

**Cost and risk if it is ever needed.**
- **Effort: L, 3–5 days.** It needs a worker host and protocol, and checkRobot in the worker.
- **Risk: medium-high.**
  - The run store, check store and tools store call the session synchronously in 36 places (`getSnapshot` in `shouldDrive` and
    `latestWorld`, `pressButton`, `teleop`, `placeRobot`).
  - The dev hooks and the determinism and check e2e read hashes through them.
  - There would be one frame (16.7 ms) of view latency.
- **Determinism.** The same `src/core` and the same deterministic wasm run in the worker, and the main thread still supplies
  `wallMs`. A parity e2e comparing hashes with the worker on would have to prove it.

**Revisit if** a real school PC's main thread misses the 33 ms target once §5's items are in.

### 3.9 The coordinator's carries (R4.7 review, R4.3)

#### R4.7: per-frame allocations in the zone-tag layout (`ZoneTags.tsx:165-227`, `zone-tag-layout.ts:42,62-66`)

Measured by the sampling heap profiler, by source:
- `ZoneTags.tsx` allocates 3.1–4.6 KB per frame in every run with tags. Per frame it makes:
  - two `Vector3`s, the `project` closure and its arrays;
  - the `corners` array, the `avoid` array;
  - `toPlace` with each tag's `anchors`.
- `zone-tag-layout.ts` allocates 3.2–11.3 KB per frame, most in mini-mission with its five goals: `[...avoid, ...taken]` for every
  spot of every tag (line 42), and `boxOf`'s `xs`/`ys` and their spreads (lines 62–66).
- Together that is 6–15 KB/frame, about 0.4–0.9 MB/s at 60 fps, against 140–255 KB/frame for the whole page. It is young garbage;
  GC is 0.04–0.12 ms per frame in a school run.
- Phase B item 4 removes it: reused buffers, a loop over `avoid` and `taken` without spreading, `boxOf` in one pass.

#### R4.7: no hysteresis in the tag layout

- **Measured.** The probe counts a frame whose tags' spots differ from the frame before. On master:
  - **1.4–1.5 spot changes/s** during mini-mission runs and checks;
  - **2.7–2.9/s** while the free view is orbited;
  - about 0 in line-follow, "Theo xe" (no tags) and teleop.
- **The cause.** `placeTags` tries the 15 spots in the same order every frame, so a tag at a boundary between two spots flips with
  every small move of the robot or the camera.
- **Item 4.** Try last frame's spot first, and move only when it overlaps something. A test: a robot and camera inching across
  the boundary keep the spot.

#### R4.7: first frame on SwiftShader 4× about 2.6 s against master-before-R4.7's 1.3 s

- **Measured again, interleaved.** `spikes/p2-perf3d/master-ab.sh` ran 3 rounds of each, with load 4.2–7.2, CPU loop 64–66 ms in
  every cell, and the same harness:

  | build | first frame, warm (line-follow) | first frame, cold (a new browser) | GPU process ms/frame in a run | draws |
  |---|---|---|---|---|
  | master before R4.7 (`1211347`, procedural scene) | 1268–1281 ms | 2632–2652 ms | 58.6–58.8 | 44 |
  | master (`b5c8727`) | 2122–2143 ms | 3584–3622 ms | 96.0–104.8 | 48 |

- **Where the +0.85 s goes** (warm, master against `1211347`):
  - the renderer is made at about the same time (848–866 against 825–840 ms);
  - after it, master spends 1.27–1.29 s to the first frame against 0.44–0.45 s;
  - master has 7 long tasks before the first frame, 1156–1160 ms in all with the longest 382–388 ms (the first scene render's link
    wait at 4×), against 4 tasks, 449–460 ms, longest 215–221.
  - On the school trace (§3.3) the same span holds the GLB parse, assembly (169 ms), the free view's framing (93), the fibre map
    (31–36), `compileAsync` (80) and the render's link wait (542).
  - Items 1, 5a and 5b take about 0.15 s for certain at 6×, plus up to 0.25 s if overlapping the links works. Most of the rest is
    R4.7's modelled scene itself: its 11–13 programs and its geometry.

#### R4.3: the overlays on and off, re-measured

- **Method.** The lab's own "Hiện cảm biến" switch (`--sensors=off`), interleaved round by round with on. School profile:
  line-follow, stop-at-wall (the ultrasonic beam in view) and check-4x. gpu-high: line-follow and stop-at-wall. Load 4.6–24.9.
- **The busy rounds starved SwiftShader.** In round 1 the other agents left SwiftShader 0.4–0.5 cores, and both arms drew line-follow
  at 5.8–6.2 fps. Those cells are left out of the comparison; they are §3.1's point measured.

| profile · scenario | overlays | p95 ms | main p50 ms | GPU process ms/frame | screen draws |
|---|---|---|---|---|---|
| school · line-follow (rounds 2–3) | on | 19.4–21.7 | 4.6–6.0 | 86–97 | 44–48 |
| | off | 19.3–19.6 | 4.4–4.9 | 90–100 | 40–44 |
| school · stop-at-wall | on (rounds 1–3) | 19.9–20.2 | 3.7–4.9 | 61.7–63.7 | 41 |
| | off (rounds 2–3) | 19.6–19.9 | 3.8–4.5 | 56.6–61.4 | 37 |
| gpu-high · line-follow | on | 17.7–18.4 | 1.3–2.9 | 1.3–2.3 | 84 |
| | off | 18.1–18.4 | 1.3–3.1 | 1.3–2.3 | 80 |
| gpu-high · stop-at-wall | on | 18.3–18.7 | 1.1–2.5 | 1.1–1.8 | 79 |
| | off | 18.2–18.5 | 1.2–2.7 | 1.0–1.8 | 75 |

- **Reading.** The overlays add 4 screen draws. Frame time and main-thread time are inside the spread. On SwiftShader the beam
  costs about 2–7 ms of GPU-process CPU per frame (stop-at-wall), roughly 4–10 %.
- **The 4× check** is dominated by item 1's framing in both arms (20–38 long tasks), so it says nothing about the overlays.

#### R4.3: the tag canvas painter's allocation (it needs a DOM)

- **Measured in the browser** (master, school profile, overlays on, sampling heap profiler with collected objects):
  - neither `parts/SensorOverlay.tsx` (the distance tag's canvas painter) nor `parts/sensor-overlay.ts` is among the 15 largest
    allocating sources of any run;
  - each allocates under 3.3 KB per frame in line-follow and under 4.2 KB in pins;
  - each takes under 0.07 ms per frame of self time in line-follow and under 0.14 ms in pins (below the 18 listed).
- **The soak** has the overlays on, painting the distance at up to 10 Hz while the robot drives the sandbox's loop: heap §2.5.
- **For Phase B.** A unit test of the painter needs a canvas (jsdom has none). The probe-level browser check above is the evidence,
  and an e2e assertion on `performance.memory` would be too coarse. I propose no test change.

## 4. A/B: candidate fixes against the same base build

- **Method.**
  - `spikes/p2-perf3d/ab-run.sh` builds each variant from `39a877d` plus one patch (`ab-patches.py`) into its own folder, then
    reverts `src/` at once. Nothing is committed.
  - It runs the base and each variant one after the other, 3 rounds, on the school profile (SwiftShader, CPU 6×), with a window of
    8 s (a whole check for check-4x).
  - Load was 4.3–16; CPU loop 94–102 ms in every cell.
  - Results are in `spikes/p2-perf3d/results/ab/`.
- **One discarded cell.** In `mat-aniso-low`'s first round the GPU process got only 1.9–2.2 cores against 4.2–7.7 for every other
  cell (other work on the machine). Those two cells ran at 23–25 fps. They are left out of the table, and they are kept as an
  accidental demonstration of §3.1: give SwiftShader two cores and the low tier draws at about 24 fps.

| variant | scenario | fps | frame p95 (p99) ms | long tasks (> 100), total ms | first scene render ms | GPU process ms/frame (cores) |
|---|---|---|---|---|---|---|
| base | check-4x | 59.9–60.6 | 20.8–24.0 (79–103) | 20 (1), 1331–1349 | — | 63.6–65.6 (3.6–3.8) |
| **framing** (fast fit test + pose memo) | check-4x | 59.9–60.2 | **19.9–20.0 (40–45)** | **1 (1), 314–317** | — | 62.9–64.5 |
| base | mini-mission | 60.2 | 18.9–19.7 | 1 (0), 54–58 | — | 85–99 |
| **framing** | mini-mission | 59.9 | 19.3–19.7 | **0** | — | 98–99 |
| base | line-follow | 59.2–60.2 | 18.6–21.0 | 0 | 380–418 | 73–105 (4.2–6.3) |
| **cap-30** (a run drawn every other display frame) | line-follow | 29.9–30.1 | 35.0–35.9 | 0 | — | **49.5–57.7 (3.0–3.5)** |
| low-dpr-075 (low tier at 0.75 DPR) | line-follow | 59.5–59.9 | 19.1 | 0 | — | 75.5–80.8 (4.5–4.9) |
| mat-aniso-low (mat without anisotropy on low; rounds 2–3) | line-follow | 60.2 | 19.2–19.6 | 0 | 378–397 | 101.1–101.9 (6.1) |
| no-shader-checks (`checkShaderErrors` off) | line-follow | 59.9–60.2 | 19.0–19.9 | 0 | **378–427** | 102.6–104.2 |
| base | teleop | 58.8–60.2 | 18.7–22.0 | 0 | — | 115.2–128.7 (6.6–7.7) |
| **cap-30** | teleop | 29.9–30.1 | 35.0–36.3 | 0 | — | **62.7–67.8 (3.8–4.1)** |
| low-dpr-075 | teleop | 59.9–60.2 | 18.6–19.3 | 0 | — | 93.8–100.8 (5.6–6.0) |
| mat-aniso-low (rounds 2–3) | teleop | 59.9 | 19.1–19.3 | 0 | — | 123.1–123.9 (7.4) |
| base / no-shader-checks / mat-aniso-low | idle (a new browser: the cold first frame) | 59–61 | 17.8–19.5 | 0 | 511–545 / 503–774 / 506–516 | 80–93 |

**What the A/B says.**
- **Framing**, Phase B item 1: confirmed.
  - It removes 19 of the 20 long tasks of a 4× check. Long-task time goes 1.33 → 0.31 s, frame p99 79–103 → 40–45 ms.
  - The last task over 100 ms (about 315 ms) is not the framing. A trace of the check on the framing build
    (`results/check-trace-school-framing.txt`) shows it is Rapier's first instantiation: 240–258 ms of wasm at 6×, at the check's
    first round (§5, item 1b).
  - mini-mission loses its 54–58 ms long task.
- **Fewer frames**, item 3: the strongest raster lever measured.
  - cap-30 almost halves the GPU process's CPU (line-follow 73–105 → 50–58 ms per animation frame, teleop 115–129 → 63–68).
  - Its frame time is 33.3 ms by construction: p95 35–36 ms, just over the P2 target of 33.
  - So a cap fits only as an automatic fallback when the low tier is slow, not as the default.
- **Fewer pixels:** 0.75 DPR saves less than its 44 % fewer pixels suggests. Teleop goes 115–129 → 94–101 ms (−18 to −22 %);
  line-follow is inside the base's spread. Part of the GPU process's work is per frame, not per pixel (vertices, compositing).
- **The mat's anisotropy on low: no measurable gain** (rounds 2–3 inside the base's range). Not proposed.
- **`checkShaderErrors` off: no gain.** The first scene render is 378–427 against 380–418 ms. three's uniform-location queries
  (`getActiveUniform`, `getUniformLocation`, made on a program's first use) wait for the link as the diagnostics did. **Dropped**
  from the list. The link wait has to be overlapped instead: §5, item 5.

## 5. Prioritised optimisation list (Phase B)

**How the list is ranked.** By measured gain on the school profile per day of work, weighted by risk. Each item is its own commit
with before/after `pnpm bench:robot3d` numbers and the load beside them. The visual guard applies to each: production screenshots of
the six pilots × high and low, plus the camera modes, pixel-diffed.

**About the "R4.7" mark.** It names files R4.7 wrote or changed. R4.7 is now on master, so a mark means shared ownership, not a
branch conflict. Phase B rebases onto master first.

| # | change | evidence | expected gain | risk | effort | files (R4.7 = R4.7's) |
|---|---|---|---|---|---|---|
| 1 | **Free view: the fit test made cheap with the same arithmetic, a pose memo per scene and safe rect, and no reframing while a run or check goes on.** (1b) The one long task left in a 4× check, about 315 ms, is Rapier's first instantiation (240–258 ms of wasm at 6×, `results/check-trace-school-framing.txt`). Warm the physics module after the first frame, at idle, so neither the first Run nor the first Kiểm tra pays it | §3.2; A/B §4; check trace | 4× check: long tasks 20 → 1 (framing) → 0 (1b); their time 1.33 → 0.31 → about 0 s; p99 79–103 → 40–45 ms; mini-mission's 54–58 ms task → 0. First frame −85 ms at 6× (93 → about 10 ms). First Run → moving shorter by the instantiation. No camera jump mid-run | low: same poses to the last digit, `camera-studio.test.ts` unchanged. The behaviour change (no mid-run reframe) needs a test. 1b moves Rapier's load earlier (bandwidth on the first visit), and the dist test must still find Rapier lazy | S (0.5 d) + S (0.5 d) | `camera-studio.ts`, `CameraRig.tsx` (R4.7); 1b: a `preparePhysics()` on the run session (`src/core/run/robot-run-session.ts`; the UI may not import `src/core/world/rapier`, lint rule), called by the lab at idle after the first frame |
| 2 | **The OrbitControls listener leak**: remove `_interceptControlDown` from the root captured at connect time, or dispose before the canvas detaches | §3.6 | per 3D mount: −1 document listener and −186–212 KB of heap (master). 20 switches: +3.5–4.0 MB → about 0 | low | S (0.25 d) | `CameraRig.tsx` (R4.7) |
| 3 | **A slow-low fallback for computers without a GPU**: the frame watch also on the low tier. When a run on low is slow, draw it at 30 fps (`invalidate()` without the priming), then offer the 2D map | §3.1; A/B §4 | SwiftShader's CPU per animation frame −40–50 % (line-follow 73–105 → 50–58 ms, teleop 115–129 → 63–68). Only where low is already slow, so 60 fps machines lose nothing | low–medium: a new state of the frame watch; the visual stays the same apart from frame rate | M (1 d) | `frame-watch.ts`, `Scene.tsx` `RedrawOnChange`, `SceneHost.tsx` (R4.7) |
| 4 | **Zones' tags without per-frame garbage, and with hysteresis** (R4.7 review): try last frame's spot first; no array spreads in `placeTags`; `boxOf` without its `map` arrays; reused `Vector3`s and arrays in `ZoneTags`' frame callback; skip the layout when neither the camera nor the robot moved | §3.4; profile allocations | 6.3–14.6 KB/frame less garbage (`ZoneTags.tsx` 3.1–4.5 + `zone-tag-layout.ts` 3.2–10.1 KB/frame); fewer tag jumps (spot changes/s: §2 on master) | low (`zone-tag-layout.test.ts` holds the spots) | S (0.5 d) | `parts/ZoneTags.tsx`, `parts/zone-tag-layout.ts` (R4.7) |
| 5 | **The first frame without a GPU:** (a) start the programs' links earlier, by compiling the GLB materials as soon as the files parse; (b) skip the low tier's unused fibre normal map and roughness canvas; (c) find the 196–242 ms render after the tags appear | §3.3 | (b) −31–36 ms at 6×; (a) up to the overlap with assembly and framing (about 250 ms at 6×), to be A/B'd; (c) unknown | low (b); medium (a): its programs must equal the scene's | S (b), M (a) | `assets/textures.ts`, `parts/GltfArena.tsx`, `Scene.tsx` (R4.7) |
| 6 | **Shadow map only when a caster moved** (`shadowMap.autoUpdate = false`, `needsUpdate` when the robot or a moving body changed) | §3.4 | high tier: the shadow pass's 49–54 draws and 0.2–0.5 ms CPU → 0 on camera-only frames (orbit, glide, tag relayout, a blinking LED). Not in a moving run | low (a missed update shows a stale shadow: tests on robot move, reset, mover) | S (0.5 d) | `Scene.tsx`, `lighting/StudioLighting.tsx` (R4.7) |
| 7 | **Small per-frame costs**: `applyRobotWorld` sets colours from prebuilt `Color`s instead of parsing strings | §3.5 | small (no number: under the profiler's resolution) | low | XS | `parts/robot-assembly.ts` (R4.7) |
| 8 | **Hosting**: the deployment doc asks for gzip or brotli on `.glb` and `.wasm` and `immutable` caching of `/assets/*` and `/robot3d/*` | §2.6 | first visit 1.13 → 0.52 MB GLB, 3.1 → 1.18 MB wasm; repeat visits revalidate nothing | none (docs) | XS | `docs/lab-embed-contract.md` or the deployment notes |

**Measured and not proposed:**
- **`checkShaderErrors` off**: no gain (§4).
- **The mat's anisotropy off on low**: no gain (§4).
- **The low tier at 0.75 DPR as the default**: −18–22 % on teleop only, at a visible cost to sharpness. It stays an option for #3's
  fallback chain.
- **A Web Worker for the simulation**: §3.8.
- **A baked static shadow**: it changes the look.
- **Rapier or world changes**: the determinism hashes must not move.

**Order for Phase B:** 1 → 1b → 2 → 4 (1, 2 and 4 are in R4.7's camera and tag files, done together) → 5b → 6 → 3 → 5a → 7 → 8.
1 and 2 are the measured misses (the 4× check's long tasks, the leak). 3 is the no-GPU answer and needs the owner's answer to §7's question to set
its thresholds.

## 6. Phase B targets: where each stands, and what should move it

School PC profile (c), low tier, unless noted.

| target | now: `39a877d` → master (§2.7) | what moves it | expected after Phase B |
|---|---|---|---|
| p95 frame ≤ 33 ms running at 1× | met: 17.8–30.7 → 17.9–19.8 ms | #1, #4 | met with more margin |
| p95 frame ≤ 33 ms at 4× | sim 4× 18.8–23.3 → 19.4–23.3 ms, met. **Kiểm tra 4×: 31–89 → 21.4–23.7** (p99 80–86) | #1 | met, p99 down too (the A/B gives p95 19.9–20.0 and p99 40–45) |
| 0 long tasks > 100 ms in a run | **1–5 → 1** (the 4× check); 20 long tasks of 50 ms or more in that check | #1, #1b | 0: #1 removes 19 of 20 (A/B), and #1b moves the last one, Rapier's first instantiation, out of the run |
| first frame ≤ 2.5 s | warm 2.0–3.3 → 2.38–2.58 s (CPU loop 93–102); **cold 5.3–5.4 → 3.82–3.83 s** | #1 (−85 ms), #5b (−35 ms), #5a (up to −250 ms) | warm about 2.0–2.4 s, met; cold over 2.5 s |
| heap growth ≤ 5 % over 10 min | GPU −2.0 to −2.8 % → school on master: §2.5 | — | met |
| 0 GPU-resource growth over 20 switches | GPU resources met on both; the heap leaks +3.4–4.0 MB through the listener | #2 | met, the heap included |
| GPU high p95 ≤ 20 ms | met: 17.2–18.0 → 18.0–19.0 ms | #6 helps on camera-only frames | met |

**Cold first frame.** It stays over 2.5 s because the renderer is made about 2.4 s in on master (3.2–3.6 s on `39a877d`) against
1.1 s warm, with the lab's chunk loaded at the same time (about 0.46 s) in both.
- The span between them is about 1.3 s longer cold.
- It holds the first WebGL contexts of a cold GPU process (SwiftShader's start), and in some runs a cold GLB parse: 0.24–2.1 s
  cold, against 0.2–0.3 s warm.
- Which part dominates was not traced cold.

If a target is not reached, Phase B reports the measured floor and why (the brief's rule). The cold first frame is the likely one.
One option to A/B in #5a's work: fetch the GLBs early, as now, but parse them after the canvas exists, so that the cold parse (meshopt
decode, a cold JIT) no longer comes before the context.

## 7. Not measured, open questions

- **Real hardware.** No real school PC or iGPU laptop. CPU throttling does not slow the GPU process, and SwiftShader here has 12
  fast cores.
  - **Owner question:** do the school PCs have a working GPU driver (Intel HD/UHD under Windows)? Or do they run Chrome on
    SwiftShader (no driver, a VM, RDP)? §3.1 matters only in the second case, and there it is the first problem.
  - One run of `pnpm bench:robot3d --profiles=gpu-high --scenarios=line-follow,check-4x` on one real school PC (a GPU) answers it.
    So does `chrome://gpu`.
- **GPU-side costs on high:** the shadow map raster, MSAA, the PMREM, fill rate at DPR 1.5.
- **Windows ANGLE/D3D11:** shader compile and parallel-compile support, and draw-call overhead (higher than Metal's).
- **Firefox and Safari** were not profiled (the harness is Chromium-only: CDP).
- **The production host's headers.**
- **Two tasks are named but not explained:**
  - the 196–242 ms render on the school trace when the zones' tags appear (no program is added; texture uploads are the
    likeliest);
  - the cold first frame's extra 1.3 s before the renderer exists.
  Phase B traces both before it changes anything there.

## 8. Files, commits, reproduction

- **Harness.**
  - `scripts/bench-robot3d.mjs` (`pnpm bench:robot3d`);
  - `scripts/lib/robot3d-probe.js` (page side);
  - `scripts/lib/profile-attribution.mjs` (source maps, buckets);
  - `package.json` (script).
  - Lint is clean; not part of verify.
- **Spikes** (`spikes/p2-perf3d/`):
  - `free-view-cost.mjs`, `framing-fast.mjs`, `hud-resizes.mjs`;
  - `snapshot-clone.mjs`;
  - `loading-trace.mjs` (with `--check` for a traced Kiểm tra);
  - `listener-leak.mjs`;
  - `ab-patches.py` and `ab-run.sh` (A/B on `39a877d`);
  - `master-ab.sh` (overlays on/off, against pre-R4.7, the school soak on master).
- **Results** (`spikes/p2-perf3d/results/`):
  - every run's JSON and MD: `final-*` on `39a877d`, `master-*` on `b5c8727`;
  - `ab/` and `master-ab/`;
  - `check-trace-school-framing.txt`;
  - `rehearsal-fps-high-load.log` (not cited).

```sh
pnpm bench:robot3d                                                                  # everything, 3 repeats (about 3 h)
node scripts/bench-robot3d.mjs --profiles=gpu-high,gpu-high-sim4x --pass=fps        # one profile group, frames only
node scripts/bench-robot3d.mjs --profiles=school --scenarios=check-4x --pass=profile # one cell under the profilers
node scripts/bench-robot3d.mjs --smoke --profiles=gpu-high                           # a minute: does the tool work
node scripts/bench-robot3d.mjs --report=a.json,b.json --label=merged                 # tables again from earlier results
node spikes/p2-perf3d/free-view-cost.mjs                                            # freeViewPose ms per call, per pilot
node spikes/p2-perf3d/framing-fast.mjs                                              # the cheaper fit test: same poses, ms per call
node spikes/p2-perf3d/hud-resizes.mjs                                               # HUD height changes in a run and a 4x check
node spikes/p2-perf3d/snapshot-clone.mjs                                            # a worker's per-frame message (size, clone µs)
node spikes/p2-perf3d/loading-trace.mjs --profile=school                            # what blocks the first frame (trace + samples)
node spikes/p2-perf3d/listener-leak.mjs                                             # the listeners a 2D <-> 3D switch leaves
zsh spikes/p2-perf3d/ab-run.sh                                                      # the A/B variants against the base (§4)
zsh spikes/p2-perf3d/master-ab.sh                                                   # master: overlays on/off, pre-R4.7 first frame, soak
node spikes/p2-perf3d/loading-trace.mjs --profile=school --template=rb-mini-mission --check  # the long tasks of a traced 4x check
```

## 9. Phase B (2026-10-26): what changed, measured

Branch `n18/p2-perf3d` on master `16407b8`, worktree `sd-p2-perf3d`. Eleven commits after the audit's: `5680ab2` (#1), `dd4c309` (#1b),
`aff9dbc` (#2), `af79b0f` (#1 again, the owner's ruling), `f2ff258` (#3), `919c644` (#4), `844e9ce` (#5), `9e8b1a6` (#6), `3ff2106`
(#7), `7661d33` (#8), `2af730f` (#3: the 30 fps note shown, not said). Every number below is a range over 3 rounds, before and
after interleaved round by round on the same base (`spikes/p2-perf3d/phase-b-ab.sh`), the 1-minute load average beside it; the results are in `spikes/p2-perf3d/results/phase-b/<item>/`
(`summary.md` in each, made by `ab-summary.mjs`).

### 9.1 The owner's ruling, and the guards

- **Ruling** (mid-way, through the coordinator): "tối ưu đi nhưng phải nhớ vẫn giữ đồ hoạ hiện tại và tính năng hiện tại". Both tiers
  look the same; a visible change is a regression unless brought first with pictures; the no-GPU chain is dormant where frames keep
  up, its cap lowers no visual setting and the 2D map is only offered; no feature changes behaviour; every e2e spec passes
  unchanged.
- **What it changed in Phase B.**
  - #1's hold of the free view's framing during a run (committed in `5680ab2`) moved the camera in the step pictures of three
    pilots (13–27 % of their pixels): taken out in `af79b0f`. The free view reframes for a new HUD height as master does; only
    the cheap search and the kept poses stay.
  - #4's hysteresis (the R4.7 review's "try the last spot first") moves a tag in mini-mission's step pictures: held back, not
    in `src/`. Evidence for the coordinator in `results/phase-b/b4-hysteresis/` (spot changes 1.4 → 1.0 a second; picture
    `tag-spot-before-after.png`); it is `ab-patches.py tag-hysteresis`.
  - #1b had changed the comment of `e2e/robot-bundle.spec.ts`: back to master's text in `af79b0f`.
- **Pixels** (`spikes/p2-perf3d/shots.mjs` and `shots-diff.mjs`): 36 pictures of the production build's canvas, 6 pilots × high/low
  after load, after 15 Bước, and for three pilots in "Theo xe" and "Nhìn từ trên"; Chromium new headless on the GPU, 1200 × 760,
  DPR 1, reduced motion. A pixel counts as changed when a channel differs by more than 8 of 255.
  - Noise floor: two sets of 16407b8 are bit-identical, except servo-gate high's 3 pixels of the gate's 1 px rail (largest
    difference 56), which flip between runs of one build (1 in 4 runs of 16407b8; it is no change of #1's, as `5680ab2`'s message
    first said).
  - The final build against 16407b8: all 36 bit-identical, the largest difference 0 in every picture (`results/phase-b/final/shots-diff.txt`).
- **Determinism:** `tests/robot-determinism.test.ts`, the program-run golden, the pilot checks and the parity tests pass unchanged
  in `pnpm verify` (395 files, 9 089 tests passed, 1 skipped); the e2e determinism spec on Firefox and WebKit passes.
- **e2e:** no spec was changed. The full suite on this branch: 311 of 312 passed twice and 310 of 312 once, under load 11–18 from
  other agents (`results/phase-b/final/e2e-head-full-*.txt`).
  - `robot-lab-a11y.spec.ts`'s contrast test (its 4× run must pass t = 2 s within 5 s, on the high tier over SwiftShader) failed in
    each; it fails the same on master 16407b8 in the same suite and load (`e2e-16407b8-full.txt`), passes alone three times in a row,
    and the robot project alone passes 63 of 63 on both (`e2e-*-robot-project.txt`).
  - In the third run the load slowed SwiftShader enough for the chain to cap a Kiểm tra, and the same spec's count of the polite
    region's words met the 30 fps note: since `2af730f` the note is shown and not said (only the offer, which asks for an answer).
  - With the cap forced on the low tier (`results/phase-b/b3-busy/e2e-cap-forced.txt`): 309 passed; robot-lab-scene's "draws the
    run in every frame" counts full-rate draws and fails by design (0.49–0.5 of them); the two others were fixed or load (§9.2, #3).
- **No new dependency**; `pnpm-lock.yaml` untouched.

### 9.2 Each item

| # | commit | what | before → after (interleaved, 3 rounds) | pixels |
|---|---|---|---|---|
| 1 | `5680ab2`, `af79b0f` | the free view's fit test with the same arithmetic (140 golden poses equal to the last digit), poses kept per scene and safe rect (16 a scene) | school Kiểm tra 4×: long tasks ≥ 50 ms 17–20 → 1 (the last is #1b's), their time 1 152–1 357 → 313–338 ms, p99 74–78 → 45–52 ms; mini-mission's 53 ms task gone (`b1`, load 1.2–6.1). After `af79b0f` (reframing mid-run as master; #1b in both builds): long tasks 0, animation-frame p99 16.8 ms (`b1fix`) | all 36 equal |
| 1b | `dd4c309`, `e301de3` | Rapier loaded and warmed at idle once the lab is used (a press, a key, the host's load-project), after the view is up; fix round 1 (I1): watched from before the lab renders, never beside a run | in the bench's order: first Run → moving school 363–380 → 70–73 ms, GPU 81–89 → 24–25 ms; in the LMS's order (§10): school 403–463 → 71–81 ms, GPU 76–98 → 17–19 ms; school Kiểm tra 4× long tasks 1 (308–326 ms) → 0 (`b1b`, load 2.1–6.1). The warm-up is one task of 312–393 ms at 6× right after the load-project (Rapier's wasm 219–293 of it): the same cost, at an idle moment. A lab only opened loads no Rapier | equal |
| 2 | `aff9dbc` | OrbitControls' keydown listener removed from the root it was added to | listeners after 20 × 2D ↔ 3D +19 → 0, after 20 tier switches +18 → 0; GPU resources 0 growth (`b2`) | equal |
| 3 | `f2ff258` | the low tier's chain: 30 fps cap, then the 2D map offered | thresholds from `b3-busy` (busy.mjs): a free M4 16.7 ms a frame and 4 cores left 23.1–23.5 ms (43 fps) stay dormant; 2 cores left 31–32 ms → capped at 29–30 fps, the same rate at half the CPU (GPU process 84–88 → 46–48 ms a frame, renderer 33–35 → 19–20). The final build end to end (`b3-chain.txt`): no step at 0 and 8 busy threads, the cap at 3.3 s with 10, 11 and 16, the offer once with 16, taken, the run going on in the 2D map | equal (dormant) |
| 4 | `919c644` | the tags' layout without garbage, skipped when nothing it reads moved | the tags' allocation a frame: school line-follow 6.5–7.0 → 0.6–0.7 KB, mini-mission 15.0–15.6 → 3.6–4.0, GPU 6.7–7.0 → 0.7–0.8; the same spots (1.4 changes/s) (`b4-profile`, `b4-fps`) | equal |
| 5 | `844e9ce` | no fibre normal map and no mat roughness canvas on the low tier; the two slow tasks traced | a 34 ms task (fbm, 21 ms) gone from the school trace; the first frame inside its spread (`b5`) | equal |
| 6 | `9e8b1a6` | the shadow map drawn only when a caster moved or the scene changed | shadow-pass draws a frame while the camera moves over a resting robot 51 → 0; LED frames skip it (servo-gate 53.0 → 52.3 a frame); moving runs 51 as before (`b6`) | equal (high tier, every camera mode) |
| 7 | `3ff2106` | the robot's LED and lamp colours from Colors parsed once | under the profiler's resolution (< 0.5 KB a frame before and after) (`b7`) | equal |
| 8 | `7661d33` | `.gz` and `.br` beside each `.glb`, `.wasm`, `.js`, `.css`; the hosting section | GLB 1 777 → 778 (gzip) / 667 kB (brotli); wasm 3 033 → 1 152 / 835 kB; JS 3 490 → 969 / 793 kB | — |

### 9.3 The targets: master 16407b8 against the final build

`spikes/p2-perf3d/final-run.sh` (`results/phase-b/final/`): both builds interleaved, 3 rounds, every run scenario of the school,
school-sim4x, ss-low-4x and gpu-high profiles; then the final build's soak (school, 10 min) and switches (gpu-high), 3 each.

School PC profile (SwiftShader, the low tier, CPU 6×) unless noted; load 4.6–13.5 over the run (other agents' work), CPU loop
96–105 ms in every school cell.

| target | 16407b8 | final | verdict |
|---|---|---|---|
| p95 frame ≤ 33 ms running at 1× (every run cell) | 18.7–23.2 ms (the idle cell's drag 18.5–29.9) | 18.6–20.2 ms | met |
| p95 frame ≤ 33 ms at 4× | Kiểm tra 4× 23.8–25.2, sim 4× 20.1–47.7 ms | 20.8–22.1, 19.6–20.9 ms | met |
| no long task over 100 ms in a run | Kiểm tra 4×: 1 (327–339 ms) and 19–21 more of 50–100 ms; Kiểm tra 1× and mini-mission 1–2 of 52–69 ms; sim 4× mini-mission 3 of 55–59 ms | **0**, none of 50 ms or more in any run cell | met |
| first frame ≤ 2.5 s, warm (every cell but the browser's first) | 2 353–2 762 ms | 2 482–2 870 ms (round 1 2 767–2 870, rounds 2–3 2 482–2 762) | **not met; the same floor as master** (below) |
| heap growth ≤ 5 % over 10 min (school soak) | Phase A on master: −2.2 / +0.2 / −1.8 % | −2.4 / −2.7 / −2.4 %; 0 long tasks over 100 ms in its 30 minutes; each minute's p95 ≤ 20.2 ms | met |
| no GPU-resource growth over 20 switches (gpu-high) | 0 | 0 contexts, geometries, textures, programs after 20 × 2D ↔ 3D and 20 tier switches, 3 runs; listeners 0; heap +4.02–4.05 MB and +1.45–1.46 MB | met |
| GPU high p95 ≤ 20 ms | 17.9–18.5 ms | 17.7–18.3 ms | met |

Beside them, in the bench's order (its load-project after the first frame, which the LMS does not use; the LMS's order is §10, I1):
first Run → moving school 389–460 → 78–127 ms, ss-low-4x 267–309 → 51–55 ms, GPU 71–87 → 13–26 ms (#1b); GPU high
59.9–60.2 fps median in every cell, before and after.

**The first frame's floor.** P2 did not move the warm first frame (2.35–2.76 s on master, 2.48–2.87 s here, the ranges overlapping;
#5b's 30 ms is inside them). On the school trace (`results/phase-b/b5/loading-trace-school-warm.txt`) it is: the entry's scripts,
Blockly and zod (183, 66, 182 ms tasks), the lab chunk at 0.45–0.61 s, the GLBs fetched and parsed (0.25–0.33 s of parse), the
renderer at 1.08–1.48 s, assembly (61 + 39 ms), the compile, and the first scene render's 350 ms waiting on the shader links
(`onFirstUse`). Under 2.5 s every time needs fewer programs or less to assemble (the look, which the ruling keeps) or Blockly later
(another order of the lab's start, a behaviour); neither is P2's to change. The browser's first cell adds about 1.3 s (§9.4).

### 9.4 The two slow tasks the audit could not explain (#5c)

- **The 144–154 ms task one frame after the first** (196–242 ms in Phase A): three's `onFirstUse` of the zones' tags' programs at their
  first draw (144 of the 154 ms, school trace `results/phase-b/b5/loading-trace-school-warm.txt`). Their links went with the
  scene's (`compileAsync` with `compileWithScene`), so no program is added; the first draw's queries (diagnostics, uniform and
  attribute locations) wait on the GPU process, which SwiftShader cannot overlap (no `KHR_parallel_shader_compile`). It happens once
  a canvas, before any Run. Drawing the tags in the first frame would move it into the first frame: left as it is.
- **The ~1.3 s more in a fresh browser** (`--cold`, `loading-trace-school-cold.txt`): the WebGL renderer is made at 2 276–2 282 ms
  against 995–1 013 ms warm, on the lesson page's clock, while the lab's main thread runs no task over 30 ms from 0.93 to 2.25 s. The
  wait is outside the page: the browser bringing up its GPU process for the first WebGL context. The programs' and the tags' first
  uses then take 468–471 and 256–277 ms against 350 and 144 ms warm. Not the app's to cut. The bench's first cell in each browser
  (idle) carries it: 3.8–3.9 s against 2.3–2.5 s for the next cells.
- **#5a** (starting the links before the files are assembled) would need programs equal to the scene's before the scene exists (its
  lights, fog, environment and shadows decide them): not done.

### 9.5 Corrections to Phase A

- **§0.4 / §3.6:** the 186–212 KB a mount was not the listener's. With the listener gone (#2) the heap after 20 × 2D ↔ 3D grows the
  same (+4.04–4.08 → +4.00–4.01 MB, gpu-high; +3.66–3.69 → +3.56–3.60 MB, school; `b2`). **Corrected in fix round 1 (§10, I2):** it is
  a leak, master's too, not "caches filling" as this section first said. three keeps the Sprite's geometry and the DFG texture of the
  standard materials for the whole page, and each renderer that draws them adds a 'dispose' listener, so every 3D canvas the lab made
  stayed alive with its detached canvas (+14 DOM nodes a 2D ↔ 3D switch on master). Fixed: §10.
- **`5680ab2`'s message:** servo-gate high's 3 pixels are run-to-run noise (§9.1), not the camera's last bits.
- **§3.2 "not reframing while a run goes on"** was a behaviour change; the ruling took it out (§9.1).

### 9.6 The R4.3 and R4.7 carries

- **Tag hysteresis** (R4.7 review): measured, held back (§9.1).
- **Per-frame allocations in the tag layout** (R4.7 review): #4, 6.5–15.6 → 0.6–4.0 KB a frame.
- **The overlays on a busy machine** (R4.3): `results/phase-b/b3-busy` ran the chain's build with the overlays on and off beside
  `busy.mjs`. That build had the first threshold (20 ms), which capped the busy runs at 30 fps; the final 28 ms came from these
  runs. GPU process a frame, on → off:
  - free machine (60 fps): line-follow 98.5–103.3 → 93.6–95.4 ms, teleop 128.7–129.8 → 125.9–126.6;
  - 4 cores left (capped): line-follow 46.8–47.1 → 45.8–49.1, teleop 59.5–63.5 → 57.4–60.5;
  - 2 cores left (capped): line-follow 46.2–48.3 → 43.8–44.7, teleop 57.4–59.2 → 57.0–58.4.
  The lab's renderer process differs by under 1 ms a frame, and the frame rate not at all (29.1–29.9 on, 29.6–29.8 off with 2
  cores). So the overlays cost 0–8 ms of SwiftShader's CPU a frame, busy or not.
- **The distance tag's canvas painter** (R4.3, untested for want of a DOM): in the browser's sampling heap profile of school
  line-follow it is below the 40th source, under 0.45 KB a frame (`b4-profile`).

### 9.7 Not done, held back, open

- Held back by the ruling: tag hysteresis (§9.1).
- #5a (§9.4).
- The free view still allocates when it reframes: about 27 KB a frame averaged over mini-mission's school run (camera-studio.ts,
  `b4-profile`), from 5–10 reframes as the HUD's width changes with its text (its corner moves more than 0.01 NDC); 70–80 ms of CPU
  in 8 s at 6×, no long task. The search's remaining arrays (the sliding rounds, the choices) could go the way of the fit test.
- The heap after many 2D ↔ 3D switches (§9.5): a leak, fixed in fix round 1 (§10, I2); what still grows (+2.9–3.0 MB over 19 switches,
  30–80 KB each at the end) is not traced.
- The 30 fps cap holds p95 at 35–36 ms by construction (a capped frame is 33.3 ms): where the chain engages, the 33 ms target cannot.
- `robot-lab-a11y.spec.ts`'s contrast test times out in the full e2e suite under load 13–18, on master 16407b8 as on this branch
  (`results/phase-b/final/e2e-*.txt`); it passes alone, three times in a row, and in the robot project alone (63 of 63). Fix round
  1 found the same on both (§10.5).
- Real hardware (§7) is still the open question; `busy.mjs` stands in for fewer cores, not for slower ones.

### 9.8 Reproduction

```sh
zsh spikes/p2-perf3d/phase-b-ab.sh <name> <before> <after> school:check-4x,mini-mission gpu-high:idle   # dist-<build> from vite build
node spikes/p2-perf3d/ab-summary.mjs spikes/p2-perf3d/results/phase-b/<name>
node spikes/p2-perf3d/shots.mjs --dist=<build> --out=<dir> && node spikes/p2-perf3d/shots-diff.mjs <before-dir> <after-dir>
zsh spikes/p2-perf3d/busy-ab.sh <name> line-follow,teleop "0 8 10" <builds...>
node spikes/p2-perf3d/chain-check.mjs --dist=<build> --seconds=20 [--accept] [--shot=<png>]    # beside busy.mjs
node spikes/p2-perf3d/loading-trace.mjs --profile=school --dist=<build> [--cold | --warmup | --check]
zsh spikes/p2-perf3d/final-run.sh <after-build>
```


## 10. Fix round 1 (2026-10-26, after review 1)

Review 1 (`p2-review-1.md`) found 1 critical, 2 important and 8 minor issues; the coordinator's rulings are in `progress.md`. Commits:
`51a783b` (M1, M2), `5dd33d3` (M6), `301b201` (C1), `e301de3` (I1, M3), `d927bd3` (M5), `0671298` (M8), `4792205` (M7), `5c3097f`
(I2), `e0282f9` (M4), `6fc71a8` (the I1 and C1 measurements), and this section's. The machine was shared: the coordinator's
browser test (AppHost, Postgres, a dev server on :5173 and a Chrome) ran beside every measurement below, so each one is interleaved
with master `16407b8` and records `uptime`. Ports used: 5302–5309 only; the E2E ran from a scratch copy on 5308/5309
(`spikes/p2-perf3d/e2e-on-ports.sh`), never on 5190; master's side from a `git archive` of `16407b8` in the scratchpad (no worktree).

### 10.1 C1: the E2E is load-proof

- **Hooks** (DEV only, not enumerable on `window.__stem.robot`, so R4.1's test of its keys holds): `setLowTierChain('off' | 'auto')`,
  kept for every lab the page mounts after it, and `forceLowTierStep('cap' | 'offer')`. RobotLab serves them through
  `low-tier-control.ts`; SceneHost gives the low tier no frame watch while it is off, and forced steps still apply.
- **Helpers:** `e2e/robot-chain.ts` `pinLowTierChainOff`, called by every robot entry helper (`openInLesson` in the ten robot specs) and
  by the robot lab's direct opens. No assertion changed.
- **The chain's own spec** (`e2e/robot-lab-chain.spec.ts`, chromium-robot, SwiftShader, the low tier, 4 tests): a capped run has the
  same `snapshotHash` after 1.0 s of steps and at its 15 s time limit as an uncapped one; capped draws never exceed what `drawDue`
  allows over the same display frames and are at least 60 % of it, about 0.5 a changed snapshot where the display keeps up (45–56 of 90
  at 60 Hz) and up to 0.9 when the suite's load stretches the frames (the cap then allows 72–81 of 90); "Xem 2D" shows the map and
  the run goes on; "Giữ 3D" keeps 3D and the offer does not come again. It also covers `CompiledDraw`'s skip and the offer's UI.
- **Tallies, chromium-robot** (its own 6 workers, beside the browser test):
  - 5 runs, load 5.2–24.4: 66, 65, 66, 67, 67 of 67 (`results/fix1/c1/branch-*`);
  - 4 rounds alternating with master's own specs, load 14.8–24.9: master 63, 63, 62, 63 of 63; branch 67, 67, 66, 67 of 67
    (`results/fix1/c1/interleaved-*`);
  - the chain spec passed in all 9; no failure was the chain's. The failures: the a11y contrast spec (its 4× run on SwiftShader's
    high tier must pass 2 s within 5 s) 3 times in the first 5; the context-loss spec once; and robot-lab-sensors' "a robot at rest
    draws no frame" once on each side in the same interleaved round.

### 10.2 I1: the warm-up in the LMS's order

- `src/ui/app/lab-use.ts` `watchLabUse`: main.tsx starts it before the lab renders (a pointer press, a key), and the host loader calls
  `markUsed` when it applies a project (`createHostLoader` `onApplied`, also after a busy lab lets it go). RobotLab warms at idle once
  its view is up and the lab was used, never once a start, a run, teleop or a check began; `preparePhysics` itself returns false
  without building anything when the page has the engine or a run exists, and a run started while it builds its world stops it
  before a tick. Tests: the load before the mount warms with no press; a run first means no warm-up; the race; the loader.
- **First Run → moving, LMS order** (`spikes/p2-perf3d/lms-order.mjs`: load-project on `ready`, no press, 3 s at rest, then Chạy;
  master and the branch interleaved, 3 rounds, load 8.3–18.4): school (SwiftShader, CPU 6×) **403–463 → 71–81 ms**; GPU
  **76–98 → 17–19 ms**. On master Rapier is fetched at the click; on the branch before it. (The bench's order, §9.3, gave 389–460 →
  78–127 ms and is kept only labelled as such.)

### 10.3 I2: the canvas leak

- `src/ui/robot3d/shared-gpu.ts`: as a 3D canvas goes, `CompiledDraw` disposes three's shared Sprite geometry (`new Sprite().geometry`,
  public) and the DFG lookup texture it found once after its first draw (through `renderer.properties` of a standard material it drew:
  three's internals). Each renderer then drops its copy and its listener; the next canvas uploads them again. `shared-gpu.test.ts` pins
  what it reaches in three 0.186.1 (the version, `lut.name = 'DFG_LUT'`, `m_uniforms.dfgLUT.value = getDFGLUT()`, the shared
  `_geometry`) and fails when three changes it.
- **Re-measured without the probe's retention** (`spikes/p2-perf3d/heap-switch.mjs`, GPU, 20 × 2D ↔ 3D then 20 tier switches,
  interleaved with master, 3 rounds, load 5.9–10.1, `results/fix1/i2/heap-switch.txt`):

| | master `16407b8` | fix round 1 |
|---|---|---|
| DOM nodes, 2D ↔ 3D | 1087 → 1353 (+14 a switch) | 1074, flat |
| DOM nodes, tier | 1364 → 1418 (+6 a switch) | 1079, flat |
| JS listeners | 342 → 361 → 381 (+1, +2 a switch) | 342, flat |
| 'dispose' listeners on the Sprite geometry | 2 → 21, 23 → 41 | 1 (the live renderer's) |
| heap over the 19 switches after the first | +4.04–4.05 MB, the last five 60–140 KB each | +2.92–2.97 MB, the last five 30–80 KB each |
| heap over 18 tier switches | +1.11–1.13 MB | +0.61–0.68 MB |

  The branch's heap starts 1.66 MB higher at the first switch: that click is the lab's first use, and Rapier loads. What still grows
  is not traced.
- The bench's probe (M6) now counts the renderers and holds the latest one weakly, so `bench:robot3d`'s own switch numbers no longer
  include it.

### 10.4 Minors

- **M1, M2:** `pnpm build` is `scripts/build.mjs`: `vite build` with its arguments (`pnpm build --base /lab/` builds with base /lab/),
  then the copies in vite's outDir; the helper is plain JavaScript (`scripts/lib/precompress.mjs`), `engines` unchanged; it runs with
  `--no-experimental-strip-types`.
- **M3:** the two comments say Rapier loads after the first use, at idle.
- **M4:** kept one way, as ruled, and written down as a known limit next to the provisional thresholds (`frame-watch.ts`, §10 here,
  the plan's addendum, ADR 0002 §11.10): a short slow spell caps the low tier until the page reloads; a 30 Hz browser caps it and
  shows the note though nothing changes.
- **M5:** `holdShadows` (out of ShadowsOnChange) has its tests (autoUpdate off and back, needsUpdate on a caster's move and not for an
  LED, the restored-context listener); the layout test is named for what it shows.
- **M7:** §4.1 of the hosting docs explains `?v=0` (a GLB missing from the manifest; `tests/robot-assets.test.ts` now holds that none
  is) and caches `/blockly-media/*` and `/favicon.svg` for a day with revalidation.
- **M8:** the offer has z-index 2, over the results card (z-index 1); `results/fix1/offer-over-result.png` (rb-mini-mission, a Nhanh
  check, five goals): the card's bottom is under the offer's top, and the element there is the offer.

### 10.5 Verification

- **Pixels:** the 36 shots of the fix build equal 16407b8's; servo-gate high's run-to-run flip in 1 of 4 shots of this build, as of
  master (`results/fix1/shots-diff.txt`).
- **`pnpm verify`:** 399 files, 9 104 passed, 1 skipped.
- **`pnpm e2e`** (the full suite, all projects, from the scratch copy on 5308/5309):
  - the branch alone, 2 runs, load 8.9–21.2: 315 of 316 each;
  - 2 rounds alternating with master (312 tests; the branch's 4 more are the chain spec), load 15.0–50.8: master 311 and 308 of
    312, the branch 315 and 315 of 316 (`results/fix1/e2e/`).
  - The branch's one failure, in all 4 runs, is the a11y contrast test (`robot-lab-a11y.spec.ts:512`, master's `:509`): its 4× run
    reached t = 0.93–1.26 s of the 2 s it waits 5 s for (master's 0.47–0.93 s), and master lost it in both its runs too (§9.7: it
    passes alone and in the robot project). Master's second run, at load up to 50.8, also lost robot-lab-check's "a tab hidden … at
    4×" and two of robot-lab-sensors' tests. No assertion of an existing spec changed; the specs gained only the chain's pin.

### 10.6 Reproduction

```sh
zsh spikes/p2-perf3d/e2e-on-ports.sh <scratch-dir> --project=chromium-robot          # SRC=<master export> for master's side
node spikes/p2-perf3d/lms-order.mjs --dist=<build> --profile=school|gpu --label=<name>  # I1, beside the same on master's build
node spikes/p2-perf3d/heap-switch.mjs --dist=<build> --switches=20 --label=<name>       # I2, idem
node spikes/p2-perf3d/offer-over-result.mjs --out=<png>                                # M8
node spikes/p2-perf3d/shots.mjs --dist=<build> --out=<dir> && node spikes/p2-perf3d/shots-diff.mjs <master-dir> <dir>
```
