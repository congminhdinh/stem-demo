// The scripts the N18 roots of the robot lab's GLBs are built from (N19 E6/E7 fix round 1, review M7): scripts/build-robot-assets.mjs keeps
// those roots byte for byte (scripts/lib/glb-splice.ts) only while these scripts are as they were, and tests/robot-assets-frozen.test.ts
// checks it. Every script of assets-src/robot3d/ is the N18 roots' but the N19 ones (`N19_ONLY`). build.py builds both: its N19 lines are
// in blocks between a `# N19 >>>` and a `# N19 <<<` line, and the N18 roots are guarded by the hash of the file without them (`n18Text`),
// which is N18's own build.py.

/** The scripts only the N19 roots are built from. */
export const N19_ONLY: readonly string[] = ['build_n19.py', 'parts/gripper.py', 'props/build_props_n19.py', 'props/pick_place.py'];

/** A script's N18 text: build.py without its marked N19 blocks (the markers' lines included); any other script as it is. */
export function n18Text(name: string, text: string): string {
  if (name !== 'build.py') return text;
  const kept: string[] = [];
  let inBlock = false;
  for (const line of text.split('\n')) {
    if (line.trim() === '# N19 >>>') inBlock = true;
    else if (line.trim() === '# N19 <<<') inBlock = false;
    else if (!inBlock) kept.push(line);
  }
  return kept.join('\n');
}
