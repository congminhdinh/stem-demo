import * as Blockly from 'blockly';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Frame } from '../src/core/capabilities/frame';
import type { Capabilities } from '../src/core/capabilities/io';
import { clearDisplayType, pixelFieldName, scrollNumberType, scrollTextType, showImageType } from '../src/core/constructs/ybc.display';
import { buttonPressedType, buttonPressesType, lightLevelType } from '../src/core/constructs/ybc.input';
import { noteNames, noteTicks, playNoteType, restType } from '../src/core/constructs/ybc.sound';
import { localDeviceDefinitions } from '../src/core/devices/local-catalog';
import { boardTargetOf } from '../src/core/devices/board-pins';
import { createDeviceRegistry } from '../src/core/devices/registry';
import { productionProfiles } from '../src/core/profiles';
import { capabilitiesOf } from '../src/core/profiles/board-context';
import { buildToolbox, createBlockPackCatalog } from '../src/core/program/block-packs';
import { compileYbcProgram } from '../src/core/program/compile-ybc-program';
import { createRunConsole } from '../src/core/program/console';
import {
  buttonPressed, buttonPresses, chain, clearDisplay, images, lightLevel, playNote, print, program, rest, scrollNumber, scrollText, showImage, text, num,
  type ImageRows, type Json,
} from '../src/core/program/__fixtures__/ybc-blocks';
import { runYbc } from '../src/core/program/__fixtures__/run-ybc';
import { noteHz } from '../src/core/simulation/peripherals/sound';
import { canOpenProgram, registerBlocks } from '../src/ui/blockly/editor-blocks';

// The Blockly <-> YBC compiler contract for the YB-3 hardware blocks (plan §9.4, risk R2): real Blockly, headless,
// builds each block (the squares of a picture through setFieldValue, the dropdowns, the preset values of the toolbox)
// and saves it. What Blockly saves must be the JSON the fixture builders write for the same configuration, the compiler
// must read exactly that JSON, and the interpreter must call the parts of the board the way the contract says.

const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);
// What the editor registers: the blocks of every known pack.
registerBlocks(packs);
const basic = productionProfiles.get('ybc-basic');
const exposed = packs.typesOf(basic?.blockPacks ?? []);
const boardCapabilities = capabilitiesOf(registry.get('ybc-board'));
/** The compile target Run and generation use for the `ybc-board`: its capabilities and usable pins. */
const boardTarget = boardTargetOf(registry.get('ybc-board'), boardCapabilities);

type Fields = Record<string, string | number | boolean>;

function newBlock(workspace: Blockly.Workspace, type: string, id: string, fields: Fields = {}) {
  const block = workspace.newBlock(type, id);
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

/** A statement stack under `owner.input`, linked by next connections. */
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

/** Makes the blocks of a program, the way the editor does, and saves them. */
function build(make: (workspace: Blockly.Workspace, onStart: Blockly.Block) => void) {
  const workspace = new Blockly.Workspace();
  try {
    const onStart = newBlock(workspace, 'stem_on_start', 'on-start');
    onStart.moveBy(40, 40);
    make(workspace, onStart);
    return Blockly.serialization.workspaces.save(workspace);
  } finally {
    workspace.dispose();
  }
}

/** Loads JSON into a fresh workspace and saves it again: what the editor does with a stored program. */
function reload(blocks: Record<string, unknown>) {
  const workspace = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(blocks, workspace);
    return Blockly.serialization.workspaces.save(workspace);
  } finally {
    workspace.dispose();
  }
}

const asRecord = (value: unknown) => value as Record<string, unknown>;
/** The statements under the `on start` of a saved workspace, as the chain Blockly wrote. */
const savedChain = (saved: Record<string, unknown>) => asRecord(asRecord(asRecord(asRecord(saved.blocks).blocks as unknown[])[0]).inputs).DO as Record<string, unknown> | undefined;
const savedBlock = (saved: Record<string, unknown>) => asRecord(savedChain(saved)).block;

/** The same JSON without the ids, for blocks Blockly named itself. */
function withoutIds(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withoutIds);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'id')
        .map(([key, child]) => [key, withoutIds(child)]),
    );
  }
  return value;
}

