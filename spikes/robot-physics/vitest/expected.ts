import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Hashes recorded by node-run.ts with the compat package in plain Node. */
export const expected = JSON.parse(readFileSync(join(import.meta.dirname, '../results/node-run1.json'), 'utf8')).hashes as Record<
  string,
  { run1: { finalQ6: string; trajQ6: string; trajBits: string } }
>;
