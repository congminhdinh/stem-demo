import R from '@dimforge/rapier3d-deterministic-compat';
import { expect, test } from 'vitest';
import { hashRun } from '../scenarios.ts';
import { DRIVE_MODELS, type Rapier } from '../sim.ts';
import { expected } from './expected.ts';

test.each(DRIVE_MODELS)('compat package under Vitest reproduces the Node hash (%s)', async (model) => {
  await R.init();
  const h = hashRun(R as unknown as Rapier, { model }, () => performance.now());
  expect({ finalQ6: h.finalQ6, trajQ6: h.trajQ6, trajBits: h.trajBits }).toEqual(expected[model]!.run1);
});