/** The parts of a board, recording every call in order: `calls` is the log of the capabilities and of `sleep`. */
function fakeBoard(world: { held?: Partial<Record<'a' | 'b', boolean>>; presses?: Partial<Record<'a' | 'b', number>>; light?: number } = {}) {
  const calls: string[] = [];
  const frames: Frame[] = [];
  const capabilities: Capabilities = {
    display: {
      setFrame(frame) {
        calls.push('setFrame');
        frames.push(frame);
      },
    },
    buttons: {
      isPressed(id) {
        calls.push(`isPressed ${id}`);
        return world.held?.[id] ?? false;
      },
      takePresses(id) {
        calls.push(`takePresses ${id}`);
        return world.presses?.[id] ?? 0;
      },
    },
    light: {
      lightLevel() {
        calls.push('lightLevel');
        return world.light ?? 50;
      },
    },
    sound: {
      startTone(hz) {
        calls.push(`startTone ${hz}`);
      },
      stopTone() {
        calls.push('stopTone');
      },
    },
  };
  // A clock that only the program's own sleeps advance, like the sleeps that do not wait: the scroll counts its columns on it.
  let time = 0;
  const sleep = (ms: number) => {
    calls.push(`sleep ${ms}`);
    time += ms;
    return Promise.resolve();
  };
  return { calls, frames, capabilities, sleep, now: () => time };
}

/** Compiles the saved workspace for the ybc-board in the Basic profile, and runs it on the fake board. */
async function compileAndRun(saved: Record<string, unknown>, world: Parameters<typeof fakeBoard>[0] = {}) {
  const compiled = compileYbcProgram(saved, exposed, undefined, boardTarget);
  if (!compiled.ok) {
    throw new Error(`Does not compile: ${JSON.stringify(compiled.diagnostics)}`);
  }
  const board = fakeBoard(world);
  const runConsole = createRunConsole();
  const outcome = await runYbc(compiled.ir, { sleep: board.sleep, console: runConsole, now: board.now, yieldNow: () => Promise.resolve() }, board.capabilities).done;
  return { ...board, outcome, lines: runConsole.snapshot().lines, ir: compiled.ir };
}

/** The picture as a frame the way the contract draws it: a lit cell is red, row by row from the top left. */
const frameOf = (rows: ImageRows): (string | null)[] => rows.flatMap((digits) => [...digits].map((digit) => (digit === '1' ? '#FF0000' : null)));

/** Lights the squares of a block the way a learner clicks them: one setFieldValue per lit cell. */
function lightSquares(block: Blockly.Block, rows: ImageRows) {
  rows.forEach((digits, row) => {
    [...digits].forEach((digit, column) => {
      if (digit === '1') {
        block.setFieldValue(true, pixelFieldName(row, column));
      }
    });
  });
}

