#!/bin/zsh
# N18 P2 spike, on the merged master (R4.7 + R4.3): (1) R4.3's sensor overlays on and off, interleaved round by round; (2) the first frame
# against master before R4.7 (1211347, built into node_modules/.cache/bench-robot3d/dist-1211347 from a `git archive`), interleaved;
# (3) the school PC soak (overlays on). Run from the repository root after bench:robot3d has built master's dist.
R=$(git rev-parse --show-toplevel)
OUT=$R/spikes/p2-perf3d/results/master-ab
mkdir -p $OUT
cd $R
D=$R/node_modules/.cache/bench-robot3d
run() { node scripts/bench-robot3d.mjs --dist=$1 --label=$2 --profiles=$3 --scenarios=$4 --repeats=1 --pass=fps --port=5306 ${5:+--sensors=$5} --out=$OUT > $OUT/$2.log 2>&1 || true; }
for i in 1 2 3; do
  run $D/dist sensors-on-school-$i school line-follow,stop-at-wall,check-4x on
  run $D/dist sensors-off-school-$i school line-follow,stop-at-wall,check-4x off
  run $D/dist sensors-on-gpu-$i gpu-high line-follow,stop-at-wall on
  run $D/dist sensors-off-gpu-$i gpu-high line-follow,stop-at-wall off
done
for i in 1 2 3; do
  run $D/dist-1211347 first-frame-1211347-$i ss-low-4x idle,line-follow
  run $D/dist first-frame-master-$i ss-low-4x idle,line-follow
done
node scripts/bench-robot3d.mjs --dist=$D/dist --label=master-soak-school --profiles=school --scenarios=soak --pass=fps --port=5306 --out=$OUT > $OUT/master-soak-school.log 2>&1 || true
echo MASTER AB DONE
