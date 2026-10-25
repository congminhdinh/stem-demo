#!/bin/zsh
# N18 P2 spike. Run from the repository root with a clean src/ (it patches, builds and reverts src/): zsh spikes/p2-perf3d/ab-run.sh
# A/B of five candidate optimisations (framing: the free view's fit test made cheap and its poses kept per HUD size; mat-aniso-low: the
# mat's colour map without anisotropic filtering on the low tier; no-shader-checks: three's link-status queries off;
# low-dpr-075: the low tier at 0.75 of the CSS pixels each way; cap-30: a run drawn every other display frame) against the same base build (39a877d), interleaved repeat by repeat, school PC profile.
# Each variant is the base with one patch (ab-patches.py), built to its own folder and reverted at once (never committed).
set -e
R=$(git rev-parse --show-toplevel)
S=$R/spikes/p2-perf3d
OUT=$R/spikes/p2-perf3d/results/ab
mkdir -p $OUT
cd $R
for v in framing mat-aniso-low no-shader-checks low-dpr-075 cap-30; do
  python3 $S/ab-patches.py $R $v
  node node_modules/vite/bin/vite.js build --outDir node_modules/.cache/bench-robot3d/dist-$v --emptyOutDir --sourcemap hidden --logLevel error
  git checkout -- src
  git status --short src
done
D=$R/node_modules/.cache/bench-robot3d
run() { node scripts/bench-robot3d.mjs --dist=$1 --label=$2 --profiles=school --scenarios=$3 --repeats=1 --pass=fps --port=5306 --out=$OUT > $OUT/$2.log 2>&1 || true; }
for i in 1 2 3; do
  run $D/dist ab-base-$i idle,line-follow,teleop,mini-mission,check-4x
  run $D/dist-framing ab-framing-$i mini-mission,check-4x
  run $D/dist-mat-aniso-low ab-mat-aniso-low-$i idle,line-follow,teleop
  run $D/dist-no-shader-checks ab-no-shader-checks-$i idle,line-follow
  run $D/dist-low-dpr-075 ab-low-dpr-075-$i line-follow,teleop
  run $D/dist-cap-30 ab-cap-30-$i line-follow,teleop
done
echo AB DONE
