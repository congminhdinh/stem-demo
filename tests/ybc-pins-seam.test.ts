import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inputKindOfModel } from '../src/core/simulation/simulate-circuit';
import type { SimulationInputs } from '../src/core/simulation/simulate-circuit';

// Where the pins and the potentiometer plug into the shared seams of YB-CP amendment 1 (YB-4). The amendment says
// RunSession needs no device name: the pin capabilities come from a factory the composition root passes in, the
// potentiometer's input is the generic `ComponentInput` of the generic input plane, and the only shared data YB-4
// adds is one line in `inputKindOfModel`. These tests keep that true; the frozen amendment tests keep the seams.

const source = (path: string) => readFileSync(join(import.meta.dirname, '..', 'src', path), 'utf8');

describe('RunSession does not know the pins or the potentiometer', () => {
  const runSession = source('core/run/run-session.ts');

  it.each(['ybc-pin-io', 'createPinCapabilities', 'usablePins', 'potentiometer', 'analog-source', 'sliders', 'clampSliderPercent', 'circuitInputKind', 'ybc-board'])(
    'does not mention %s',
    (word) => {
      expect(runSession).not.toContain(word);
    },
  );

  it('is not told about pins by the simulation either: SimulationInputs has no field per kind of control', () => {
    const keys = ['powered', 'pinOutputs', 'contacts', 'inputs'] satisfies (keyof SimulationInputs)[];
    expect(keys).toHaveLength(4);
    expect(source('core/simulation/simulate-circuit.ts')).not.toMatch(/\bsliders\b/);
  });
});

describe('the composition root', () => {
  it('passes the pin factory to the session: capabilities are composed there, not inside RunSession', () => {
    const main = source('main.tsx');
    expect(main).toContain("from './core/run/ybc-pin-io'");
    expect(main).toMatch(/createRunSession\(registry, \{[^}]*capabilities: createPinCapabilities\(registry\)/);
  });
});

describe('the shared data YB-4 adds', () => {
  it('is the single line that makes the analog source take a slider', () => {
    expect(inputKindOfModel['analog-source']).toBe('slider');
    expect(Object.keys(inputKindOfModel).sort()).toEqual(['accelerometer', 'analog-source', 'button', 'light-sensor', 'temperature-sensor']);
  });
});
