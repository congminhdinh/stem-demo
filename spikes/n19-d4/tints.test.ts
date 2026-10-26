// N19 D4 spike: the mat's pattern ink against candidate zone fills (zone-pattern.test.ts holds every lesson fill to 2.9:1 or more).
//   SPIKE=tints pnpm exec vitest run --config spikes/n19-d4/vitest.config.ts tints
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { colorReflectance } from '../../src/core/world/arena/ground-paint';
import { contrastRatio } from '../../src/ui/a11y/contrast';
import { patternInk } from '../../src/ui/robot3d/zone-pattern';

it.runIf(process.env.SPIKE === 'tints')('ratios', () => {
  const rows: string[] = [];
  for (const fill of ['#cfe2f3', '#d9ead3', '#fff2cc', '#f4cccc', '#e0e0e0', '#eeeeee', '#fce4e4', '#fde8e8', '#fbe3e3', '#f9e0e0', '#fae6e6', '#e8e8e8', '#ececec'])
    rows.push(`${fill} ${contrastRatio(patternInk(fill, 'mat'), fill).toFixed(3)} luma ${colorReflectance(fill).toFixed(3)}`);
  writeFileSync(join(import.meta.dirname, 'results', 'tints.txt'), rows.join('\n') + '\n');
});