describe('"show image" as real Blockly builds it', () => {
  it('has 25 checkboxes named R{row}C{col}, five to a row, in reading order', () => {
    const workspace = new Blockly.Workspace();
    try {
      const block = workspace.newBlock(showImageType);
      const rows = block.inputList.map((input) => input.fieldRow.filter((field) => field.name !== undefined));
      // The first input holds the label; each of the five after it holds one row of the picture.
      expect(rows.map((fields) => fields.length)).toEqual([0, 5, 5, 5, 5, 5]);
      rows.slice(1).forEach((fields, row) => {
        expect(fields.map((field) => field.name)).toEqual([0, 1, 2, 3, 4].map((column) => `R${row}C${column}`));
        for (const field of fields) {
          expect(field, field.name).toBeInstanceOf(Blockly.FieldCheckbox);
        }
      });
      // A new block is a dark picture, and ticking a square lights that square and no other.
      const lit = () => rows.slice(1).flat().filter((field) => (field as Blockly.FieldCheckbox).getValueBoolean()).map((field) => field.name);
      expect(lit()).toEqual([]);
      block.setFieldValue(true, 'R1C3');
      expect(lit()).toEqual(['R1C3']);
    } finally {
      workspace.dispose();
    }
  });

  it.each(Object.entries(images))('saves the picture %s the way the fixture writes it, with every square written', (_name, rows) => {
    const fixture = showImage(rows);
    const saved = build((workspace, onStart) => {
      const block = newBlock(workspace, showImageType, String(fixture.id));
      lightSquares(block, rows);
      plug(onStart, 'DO', block);
    });
    expect(savedBlock(saved)).toEqual(fixture);
    expect(Object.keys(asRecord(asRecord(savedBlock(saved)).fields))).toHaveLength(25);
  });

  it('saves a lone lit square at column 3, row 1 under R1C3', () => {
    const saved = build((workspace, onStart) => {
      const block = newBlock(workspace, showImageType, 'dot');
      block.setFieldValue(true, 'R1C3');
      plug(onStart, 'DO', block);
    });
    const fields = asRecord(asRecord(savedBlock(saved)).fields);
    expect(Object.entries(fields).filter(([, lit]) => lit === true)).toEqual([['R1C3', true]]);
  });

  it('compiles to the 25 cells row by row, and shows them as one frame of red lights when it runs', async () => {
    const rows: ImageRows = ['01000', '00100', '00010', '00001', '10000'];
    const saved = build((workspace, onStart) => {
      const block = newBlock(workspace, showImageType, 'picture');
      lightSquares(block, rows);
      plug(onStart, 'DO', block);
    });
    const { ir, calls, frames, outcome } = await compileAndRun(saved);
    expect(ir.onStart).toMatchObject([{ op: 'display.show', operand: { image: { source: 'custom' } } }]);
    expect(outcome).toEqual({ status: 'finished' });
    expect(calls).toEqual(['setFrame']);
    expect(frames).toEqual([{ pixels: frameOf(rows) }]);
    // Column x and row y at index y * 5 + x: square R0C1 is the second light of the first row, R4C0 the first of the last.
    expect(frames[0]?.pixels[1]).toBe('#FF0000');
    expect(frames[0]?.pixels[20]).toBe('#FF0000');
    expect(frames[0]?.pixels[5]).toBeNull();
  });

  it('reloads unchanged, picture and all', () => {
    for (const rows of Object.values(images)) {
      const saved = build((workspace, onStart) => {
        const block = newBlock(workspace, showImageType, 'picture');
        lightSquares(block, rows);
        plug(onStart, 'DO', block);
      });
      expect(reload(saved)).toEqual(saved);
    }
  });
});

