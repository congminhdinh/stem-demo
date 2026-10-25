import * as Blockly from 'blockly/core';
import 'blockly/blocks';
import * as En from 'blockly/msg/en';
import { describe, expect, it } from 'vitest';
import type { ProjectDocument } from '../src/core/circuit/document';
import { createProgramIO, createVirtualUno, productionKits, robotRoles, type KitCatalog, type PinState, type VirtualUno } from '../src/core/hardware';
import { productionProfiles } from '../src/core/profiles';
import { unoDocument } from '../src/core/profiles/__fixtures__/uno-document';
import { buildToolbox, type ToolboxCategory } from '../src/core/program/block-packs';
import { compileUnoProject, type UnoCompileResult } from '../src/core/program/compile-uno-program';
import { kitWithout, packs, registry } from '../src/core/program/__fixtures__/uno-blocks';
import { startVirtualRun } from '../src/core/run/__fixtures__/virtual-run';
import { canOpenProgram } from '../src/ui/blockly/editor-blocks';

// The Blockly <-> uno compiler contract for the robot's blocks (N18 R2.2, robot plan §4.4; like tests/ybc-blockly-conformance):
// real Blockly, headless, registers the blocks of every known pack, builds programs with every `uno_*` block the way the editor
// does and saves them; the kit-aware compiler (compileUnoProject) must read exactly the JSON Blockly writes, and the program must
// do on the virtual UNO what the blocks say.

Blockly.setLocale(En as unknown as Record<string, string>);
Blockly.common.defineBlocksWithJsonArray(packs.definitions());

const unoTypes = packs.definitions().map((definition) => definition.type).filter((type) => type.startsWith('uno_'));
const covered = new Set<string>();

type Fields = Record<string, string | number>;

function newBlock(workspace: Blockly.Workspace, type: string, id: string, fields: Fields = {}) {
  const block = workspace.newBlock(type, id);
  covered.add(type);
  for (const [name, value] of Object.entries(fields)) {
    block.setFieldValue(value, name);
  }
  return block;
}

function plug(parent: Blockly.Block, inputName: string, child: Blockly.Block) {
  const connection = parent.getInput(inputName)?.connection;
  const childConnection = child.outputConnection ?? child.previousConnection;
  if (!connection || !childConnection) {
    throw new Error(`Cannot plug ${child.type} into ${parent.type}.${inputName}`);
  }
  connection.connect(childConnection);
}

function stack(owner: Blockly.Block, input: string, ...blocks: Blockly.Block[]) {
  blocks.forEach((block, index) => {
    const previous = blocks[index - 1];
    if (!previous) {
      plug(owner, input, block);
    } else if (previous.nextConnection && block.previousConnection) {
      previous.nextConnection.connect(block.previousConnection);
    }
  });
}

const number = (workspace: Blockly.Workspace, id: string, value: number) => newBlock(workspace, 'math_number', id, { NUM: value });
const print = (workspace: Blockly.Workspace, id: string, value: Blockly.Block) => {
  const block = newBlock(workspace, 'text_print', id);
  plug(block, 'TEXT', value);
  return block;
};

/** The blocks of an on start, built as the editor builds them, and saved. */
function build(make: (workspace: Blockly.Workspace) => Blockly.Block[]) {
  const workspace = new Blockly.Workspace();
  try {
    const onStart = newBlock(workspace, 'stem_on_start', 'on-start');
    stack(onStart, 'DO', ...make(workspace));
    return Blockly.serialization.workspaces.save(workspace);
  } finally {
    workspace.dispose();
  }
}

const project = (blocks: unknown, profile: 'uno-basic' | 'uno-advanced', kit?: ProjectDocument['kit']): ProjectDocument =>
  unoDocument(profile, { program: { blocks }, ...(kit ? { kit } : {}) });
const compile = (document: ProjectDocument, kits: KitCatalog = productionKits): UnoCompileResult =>
  compileUnoProject(document, { registry, profiles: productionProfiles, packs, kits });

/** Runs a compiled robot program on the virtual UNO until it ends; the pins and the printed lines after. */
async function runOn(compiled: UnoCompileResult, setup: (uno: VirtualUno) => void = () => {}) {
  if (!compiled.ok) {
    throw new Error(`Does not compile: ${JSON.stringify(compiled.diagnostics)}`);
  }
  let uno: VirtualUno | undefined;
  const run = startVirtualRun(compiled.ir, {
    capabilities: ({ scheduler }) => {
      uno = createVirtualUno(compiled.board, scheduler.programClock);
      setup(uno);
      return createProgramIO(compiled.kit, uno, compiled.uses);
    },
  });
  expect(await run.runUntilDone(200)).not.toBeNull();
  expect(run.outcome()).toEqual({ status: 'finished' });
  const pins = uno?.pins() ?? [];
  return { lines: run.lines(), warnings: run.warnings, pin: (id: string) => pins.find((state) => state.pin === id) as PinState };
}

