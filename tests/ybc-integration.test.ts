import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDocument } from '../src/core/circuit/document';
import { compileBlocks } from '../src/core/codegen/yolobit/__fixtures__/compile-case';
import { generateYbcMicroPython } from '../src/core/codegen/yolobit/generate';
import { usesYolobitModule, yolobitModuleLines } from '../src/core/codegen/yolobit/modules';
import { localDeviceDefinitions } from '../src/core/devices/local-catalog';
import { createDeviceRegistry } from '../src/core/devices/registry';
import { fixtureDocument } from '../src/core/profiles/__fixtures__/test-profiles';
import { buttonPressed, images, lightLevel, playNote, print, program, showImage, type Json } from '../src/core/program/__fixtures__/ybc-blocks';
import { pinAnalog, pinWrite } from '../src/core/program/__fixtures__/ybc-pin-blocks';
import { createRunSession, type CapabilityFactory } from '../src/core/run/run-session';
import { createPinCapabilities } from '../src/core/run/ybc-pin-io';
import { createOnboardCapabilities } from '../src/core/simulation/peripherals/onboard-capabilities';

// YB-3 and YB-4 together. Each phase tests its own constructs; these tests check what only the combination has: the
// imports of a program that uses both modules, the module of a program that only sounds, and one run whose
// capabilities come from both factories, composed the way the composition root composes them (src/main.tsx).

const registry = createDeviceRegistry(localDeviceDefinitions);

const generate = (blocks: Json) => {
  const generated = generateYbcMicroPython(compileBlocks(blocks));
  if (!generated.ok) {
    throw new Error(JSON.stringify(generated.diagnostics));
  }
  return generated.source;
};
const importsOf = (source: string) => source.split('\n').filter((line) => /^(import|from)\s/.test(line));

describe('the Python of a program that uses the onboard parts and the header pins', () => {
  it('starts with time, then yolobit with its preamble, then music with its tempo (IM-1…IM-4), and says every statement', () => {
    const source = generate(program([showImage(images.RING), pinWrite('P0', true), playNote('C4', 1)]));
    expect(source.split('\n').slice(1, 8)).toEqual(['import time', ...yolobitModuleLines, 'import music', 'music.set_tempo(4, 120)']);
    expect(source).toContain('display.show(Image("11111:10001:10001:10001:11111"))');
    expect(source).toContain('pin0.write_digital(1)');
    expect(source).toContain("music.play(['C4:1'], wait=True)");
  });

  it('reads an onboard part and a pin in their own forms', () => {
    const source = generate(program([print(lightLevel()), print(pinAnalog('P1'))]));
    expect(source).toContain('print(light_level())');
    expect(source).toContain('print(int(pin1.read_analog()))');
  });

  it('imports only the module each construct needs: a program that only sounds has no yolobit import', () => {
    const sound = program([playNote('C4', 1)]);
    expect(importsOf(generate(sound))).toEqual(['import time', 'import music']);
    expect(usesYolobitModule(compileBlocks(sound))).toBe(false);

    const pin = program([pinWrite('P0', true)]);
    expect(importsOf(generate(pin))).toEqual(['import time', 'from yolobit import *']);
    expect(usesYolobitModule(compileBlocks(pin))).toBe(true);

    const display = program([showImage(images.RING)]);
    expect(importsOf(generate(display))).toEqual(['import time', 'from yolobit import *']);
    expect(usesYolobitModule(compileBlocks(display))).toBe(true);
  });
});

describe('one run with both factories', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const at = { x: 0, y: 0 };
  const wire = (id: string, from: [string, string], to: [string, string]) => ({
    id,
    from: { componentId: from[0], portId: from[1] },
    to: { componentId: to[0], portId: to[1] },
  });
  /** An LED on P0 (through a resistor) to GND. */
  const ledOnP0 = {
    components: [
      { id: 'ybc-board-1', deviceType: 'ybc-board', position: at },
      { id: 'resistor-1', deviceType: 'resistor', position: at },
      { id: 'led-1', deviceType: 'led', position: at },
    ],
    wires: [
      wire('w1', ['ybc-board-1', 'p0'], ['resistor-1', 'a']),
      wire('w2', ['resistor-1', 'b'], ['led-1', 'anode']),
      wire('w3', ['led-1', 'cathode'], ['ybc-board-1', 'gnd']),
    ],
  };

  it('shows a picture, reads a button and lights an LED on P0 in the same program', async () => {
    const pins = createPinCapabilities(registry);
    const composed: CapabilityFactory = (environment) => ({ ...createOnboardCapabilities(environment), ...pins(environment) });
    const session = createRunSession(registry, { capabilities: composed });
    const blocks = program([showImage(images.RING), print(buttonPressed('A')), pinWrite('P0', true)]);
    const document = { ...fixtureDocument('ybc-basic', { blocks }), circuit: ledOnP0 } as ProjectDocument;

    expect(session.start(document)).toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(0);

    const snapshot = session.getSnapshot();
    expect(snapshot.error).toBeNull();
    expect(snapshot.console?.lines).toEqual(['False']);
    expect(snapshot.simulation?.components['ybc-board-1/display']?.frame?.pixels).toEqual(
      [...images.RING.join('')].map((digit) => (digit === '1' ? '#FF0000' : null)),
    );
    expect(snapshot.simulation?.components['led-1']?.lit).toBe(true);
    session.stop();
  });
});
