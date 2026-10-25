#!/bin/zsh
# N18 P2 Phase B: before/after runs of bench:robot3d, interleaved round by round (3 rounds), on builds the caller made into
# node_modules/.cache/bench-robot3d/dist-<name>. Run from the repository root:
#
#   zsh spikes/p2-perf3d/phase-b-ab.sh <out-name> <before-build> <after-build> <profile>:<scenarios> [<profile>:<scenarios> ...]
#
# e.g. zsh spikes/p2-perf3d/phase-b-ab.sh b1 16407b8 b1 school:check-4x,mini-mission gpu-high:idle,line-follow
# Results in spikes/p2-perf3d/results/phase-b/<out-name>/ (each run's .json.gz, .md and log); node spikes/p2-perf3d/ab-summary.mjs on it.
R=$(git rev-parse --show-toplevel)
NAME=$1; BEFORE=$2; AFTER=$3; shift 3
OUT=$R/spikes/p2-perf3d/results/phase-b/$NAME
mkdir -p $OUT
cd $R
D=$R/node_modules/.cache/bench-robot3d
run() { node scripts/bench-robot3d.mjs --dist=$D/dist-$1 --label=$2 --profiles=$3 --scenarios=$4 --repeats=1 --pass=fps --port=${PORT:-5306} --out=$OUT > $OUT/$2.log 2>&1 || true; }
for i in 1 2 3; do
  for cell in "$@"; do
    profile=${cell%%:*}; scenarios=${cell#*:}
    run $BEFORE before-$profile-$i $profile $scenarios
    run $AFTER after-$profile-$i $profile $scenarios
  done
done
echo "PHASE B AB $NAME DONE"
