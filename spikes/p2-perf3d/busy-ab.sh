#!/bin/zsh
# N18 P2 Phase B #3 and the R4.3 carry: the low tier on a busy machine. For each number of busy threads (spikes/p2-perf3d/busy.mjs:
# 0, 8 and 10 of the M4 Pro's 12 cores taken, so SwiftShader and the lab share about 12, 4 and 2), bench:robot3d runs the given builds
# one after the other, 3 rounds, on the school profile (SwiftShader, the low tier, CPU 6x). Builds are made by the caller into
# node_modules/.cache/bench-robot3d/dist-<name>. Run from the repository root:
#
#   zsh spikes/p2-perf3d/busy-ab.sh <out-name> <scenarios> <threads list> <build> [<build> ...]
#   e.g. zsh spikes/p2-perf3d/busy-ab.sh b3 line-follow,teleop "0 8 10" b2 b3 b3cap
# A build named <name>@off runs dist-<name> with --sensors=off (the overlays off).
R=$(git rev-parse --show-toplevel)
NAME=$1; SCENARIOS=$2; THREADS=(${=3}); shift 3
OUT=$R/spikes/p2-perf3d/results/phase-b/$NAME
mkdir -p $OUT
cd $R
D=$R/node_modules/.cache/bench-robot3d
for threads in $THREADS; do
  busy=""
  if [ "$threads" != "0" ]; then node spikes/p2-perf3d/busy.mjs --threads=$threads --seconds=3600 > $OUT/busy-$threads.log 2>&1 & busy=$!; sleep 3; fi
  for i in 1 2 3; do
    for build in "$@"; do
      dist=${build%@*}; sensors=on; [ "$build" != "$dist" ] && sensors=${build#*@}
      label=busy$threads-$dist-sensors$sensors-$i
      node scripts/bench-robot3d.mjs --dist=$D/dist-$dist --label=$label --profiles=school --scenarios=$SCENARIOS --repeats=1 --pass=fps --sensors=$sensors --port=${PORT:-5306} --out=$OUT > $OUT/$label.log 2>&1 || true
    done
  done
  [ -n "$busy" ] && kill $busy
  sleep 3
done
echo "BUSY AB $NAME DONE"