describe('the robot’s blocks as real Blockly saves them', () => {
  it('Basic: motor, servo, LED, buzzer tone and the three sensor reads compile and run on the virtual UNO', async () => {
    const saved = build((workspace) => {
      const motor = newBlock(workspace, 'uno_motor_set', 'motor', { ROLE: 'motorLeft' });
      plug(motor, 'SPEED', number(workspace, 'speed', 50));
      const servo = newBlock(workspace, 'uno_servo_set', 'servo', { ROLE: 'servo1' });
      plug(servo, 'ANGLE', number(workspace, 'angle', 45));
      const light = newBlock(workspace, 'uno_led_set', 'led', { STATE: 'ON' });
      const tone = newBlock(workspace, 'uno_buzzer_tone', 'tone');
      plug(tone, 'HZ', number(workspace, 'hz', 880));
      plug(tone, 'MS', number(workspace, 'ms', 30));
      return [
        motor,
        servo,
        light,
        tone,
        print(workspace, 'p1', newBlock(workspace, 'uno_ultrasonic_cm', 'cm')),
        print(workspace, 'p2', newBlock(workspace, 'uno_line_dark', 'dark', { ROLE: 'lineCenter' })),
        print(workspace, 'p3', newBlock(workspace, 'uno_button_pressed', 'pressed')),
      ];
    });
    expect(canOpenProgram(saved, packs)).toBe(true);
    const { lines, pin } = await runOn(compile(project(saved, 'uno-basic')), (uno) => {
      uno.attachPulseSource('D11', () => ({ waitUs: 450, widthUs: 30 * 58 }));
      uno.attachDigitalSource('A1', () => 1);
      uno.attachDigitalSource('D3', () => 0);
    });
    expect([pin('D5').duty, pin('D7').level, pin('D8').level, pin('D9').servoDeg, pin('D13').level, pin('D10').toneHz]).toEqual([128, 1, 0, 45, 1, 880]);
    expect(lines).toEqual(['30', '1', '1']);
  });

  it('Basic: the drive in each direction Blockly offers, and stop', async () => {
    const levels: number[][] = [];
    for (const direction of ['forward', 'backward', 'spinLeft', 'spinRight']) {
      const saved = build((workspace) => {
        const drive = newBlock(workspace, 'uno_drive_move', 'drive', { DIRECTION: direction });
        plug(drive, 'SPEED', number(workspace, 'speed', 60));
        return [drive];
      });
      const { pin } = await runOn(compile(project(saved, 'uno-basic')));
      levels.push(['D7', 'D8', 'D4', 'D2'].map((id) => pin(id).level));
    }
    expect(levels).toEqual([
      [1, 0, 1, 0],
      [0, 1, 0, 1],
      [0, 1, 1, 0],
      [1, 0, 0, 1],
    ]);
    const stopped = build((workspace) => {
      const drive = newBlock(workspace, 'uno_drive_move', 'drive', { DIRECTION: 'forward' });
      plug(drive, 'SPEED', number(workspace, 'speed', 60));
      return [drive, newBlock(workspace, 'uno_drive_stop', 'stop')];
    });
    const { pin } = await runOn(compile(project(stopped, 'uno-basic')));
    expect([pin('D5').duty, pin('D6').duty]).toEqual([0, 0]);
  });

  it('Advanced: the raw line value, buzzer stop, millis and the raw pins', async () => {
    const saved = build((workspace) => {
      const pause = newBlock(workspace, 'ybc_wait_ms', 'wait');
      plug(pause, 'MS', number(workspace, 'ms', 100));
      const tone = newBlock(workspace, 'uno_buzzer_tone', 'tone');
      plug(tone, 'HZ', number(workspace, 'hz', 440));
      plug(tone, 'MS', number(workspace, 'len', 500));
      return [
        pause,
        print(workspace, 'p0', newBlock(workspace, 'uno_millis', 'millis')),
        print(workspace, 'p1', newBlock(workspace, 'uno_line_raw', 'raw', { ROLE: 'lineRight' })),
        tone,
        newBlock(workspace, 'uno_buzzer_stop', 'quiet'),
        newBlock(workspace, 'uno_digital_write', 'write', { PIN: 'A4', LEVEL: 'HIGH' }),
        print(workspace, 'p2', newBlock(workspace, 'uno_digital_read', 'read', { PIN: 'D3' })),
        print(workspace, 'p3', newBlock(workspace, 'uno_analog_read', 'analog', { PIN: 'A0' })),
      ];
    });
    expect(canOpenProgram(saved, packs)).toBe(true);
    const { lines, pin } = await runOn(compile(project(saved, 'uno-advanced')), (uno) => {
      uno.attachAnalogSource('A2', () => 700);
      uno.attachDigitalSource('D3', () => 1);
      uno.attachAnalogSource('A0', () => 300);
    });
    expect(lines).toEqual(['99', '700', '1', '300']);
    expect([pin('D10').toneHz, pin('A4').mode, pin('A4').level]).toEqual([null, 'OUTPUT', 1]);
  });

  it('Advanced: a PWM write is pin-unavailable on ref-uno-rover@0 at the pin Blockly starts with, and drives a pin a kit leaves free', async () => {
    const saved = (pin?: string) =>
      build((workspace) => {
        const write = newBlock(workspace, 'uno_pwm_write', 'pwm', pin ? { PIN: pin } : {});
        plug(write, 'VALUE', number(workspace, 'value', 200));
        return [write];
      });
    const onReference = compile(project(saved(), 'uno-advanced'));
    expect(onReference).toMatchObject({ ok: false, reason: 'compile', diagnostics: [{ code: 'pin-unavailable', blockId: 'pwm', message: 'pwm.write cannot use D3: port BTN1 of the kit uses it.' }] });
    const free = kitWithout('buzzer');
    const { pin } = await runOn(compile(project(saved('D10'), 'uno-advanced', free.ref), free.kits));
    expect(pin('D10').duty).toBe(200);
  });

  it('Basic: the UNO’s own division and count up (fix round 1): -7 / 2 is -3, the count goes by 1 and saves no step', async () => {
    const workspace = new Blockly.Workspace();
    let saved: Record<string, unknown>;
    try {
      const variable = workspace.getVariableMap().createVariable('i', '', 'i-id');
      const onStart = newBlock(workspace, 'stem_on_start', 'on-start');
      const divide = newBlock(workspace, 'uno_int_divide', 'divide');
      plug(divide, 'A', number(workspace, 'a', -7));
      plug(divide, 'B', number(workspace, 'b', 2));
      const count = newBlock(workspace, 'uno_count_up', 'count');
      count.setFieldValue(variable.getId(), 'VAR');
      plug(count, 'FROM', number(workspace, 'from', 1));
      plug(count, 'TO', number(workspace, 'to', 3));
      const get = newBlock(workspace, 'variables_get', 'get');
      get.setFieldValue(variable.getId(), 'VAR');
      plug(count, 'DO', print(workspace, 'p-i', get));
      stack(onStart, 'DO', print(workspace, 'p-divide', divide), count);
      saved = Blockly.serialization.workspaces.save(workspace);
    } finally {
      workspace.dispose();
    }
    expect(JSON.stringify(saved)).not.toContain('STEP');
    expect(canOpenProgram(saved, packs)).toBe(true);
    const { lines } = await runOn(compile(project(saved, 'uno-basic')));
    expect(lines).toEqual(['-3', '1', '2', '3']);
  });

  it('builds every uno_* block the packs register', () => {
    expect([...covered].filter((type) => type.startsWith('uno_')).sort()).toEqual([...unoTypes].sort());
    expect(unoTypes).toHaveLength(18);
  });
});

