# N19 E9 + E10: results

Machine: Apple M4 Pro (12 cores, 24 GB), Darwin 25.5.0, Node 24.22.1, Chromium 153.0.8010.12 (Playwright 1.63), Firefox 155. 2026-10-27, branch `n19/e910-bench-e2e` on master 7758ec9
(D4 after its fix round 1). Every number below comes from a run recorded in `results/`; the load average (`uptime`, 1 minute) is next to it.

| file | what | command |
|---|---|---|
| `results/pose-pixels.txt` | the gripper pose change draws the same pixels as the D4 tip (10 states, both tiers, each twice per tree) | `node spikes/n19-e9/pose-pixels.mjs --base=http://localhost:5551 --head=http://localhost:5550` (two vite dev servers: `git archive f744cbf` and the tree) |
| `results/footprint-cost.txt` | the lab's first call for the outline, before and after (CPU 6x) | `node spikes/n19-e9/footprint-cost.mjs --origin=http://localhost:555x --runs=7 --rate=6 --call=robotOutlineCm\|robotFootprint` |
| `results/bench-robot3d-school-gripper.md` and `-summary.txt` | `bench:robot3d`, school profile, the four gripper references and Kiểm tra 4x of rb-grip-sort, 3 repeats, fps and profile passes | `node scripts/bench-robot3d.mjs --profile=school --scenarios=gripper --repeats=3 --dist=<vite build --sourcemap hidden> --port=5554` (load 6.14 before) |
| `results/bench-robot3d-school-rover-{A1-master,B1-branch,A2-master,B2-branch}.md`, `-ab-summary.txt` | the rover's scenarios on master (7758ec9) and on the branch, alternately twice, same script, one build each | `node scripts/bench-robot3d.mjs --profile=school --scenarios=idle,drive-to-zone,line-follow,mini-mission,check-4x,teleop --repeats=2 --dist=<build>` (load 6.47, 6.23, 6.23, 5.74 before) |
| `results/bench-robot-gripper.txt` | `pnpm bench:robot --gripper`: the CPU bench with the four gripper references | `node scripts/bench-robot.mjs --gripper` (load 5.6) |
| `results/bench-robot-rover-{master,branch}-{1,2}.txt` | `pnpm bench:robot` (the rover's table) on master and on the branch, alternately twice | `node scripts/bench-robot.mjs` (load 4.6 to 5.3) |
| `results/rest-draws.txt` | what asks for frames after a gripper lesson has ended | `node spikes/n19-e9/rest-draws.mjs <key>` |
| `results/glb-sizes.txt` | the GLBs against plan 3 | `git show 3025a0a^:public/robot3d/<file>` and `wc -c` |
| `results/world-build-cost.txt` | what one round's world costs, rover against gripper (the likely cause of the gripper Kiểm tra 4x's long tasks of 68 to 79 ms) | `node spikes/n19-e9/world-build-cost.mjs` |
| `results/gripper-ui-pass-rates.txt` | the gripper-ui spec, before and after (the controller's addition) | `e2e-on-ports.sh ... --repeat-each=k` |
| `results/e2e.txt` | E10's spec and every robot spec | `e2e-on-ports.sh` |

The plan's table is in docs/n19-gripper-plan.md 4.16.

Fix round 1 (review 1): the `judge()` rows for `rb-grip-check-4x` (p5 fps >= 30 on ss-low-4x, p95 <= 33 ms and no task over 100 ms on school) were exercised with `--report` on the
recorded gripper results and a copy of them renamed to the `ss-low-4x` profile (the numbers of that copy are the school's, not measurements), and the rover's verdict table from
`--report` on a recorded rover run is identical, line for line, to the one the earlier script printed. The ss-low-4x numbers themselves are phase B's (after B7, at load <= 6): not taken yet.

## Phase B (fix round 1, review 1): the final bench

Master 8760350 (E8 and B7 in), one production build (`vite build --sourcemap hidden`) for every run, `--dist`, the bench on ports 5554/5555; each run started at a 1-minute load of 3.2 (ss-low-4x),
3.9 (gpu-high) and 4.1 (school), 3.5 for `bench:robot --gripper` (`results/phase-b-driver-log.txt`). The cells themselves run at 3 to 8 (the bench's own SwiftShader work).

| file | what | command |
|---|---|---|
| `results/phase-b-bench-robot3d-ss-low-4x-gripper.md`, `-summary.txt` | the N18 low-tier rows for the four lessons and Kiểm tra 4x of rb-grip-sort: p5 fps >= 30, first Run -> moving <= 1500 ms | `node scripts/bench-robot3d.mjs --profile=ss-low-4x --scenarios=gripper --repeats=3 --pass=all --dist=<build> --port=5554` |
| `results/phase-b-bench-robot3d-gpu-high-gripper.md`, `-summary.txt` | median fps >= 50 for the four lessons | same, `--profile=gpu-high` |
| `results/phase-b-bench-robot3d-school-gripper.md`, `-summary.txt` | school p95 of rb-grip-check-4x again, the rest-draws row after B7, long tasks | same, `--profile=school` |
| `results/phase-b-bench-robot3d-school-rover.md`, `phase-b-rover-compare.txt` | the rover's scenarios on the final code against phase A's master and branch | `--profile=school --scenarios=idle,drive-to-zone,line-follow,mini-mission,check-4x,teleop --repeats=2` |
| `results/phase-b-bench-robot-gripper.txt` | `bench:robot --gripper` on the final code | `node scripts/bench-robot.mjs --gripper` |
| `results/long-tasks-*.json`, `phase-a-long-tasks.txt`, `phase-b-long-tasks.txt` | the long-task figures of every cell of both phases, both passes, from the results JSON (the bench's tables carry the fps pass only): count of tasks of 50 ms or more, over 100 ms, longest, total | `node spikes/n19-e9/long-tasks.mjs <bench-robot3d-*.json> --out=results` |
| `results/check-long-tasks.txt` | the long tasks of a Kiểm tra 4x against when its rounds start: one of 57 to 68 ms at round 2's start for the gripper at CPU 6x, none for the rover | `node spikes/n19-e9/check-long-tasks.mjs --origin=http://localhost:5556 --template=<key> --rate=<n>` (vite preview of the build) |

Verdict: every budget row passes in all three runs (exit 0). The one target not met is the first frame (<= 2.5 s), as at N18.
