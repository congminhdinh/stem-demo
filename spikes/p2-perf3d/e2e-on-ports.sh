#!/bin/zsh
# N18 P2 fix round 1: the repository's E2E on ports of its own, for a machine shared with other agents (the dev server on $DEV_PORT,
# default 5308; the lesson host on $LESSON_PORT, default 5309, not 5190). A scratch folder gets a copy of e2e/ with the lesson's port
# rewritten, links to src, public, scripts, node_modules and package.json, and playwright.config.ts with the ports and the worktree (or
# $SRC, another checkout of the repository, e.g. a git archive of master) as
# the servers' folder; the dev server is vite itself (pnpm dev, the same command, would check the install of a checkout whose node_modules is
# a link). The specs themselves are unchanged. Run from the repository root; the arguments go to playwright test:
#
#   zsh spikes/p2-perf3d/e2e-on-ports.sh <scratch-dir> [--project=chromium-robot] [spec ...]
R=${SRC:-$(git rev-parse --show-toplevel)}
DIR=$1; shift
DEV=${DEV_PORT:-5308}; LESSON=${LESSON_PORT:-5309}
rm -rf $DIR/e2e && mkdir -p $DIR && cp -R $R/e2e $DIR/e2e
for name in src public scripts node_modules package.json tsconfig.json; do ln -sfn $R/$name $DIR/$name; done
grep -rl "5190" $DIR/e2e | while read f; do sed -i '' "s/5190/$LESSON/g" $f; done
sed -e "s/Number(process.env.E2E_PORT ?? 5173)/$DEV/" -e "s/const lessonHostPort = 5190;/const lessonHostPort = $LESSON;/" \
    -e "s#reuseExistingServer: !process.env.CI,#reuseExistingServer: false, cwd: '$R',#g" \
    -e "s#command: \`pnpm dev --port#command: \`node node_modules/vite/bin/vite.js --port#" $R/playwright.config.ts > $DIR/playwright.config.ts
cd $DIR && npx playwright test "$@"