describe('the robot’s blocks as Blockly registers them', () => {
  const withWorkspace = <T>(use: (workspace: Blockly.Workspace) => T): T => {
    const workspace = new Blockly.Workspace();
    try {
      return use(workspace);
    } finally {
      workspace.dispose();
    }
  };
  const options = (block: Blockly.Block, name: string) => (block.getField(name) as Blockly.FieldDropdown).getOptions(false).map(([, value]) => value);

  it('lists the full role vocabulary across the role dropdowns (robot plan §4.2); the kit decides what compiles', () => {
    withWorkspace((workspace) => {
      const roles = [
        ...options(workspace.newBlock('uno_motor_set'), 'ROLE'),
        ...options(workspace.newBlock('uno_line_dark'), 'ROLE'),
        ...options(workspace.newBlock('uno_servo_set'), 'ROLE'),
      ];
      expect(roles).toEqual(['motorLeft', 'motorRight', 'lineLeft', 'lineCenter', 'lineRight', 'servo1']);
      expect(options(workspace.newBlock('uno_line_raw'), 'ROLE')).toEqual(['lineLeft', 'lineCenter', 'lineRight']);
      // The other four roles are their block's own: ultrasonic, LED, buzzer, button.
      expect(robotRoles.filter((role) => !roles.includes(role))).toEqual(['ultrasonic', 'led1', 'buzzer', 'button1']);
    });
  });

  it('offers the pins of the UNO board for the raw pins: all for digital, the PWM pins for PWM, A0–A5 for analog', () => {
    withWorkspace((workspace) => {
      const digital = [...Array.from({ length: 14 }, (_, index) => `D${String(index)}`), 'A0', 'A1', 'A2', 'A3', 'A4', 'A5'];
      expect(options(workspace.newBlock('uno_digital_write'), 'PIN')).toEqual(digital);
      expect(options(workspace.newBlock('uno_digital_write'), 'LEVEL')).toEqual(['HIGH', 'LOW']);
      expect(options(workspace.newBlock('uno_digital_read'), 'PIN')).toEqual(digital);
      expect(options(workspace.newBlock('uno_pwm_write'), 'PIN')).toEqual(['D3', 'D5', 'D6', 'D9', 'D10', 'D11']);
      expect(options(workspace.newBlock('uno_analog_read'), 'PIN')).toEqual(['A0', 'A1', 'A2', 'A3', 'A4', 'A5']);
      expect(options(workspace.newBlock('uno_drive_move'), 'DIRECTION')).toEqual(['forward', 'backward', 'spinLeft', 'spinRight']);
      expect(options(workspace.newBlock('uno_led_set'), 'STATE')).toEqual(['ON', 'OFF']);
    });
  });

  it('connects each block as its construct needs: the reads give a value, the rest are statements', () => {
    withWorkspace((workspace) => {
      const values = new Map([
        ['uno_ultrasonic_cm', 'Number'],
        ['uno_line_dark', 'Boolean'],
        ['uno_button_pressed', 'Boolean'],
        ['uno_line_raw', 'Number'],
        ['uno_digital_read', 'Boolean'],
        ['uno_analog_read', 'Number'],
        ['uno_millis', 'Number'],
        ['uno_int_divide', 'Number'],
      ]);
      for (const type of unoTypes) {
        const block = workspace.newBlock(type);
        if (values.has(type)) {
          expect(block.outputConnection?.getCheck(), type).toEqual([values.get(type)]);
          expect(block.previousConnection, type).toBeNull();
        } else {
          expect(block.outputConnection, type).toBeNull();
          expect(block.previousConnection, type).not.toBeNull();
          expect(block.nextConnection, type).not.toBeNull();
        }
      }
    });
  });

  it('loads every block of both robot toolboxes with its presets, and each compiles on its own as the toolbox gives it', () => {
    const blocksOf = (contents: readonly unknown[]): { type: string; fields?: Fields; inputs?: Record<string, unknown> }[] =>
      contents.flatMap((item) => {
        const entry = item as { kind?: string; type?: string; contents?: readonly unknown[] };
        return entry.kind === 'block' && typeof entry.type === 'string' ? [entry as { type: string }] : blocksOf(entry.contents ?? []);
      });
    for (const profile of ['uno-basic', 'uno-advanced'] as const) {
      const toolbox = buildToolbox(productionProfiles.get(profile)?.blockPacks ?? [], packs);
      const blocks = blocksOf(toolbox.contents as readonly ToolboxCategory[]);
      withWorkspace((workspace) => {
        for (const entry of blocks) {
          const state = { type: entry.type, ...(entry.fields ? { fields: entry.fields } : {}), ...(entry.inputs ? { inputs: entry.inputs } : {}) } as Blockly.serialization.blocks.State;
          const block = Blockly.serialization.blocks.append(state, workspace);
          for (const [name, value] of Object.entries(entry.fields ?? {})) {
            expect(block.getFieldValue(name), `${profile} ${entry.type}.${name}`).toBe(value);
          }
        }
      });
      expect(blocks.filter((entry) => entry.type.startsWith('uno_')).length, profile).toBeGreaterThan(profile === 'uno-basic' ? 10 : 16);
    }
  });
});