describe('every other hardware block as real Blockly builds it', () => {
  it('saves "scroll text" with its text block, compiles it and scrolls it: 12 columns and a blank frame for "Hi", 200 ms each', async () => {
    const fixture = scrollText(text('Hi'));
    const literal = asRecord(asRecord(asRecord(fixture.inputs).TEXT).block);
    const saved = build((workspace, onStart) => {
      const block = newBlock(workspace, scrollTextType, String(fixture.id));
      plug(block, 'TEXT', newBlock(workspace, 'text', String(literal.id), { TEXT: 'Hi' }));
      plug(onStart, 'DO', block);
    });
    expect(savedBlock(saved)).toEqual(fixture);

    const { calls, frames, outcome } = await compileAndRun(saved);
    expect(outcome).toEqual({ status: 'finished' });
    expect(calls).toEqual([...Array.from({ length: 12 }, () => ['setFrame', 'sleep 200']).flat(), 'setFrame']);
    expect(frames).toHaveLength(13);
    expect(frames.at(-1)?.pixels.every((pixel) => pixel === null)).toBe(true);
  });

  it('saves "scroll number" with its number block, compiles it and shows the digits of str(n): 42 scrolls for 2 x 1200 ms', async () => {
    const fixture = scrollNumber(num(42));
    const literal = asRecord(asRecord(asRecord(fixture.inputs).NUM).block);
    const saved = build((workspace, onStart) => {
      const block = newBlock(workspace, scrollNumberType, String(fixture.id));
      plug(block, 'NUM', newBlock(workspace, 'math_number', String(literal.id), { NUM: 42 }));
      plug(onStart, 'DO', block);
    });
    expect(savedBlock(saved)).toEqual(fixture);

    const { calls, outcome } = await compileAndRun(saved);
    expect(outcome).toEqual({ status: 'finished' });
    expect(calls.filter((call) => call === 'sleep 200')).toHaveLength(12);
  });

  it('shows a single character without scrolling: it stays, and the program does not wait', async () => {
    const saved = build((workspace, onStart) => {
      const block = newBlock(workspace, scrollTextType, 'one');
      plug(block, 'TEXT', newBlock(workspace, 'text', 'one-text', { TEXT: 'A' }));
      plug(onStart, 'DO', block);
    });
    const { calls, frames } = await compileAndRun(saved);
    expect(calls).toEqual(['setFrame']);
    expect(frames).toHaveLength(1);
  });

  it('saves "clear display", compiles it and turns every light off', async () => {
    const fixture = clearDisplay();
    const saved = build((workspace, onStart) => {
      plug(onStart, 'DO', newBlock(workspace, clearDisplayType, String(fixture.id)));
    });
    expect(savedBlock(saved)).toEqual(fixture);

    const { calls, frames } = await compileAndRun(saved);
    expect(calls).toEqual(['setFrame']);
    expect(frames[0]?.pixels).toEqual(Array.from({ length: 25 }, () => null));
  });

  it.each([
    ['A', { a: true, b: false }, true, 'a'],
    ['B', { a: true, b: false }, false, 'b'],
    ['B', { a: false, b: true }, true, 'b'],
  ] as const)('saves "button %s is pressed", compiles it, and asks the board for that button only', async (button, held, expected, id) => {
    const fixture = print(buttonPressed(button));
    const read = asRecord(asRecord(asRecord(fixture.inputs).TEXT).block);
    const saved = build((workspace, onStart) => {
      const printBlock = newBlock(workspace, 'text_print', String(fixture.id));
      plug(printBlock, 'TEXT', newBlock(workspace, buttonPressedType, String(read.id), { BUTTON: button }));
      plug(onStart, 'DO', printBlock);
    });
    expect(savedBlock(saved)).toEqual(fixture);

    const { calls, lines } = await compileAndRun(saved, { held });
    expect(calls).toEqual([`isPressed ${id}`]);
    expect(lines).toEqual([expected ? 'True' : 'False']);
  });

  it.each([
    ['A', { a: 3, b: 9 }, 3, 'a'],
    ['B', { a: 3, b: 9 }, 9, 'b'],
  ] as const)('saves "presses of button %s", compiles it, and takes the presses of that button only', async (button, presses, expected, id) => {
    const fixture = print(buttonPresses(button));
    const read = asRecord(asRecord(asRecord(fixture.inputs).TEXT).block);
    const saved = build((workspace, onStart) => {
      const printBlock = newBlock(workspace, 'text_print', String(fixture.id));
      plug(printBlock, 'TEXT', newBlock(workspace, buttonPressesType, String(read.id), { BUTTON: button }));
      plug(onStart, 'DO', printBlock);
    });
    expect(savedBlock(saved)).toEqual(fixture);

    const { calls, lines } = await compileAndRun(saved, { presses });
    expect(calls).toEqual([`takePresses ${id}`]);
    expect(lines).toEqual([String(expected)]);
  });

  it('saves "light level", compiles it and prints what the sensor reads', async () => {
    const fixture = print(lightLevel());
    const read = asRecord(asRecord(asRecord(fixture.inputs).TEXT).block);
    const saved = build((workspace, onStart) => {
      const printBlock = newBlock(workspace, 'text_print', String(fixture.id));
      plug(printBlock, 'TEXT', newBlock(workspace, lightLevelType, String(read.id)));
      plug(onStart, 'DO', printBlock);
    });
    expect(savedBlock(saved)).toEqual(fixture);

    const { calls, lines } = await compileAndRun(saved, { light: 78 });
    expect(calls).toEqual(['lightLevel']);
    expect(lines).toEqual(['78']);
  });

  it('saves "play note C4 for 4 ticks", compiles it, and sounds 262 Hz for 500 ms: the tone starts, the program waits, the tone stops', async () => {
    const fixture = playNote('C4', 4);
    const saved = build((workspace, onStart) => {
      plug(onStart, 'DO', newBlock(workspace, playNoteType, String(fixture.id), { NOTE: 'C4', TICKS: '4' }));
    });
    expect(savedBlock(saved)).toEqual(fixture);

    const { calls, outcome } = await compileAndRun(saved);
    expect(outcome).toEqual({ status: 'finished' });
    expect(calls).toEqual(['startTone 262', 'sleep 500', 'stopTone']);
  });

  it('saves "rest for 2 ticks", compiles it, and only waits 250 ms: no tone', async () => {
    const fixture = rest(2);
    const saved = build((workspace, onStart) => {
      plug(onStart, 'DO', newBlock(workspace, restType, String(fixture.id), { TICKS: '2' }));
    });
    expect(savedBlock(saved)).toEqual(fixture);

    const { calls } = await compileAndRun(saved);
    expect(calls).toEqual(['sleep 250']);
  });

  it('saves every one of the 45 notes and lengths as the fixture does, and sounds the note of the table for as long as the length says', async () => {
    for (const note of noteNames) {
      for (const ticks of noteTicks) {
        const fixture = playNote(note, ticks);
        const saved = build((workspace, onStart) => {
          plug(onStart, 'DO', newBlock(workspace, playNoteType, String(fixture.id), { NOTE: note, TICKS: String(ticks) }));
        });
        expect(savedBlock(saved), `${note} ${ticks}`).toEqual(fixture);
        const { calls } = await compileAndRun(saved);
        expect(calls, `${note} ${ticks}`).toEqual([`startTone ${noteHz[note]}`, `sleep ${ticks * 125}`, 'stopTone']);
      }
    }
  });

  it('saves a stack of hardware statements linked by next, as the fixture chain does, and runs them in order', async () => {
    const fixtures = [showImage(images.RING), scrollText(text('A')), clearDisplay(), playNote('G4', 2), rest(1)];
    const literal = asRecord(asRecord(asRecord(fixtures[1]?.inputs).TEXT).block);
    const saved = build((workspace, onStart) => {
      const ring = newBlock(workspace, showImageType, String(fixtures[0]?.id));
      lightSquares(ring, images.RING);
      const scroll = newBlock(workspace, scrollTextType, String(fixtures[1]?.id));
      plug(scroll, 'TEXT', newBlock(workspace, 'text', String(literal.id), { TEXT: 'A' }));
      stack(
        onStart,
        'DO',
        ring,
        scroll,
        newBlock(workspace, clearDisplayType, String(fixtures[2]?.id)),
        newBlock(workspace, playNoteType, String(fixtures[3]?.id), { NOTE: 'G4', TICKS: '2' }),
        newBlock(workspace, restType, String(fixtures[4]?.id), { TICKS: '1' }),
      );
    });
    expect(savedBlock(saved)).toEqual(chain(fixtures));

    const { calls } = await compileAndRun(saved);
    expect(calls).toEqual(['setFrame', 'setFrame', 'setFrame', 'startTone 392', 'sleep 250', 'stopTone', 'sleep 125']);
  });

  it('saves the same program the fixture builder writes, ids and all, once the position of the hat is set aside', () => {
    const fixtures = [clearDisplay(), rest(4)];
    const saved = build((workspace, onStart) => {
      stack(onStart, 'DO', newBlock(workspace, clearDisplayType, String(fixtures[0]?.id)), newBlock(workspace, restType, String(fixtures[1]?.id), { TICKS: '4' }));
    });
    const hat = asRecord(asRecord(asRecord(saved.blocks).blocks as unknown[])[0]);
    const { x, y, ...others } = hat;
    expect([x, y]).toEqual([40, 40]);
    expect(others).toEqual(asRecord(asRecord(asRecord(program(fixtures).blocks).blocks as unknown[])[0]));
  });
});

