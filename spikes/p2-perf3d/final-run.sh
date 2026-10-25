#!/bin/zsh
# N18 P2 Phase B: the targets, master 16407b8 against Phase B's last build, interleaved round by round (3 rounds) on every profile's
# run scenarios; then the soak (school, 10 min) and the switches (gpu-high) on the last build, 3 each. Builds are made by the caller
# into node_modules/.cache/bench-robot3d/dist-16407b8 and dist-<after>. Run from the repository root:
#
#   zsh spikes/p2-perf3d/final-run.sh <after-build>
R=$(git rev-parse --show-toplevel)
AFTER=$1
OUT=$R/spikes/p2-perf3d/results/phase-b/final
mkdir -p $OUT
cd $R
D=$R/node_modules/.cache/bench-robot3d
run() { node scripts/bench-robot3d.mjs --dist=$D/dist-$1 --label=$2 --profiles=$3 --scenarios=$4 --repeats=1 --pass=fps --targets --port=${PORT:-5306} --out=$OUT > $OUT/$2.log 2>&1 || true; }
for i in 1 2 3; do
  for build in 16407b8 $AFTER; do
    run $build $build-school-$i school idle,line-follow,mini-mission,check-1x,check-4x,follow,teleop
    run $build $build-school-sim4x-$i school-sim4x line-follow,mini-mission
    run $build $build-ss-$i ss-low-4x line-follow,mini-mission
    run $build $build-gpu-$i gpu-high idle,line-follow,mini-mission,follow,teleop
  done
done
for i in 1 2 3; do
  run $AFTER $AFTER-soak-$i school soak
  run $AFTER $AFTER-switch-$i gpu-high switch
done
echo "FINAL DONE"
