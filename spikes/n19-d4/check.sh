#!/usr/bin/env bash
# N19 D4 spike: check each KEY:PROG pair headless (every variant) and print the score, the variants' scores, the ends and the goals.
#   bash spikes/n19-d4/check.sh rb-grip-pick:pickRef rb-grip-sort:sortRef ...
cd "$(dirname "$0")/../.."
for pair in "$@"; do
  key="${pair%%:*}"; prog="${pair##*:}"
  SPIKE=run KEY="$key" PROG="$prog" SPIKE_MODE=check pnpm exec vitest run --config spikes/n19-d4/vitest.config.ts run < /dev/null > /dev/null 2>&1
  python3 -c "
import json; d=json.load(open('spikes/n19-d4/results/check-$key-$prog.json'))
print('$key $prog', d['score'], [v['score'] for v in d['variants']], [(e['end'] or {}).get('reason') for e in d['ended']])
for e in d['ended']: print('   ', e['goals'])"
done