describe('the preset values of the toolbox, as real Blockly creates the blocks', () => {
  const toolbox = buildToolbox(basic?.blockPacks ?? [], packs);
  const presets: Record<string, unknown>[] = [];
  const collect = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(collect);
    } else if (typeof value === 'object' && value !== null) {
      const record = value as Record<string, unknown>;
      if (record.kind === 'block' && typeof record.type === 'string' && packs.isKnown(record.type) && /^ybc_(display|button|light|sound)/.test(record.type)) {
        presets.push(record);
      }
      Object.values(record).forEach(collect);
    }
  };
  collect(toolbox.contents);
  const valueBlocks = new Set([buttonPressedType, buttonPressesType, lightLevelType]);

  /** Appends the toolbox entry to a workspace the way the flyout does when the learner drags it, and plugs it into the program. */
  function dragged(preset: Record<string, unknown>) {
    return build((workspace, onStart) => {
      // The flyout hands Blockly the entry without its `kind`.
      const state = Object.fromEntries(Object.entries(preset).filter(([key]) => key !== 'kind'));
      const block = Blockly.serialization.blocks.append(state as unknown as Blockly.serialization.blocks.State, workspace);
      if (valueBlocks.has(String(preset.type))) {
        const printBlock = newBlock(workspace, 'text_print', 'print-preset');
        plug(printBlock, 'TEXT', block);
        plug(onStart, 'DO', printBlock);
      } else {
        plug(onStart, 'DO', block);
      }
    });
  }

  it('finds the eleven blocks the toolbox offers for the hardware', () => {
    // Show image, scroll text, scroll number, clear; button pressed A and B, presses A and B, light; note, rest.
    expect(presets.map((preset) => preset.type)).toEqual([
      showImageType, scrollTextType, scrollNumberType, clearDisplayType,
      buttonPressedType, buttonPressedType, buttonPressesType, buttonPressesType, lightLevelType,
      playNoteType, restType,
    ]);
  });

  it.each(presets.map((preset, index) => [`${String(preset.type)} #${index}`, preset] as const))('keeps the preset of %s through Blockly, compiles and runs it', async (_name, preset) => {
    const saved = dragged(preset);
    const block = valueBlocks.has(String(preset.type)) ? asRecord(asRecord(asRecord(asRecord(savedBlock(saved)).inputs).TEXT).block) : asRecord(savedBlock(saved));
    // The values the toolbox presets are saved as they are: Blockly neither drops nor replaces one.
    expect(asRecord(block).fields).toEqual(preset.fields);
    expect(compileYbcProgram(saved, exposed, undefined, boardTarget).ok).toBe(true);
    const { outcome } = await compileAndRun(saved);
    expect(outcome).toEqual({ status: 'finished' });
  });

  it('starts "show image" with the ring, all 25 squares written, as the fixture picture RING', async () => {
    const [ring] = presets;
    const saved = dragged(ring ?? {});
    expect(withoutIds(savedBlock(saved))).toEqual(withoutIds(showImage(images.RING)));
    const { frames } = await compileAndRun(saved);
    expect(frames[0]?.pixels).toEqual(frameOf(images.RING));
  });

  it('starts "play note" with C4 for 4 ticks and "rest" with 4 ticks, the 500 ms of the contract sample', async () => {
    const note = presets.find((preset) => preset.type === playNoteType);
    const silence = presets.find((preset) => preset.type === restType);
    expect((await compileAndRun(dragged(note ?? {}))).calls).toEqual(['startTone 262', 'sleep 500', 'stopTone']);
    expect((await compileAndRun(dragged(silence ?? {}))).calls).toEqual(['sleep 500']);
  });
});

