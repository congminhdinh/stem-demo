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
| `results/gripper-ui-pass-rates.txt` | the gripper-ui spec, before and after (the controller's addition) | `e2e-on-ports.sh ... --repeat-each=k` |
| `results/e2e.txt` | E10's spec and every robot spec | `e2e-on-ports.sh` |

The plan's table is in docs/n19-gripper-plan.md 4.16.
