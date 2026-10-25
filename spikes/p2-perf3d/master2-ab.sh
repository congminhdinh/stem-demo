#!/bin/zsh
# N18 P2 spike: master 16407b8 (R8-a11y merged) against b5c8727 (where §2.7 was measured), interleaved round by round, on the cells the
# audit's findings rest on; then the 2D ↔ 3D switch once on 16407b8 (the listener leak). Both builds are made by the caller into
# node_modules/.cache/bench-robot3d/dist-b5c8727 and dist-16407b8. Run from the repository root.
R=$(git rev-parse --show-toplevel)
OUT=$R/spikes/p2-perf3d/results/master2-ab
mkdir -p $OUT
cd $R
D=$R/node_modules/.cache/bench-robot3d
run() { node scripts/bench-robot3d.mjs --dist=$1 --label=$2 --profiles=$3 --scenarios=$4 --repeats=1 --pass=fps --port=5306 --out=$OUT > $OUT/$2.log 2>&1 || true; }
for i in 1 2 3; do
  for b in b5c8727 16407b8; do
    run $D/dist-$b $b-school-$i school idle,line-follow,mini-mission,check-4x
    run $D/dist-$b $b-ss-$i ss-low-4x line-follow
    run $D/dist-$b $b-gpu-$i gpu-high idle,line-follow
  done
done
run $D/dist-16407b8 16407b8-switch gpu-high switch
echo MASTER2 AB DONE