describe('what Blockly does with a value outside the domain', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    // Blockly says so when a dropdown is given a value it does not offer.
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
  });

  const hostile = (block: Json) => program([block]);
  const compileRaw = (blocks: Json) => compileYbcProgram(blocks, exposed, undefined, boardTarget);
  const fieldsOfSaved = (saved: Record<string, unknown>) => asRecord(asRecord(savedBlock(saved)).fields);

  it.each(['E9', 'C6', 'C2', 'DB4', 'C#4', 'c4', ''])('replaces the note %j by the first option, C3, when it loads, and saves it back as such', (note) => {
    const raw = hostile({ ...playNote('C4', 4), fields: { NOTE: note, TICKS: '4' } });
    expect(compileRaw(raw).diagnostics.map((d) => d.code), 'the compiler still refuses the raw JSON').toEqual(['value-out-of-range']);

    const saved = reload(raw);
    expect(fieldsOfSaved(saved)).toEqual({ NOTE: 'C3', TICKS: '4' });
    expect(compileRaw(saved as Json).ok, 'what the editor saves is inside the domain').toBe(true);
    expect(warn).toHaveBeenCalled();
  });

  it.each(['3', '8', '0', '16', '', '1.0'])('replaces the length %j of a note and of a rest by the first option, 1, when it loads', (ticks) => {
    for (const block of [{ ...playNote('C4', 4), fields: { NOTE: 'C4', TICKS: ticks } }, { ...rest(4), fields: { TICKS: ticks } }]) {
      const raw = hostile(block);
      expect(compileRaw(raw).diagnostics.map((d) => d.code)).toEqual(['value-out-of-range']);
      const saved = reload(raw);
      expect(fieldsOfSaved(saved).TICKS).toBe('1');
      expect(compileRaw(saved as Json).ok).toBe(true);
    }
  });

  it('replaces a length written as a number, which is not the text of an option, by the first option', () => {
    for (const ticks of [2, 4, 8]) {
      for (const block of [{ ...playNote('C4', 4), fields: { NOTE: 'C4', TICKS: ticks } }, { ...rest(4), fields: { TICKS: ticks } }]) {
        const raw = hostile(block);
        expect(compileRaw(raw).diagnostics.map((d) => d.code), `${ticks}`).toEqual(['malformed-program']);
        const saved = reload(raw);
        expect(fieldsOfSaved(saved).TICKS, `${ticks}`).toBe('1');
        expect(compileRaw(saved as Json).ok, `${ticks}`).toBe(true);
      }
    }
  });

  it.each(['AB', 'A+B', 'C', 'a', ''])('replaces the button %j by the first option, A, when it loads', (button) => {
    for (const make of [buttonPressed, buttonPresses]) {
      const raw = hostile(print({ ...make('B'), fields: { BUTTON: button } }));
      expect(compileRaw(raw).diagnostics.map((d) => d.code)).toEqual(['value-out-of-range']);
      const saved = reload(raw);
      const read = asRecord(asRecord(asRecord(asRecord(savedBlock(saved)).inputs).TEXT).block);
      expect(read.fields).toEqual({ BUTTON: 'A' });
      expect(compileRaw(saved as Json).ok).toBe(true);
    }
  });

  it('keeps a value that is inside the domain exactly as it was: the replacement is only for what the dropdown does not offer', () => {
    const raw = hostile({ ...playNote('C4', 4), fields: { NOTE: 'B4', TICKS: '2' } });
    expect(fieldsOfSaved(reload(raw))).toEqual({ NOTE: 'B4', TICKS: '2' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('cannot be set to a value outside the domain through the block either', () => {
    const workspace = new Blockly.Workspace();
    try {
      const note = newBlock(workspace, playNoteType, 'note', { NOTE: 'C4', TICKS: '4' });
      note.setFieldValue('E9', 'NOTE');
      note.setFieldValue('8', 'TICKS');
      expect(note.getFieldValue('NOTE')).toBe('C4');
      expect(note.getFieldValue('TICKS')).toBe('4');
    } finally {
      workspace.dispose();
    }
  });
});

describe('a picture with all 25 squares lit, and the stored programs that hold the hardware blocks', () => {
  it('opens in the editor: canOpenProgram loads it into a headless workspace', () => {
    const saved = build((workspace, onStart) => {
      const block = newBlock(workspace, showImageType, 'full');
      lightSquares(block, images.FULL);
      plug(onStart, 'DO', block);
    });
    expect(Object.values(asRecord(asRecord(savedBlock(saved)).fields)).filter((lit) => lit === true)).toHaveLength(25);
    expect(canOpenProgram(saved, packs)).toBe(true);
    expect(canOpenProgram(program([showImage(images.FULL)]), packs)).toBe(true);
  });

  it('opens a program with one of every hardware block, built by the fixtures', () => {
    const everything = program([
      showImage(images.RING), scrollText(text('Hi')), scrollNumber(num(7)), clearDisplay(),
      print(buttonPressed('A')), print(buttonPresses('B')), print(lightLevel()),
      playNote('C3', 1), rest(4),
    ]);
    expect(canOpenProgram(everything, packs)).toBe(true);
    // Whatever the editor loads and saves compiles for the board.
    expect(compileYbcProgram(reload(everything), exposed, undefined, boardTarget).ok).toBe(true);
  });

  it('opens a stored program that holds a picture, a note and a button of a profile that shows them, whichever profile is open', () => {
    // Registration is for the union of the known packs (L-1): the structure-only types of a lowered profile do not matter here.
    const structureOnly = packs.typesOf(['ybc.structure']);
    const stored = program([showImage(images.CROSS), playNote('C5', 2)]);
    expect(canOpenProgram(stored, packs)).toBe(true);
    // A lowered profile that does not show the blocks still opens the document, and Run refuses it with unknown-block.
    expect(compileYbcProgram(stored, structureOnly).diagnostics.map((d) => d.code)).toEqual(['unknown-block', 'unknown-block']);
  });
});
