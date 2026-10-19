import { describe, expect, it } from 'vitest';
import type { Frame, HexColour } from '../capabilities/frame';
import type { Capabilities } from '../capabilities/io';
import { boardTargetOf } from '../devices/board-pins';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { productionProfiles } from '../profiles';
import { capabilitiesOf } from '../profiles/board-context';
import {
  add, clearPixel, colour, getVar, images, num, program, scrollNumber, scrollNumberIn, scrollText, scrollTextIn, setAll, setPixel, setVar,
  legacyShowImage, showIcon, showImage, showImageIn, text, type Json,
} from './__fixtures__/ybc-blocks';
import { runYbc } from './__fixtures__/run-ybc';
import { createBlockPackCatalog } from './block-packs';
import { compileYbcProgram, type YbcCompileResult } from './compile-ybc-program';
import type { YbcRunOutcome } from './ybc-interpreter';
import type { YbcProgramIR } from './ybc-ir';

// N17 B1: the RGB display end to end, from the JSON Blockly saves to the frames the display is given. A colour is chosen with the
// colour block (eight palette colours); a malformed one never breaks the program: it is shown red, with a warning (Review Focus 3).
// A block saved before N17 (a picture without its colour field, a scroll without its colour input) shows red, as it always did.

const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);
const exposed = packs.typesOf(productionProfiles.get('ybc-basic')?.blockPacks ?? []);
const board = registry.get('ybc-board');
const target = boardTargetOf(board, capabilitiesOf(board));
const prog = (statements: Json[]) => program(statements, undefined, ['x', 'y', 'z']);
const compile = (statements: Json[]): YbcCompileResult => compileYbcProgram(prog(statements), exposed, undefined, target);

function compiled(statements: Json[]): YbcProgramIR {
  const result = compile(statements);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.diagnostics));
  }
  return result.ir;
}

/** The letter of a colour of the palette, '.' off: a frame drawn by hand. */
const letters: Record<string, string> = { '#FF0000': 'R', '#FFA500': 'O', '#FFFF00': 'Y', '#00FF00': 'G', '#0000FF': 'B', '#4B0082': 'I', '#800080': 'P', '#FFFFFF': 'W' };
const paint = (frame: Frame) =>
  Array.from({ length: 5 }, (_, row) => frame.pixels.slice(row * 5, row * 5 + 5).map((pixel) => (pixel === null ? '.' : (letters[pixel] ?? '?'))).join(''));

/** Runs the IR against a display that records every frame; the clock only moves with the program's own waits. */
async function run(ir: YbcProgramIR): Promise<{ outcome: YbcRunOutcome; frames: string[][] }> {
  const frames: string[][] = [];
  let now = 0;
  const capabilities: Capabilities = { display: { setFrame: (frame) => void frames.push(paint(frame)) } };
  const sleep = (ms: number) => {
    now += ms;
    return Promise.resolve();
  };
  const outcome = await runYbc(ir, { sleep, console: { write: () => undefined }, now: () => now, yieldNow: () => Promise.resolve() }, capabilities).done;
  return { outcome, frames };
}

const warnings = (result: YbcCompileResult) => result.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning');

describe('set pixel, clear pixel and set all (C-10, C-42, C-43)', () => {
  it('sets the light at column 2, row 3 to green, then turns it off, on a display that starts dark', async () => {
    const { outcome, frames } = await run(compiled([setPixel(num(2), num(3), colour('#00ff00')), clearPixel(num(2), num(3))]));
    expect(outcome).toEqual({ status: 'finished' });
    expect(frames).toEqual([
      ['.....', '.....', '.....', '..G..', '.....'],
      ['.....', '.....', '.....', '.....', '.....'],
    ]);
  });

  it('fills the display, then draws over it one light at a time: each frame builds on the one before', async () => {
    const { frames } = await run(compiled([setAll(colour('#0000ff')), setPixel(num(0), num(0), colour('#ffffff')), clearPixel(num(4), num(4))]));
    expect(frames).toEqual([
      ['BBBBB', 'BBBBB', 'BBBBB', 'BBBBB', 'BBBBB'],
      ['WBBBB', 'BBBBB', 'BBBBB', 'BBBBB', 'BBBBB'],
      ['WBBBB', 'BBBBB', 'BBBBB', 'BBBBB', 'BBBB.'],
    ]);
  });

  it('draws on top of a picture: set pixel changes one light of what is shown', async () => {
    const { frames } = await run(compiled([showImage(images.DOT), setPixel(num(0), num(4), colour('#ffff00'))]));
    expect(frames.at(-1)).toEqual(['.....', '.....', '..R..', '.....', 'Y....']);
  });

  it('takes computed coordinates: x = 1 + 1, y = x', async () => {
    const { frames } = await run(compiled([setVar('x', add(num(1), num(1))), setPixel(getVar('x'), getVar('x'), colour('#ff0000'))]));
    expect(frames).toEqual([['.....', '.....', '..R..', '.....', '.....']]);
  });

  it.each([[-1, 0], [5, 0], [0, -1], [0, 5]])('refuses the typed-in cell (%d, %d): the column and the row are 0 to 4', (x, y) => {
    const result = compile([setPixel(num(x), num(y), colour('#ff0000'))]);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['value-out-of-range']);
    expect(compile([clearPixel(num(x), num(y))]).ok).toBe(false);
  });

  it('stops with out-of-domain on a computed cell outside the display, before any light changes', async () => {
    const { outcome, frames } = await run(compiled([setPixel(add(num(4), num(1)), num(0), colour('#ff0000'))]));
    expect(outcome).toMatchObject({ status: 'error', code: 'out-of-domain' });
    expect(frames).toEqual([]);
    const cleared = await run(compiled([clearPixel(num(0), add(num(0), num(-1)))]));
    expect(cleared.outcome).toMatchObject({ status: 'error', code: 'out-of-domain' });
  });

  it('lights a set pixel red, as the contract writes, when the colour input is left empty', async () => {
    const result = compile([setPixel(num(1), num(1)), setAll()]);
    expect(result.ok && warnings(result)).toEqual([]);
    const { frames } = await run(compiled([setPixel(num(1), num(1))]));
    expect(frames).toEqual([['.....', '.R...', '.....', '.....', '.....']]);
  });
});

describe('the built-in pictures (C-05)', () => {
  it('shows the heart', async () => {
    const { outcome, frames } = await run(compiled([showIcon('HEART')]));
    expect(outcome).toEqual({ status: 'finished' });
    expect(frames).toEqual([['.R.R.', 'RRRRR', 'RRRRR', '.RRR.', '..R..']]);
  });

  it('replaces the whole frame, like a picture of the learner’s own', async () => {
    const { frames } = await run(compiled([setAll(colour('#00ff00')), showIcon('ARROW_N')]));
    expect(frames.at(-1)).toEqual(['..R..', '.RRR.', 'R.R.R', '..R..', '..R..']);
  });

  it.each(['heart', 'SMILE', '', 'ARROW_NE', '__proto__'])('refuses the picture %j, which the block does not offer', (name) => {
    const result = compile([showIcon(name)]);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['value-out-of-range']);
  });

  it('refuses a picture block without its picture as a malformed program', () => {
    const result = compile([{ type: 'ybc_display_show_icon', id: 'no-name' }]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['malformed-program']);
  });
});

describe('colours on a picture and on a scroll', () => {
  it('lights the ticked squares of a picture in the colour of its field', async () => {
    const { frames } = await run(compiled([showImageIn(images.CROSS, '#0000ff')]));
    expect(frames).toEqual([['B...B', '.B.B.', '..B..', '.B.B.', 'B...B']]);
  });

  it('scrolls a text and a number in the colour of their colour block', async () => {
    const textRun = await run(compiled([scrollTextIn(text('A'), colour('#ffff00'))]));
    expect(textRun.frames).toEqual([['.YYY.', 'Y...Y', 'YYYYY', 'Y...Y', 'Y...Y']]);
    const numberRun = await run(compiled([scrollNumberIn(num(1), colour('#ffffff'))]));
    expect(numberRun.frames[0]?.join('').replaceAll('.', '')).toMatch(/^W+$/);
  });

  it('accepts a colour whatever its case: #00FF00 is #00ff00', async () => {
    const result = compile([setAll(colour('#00FF00'))]);
    expect(result.ok && warnings(result)).toEqual([]);
    const { frames } = await run(compiled([setAll(colour('#00FF00'))]));
    expect(frames[0]?.[0]).toBe('GGGGG');
  });
});

describe('a colour that is not one never breaks the program: red, with a warning (Review Focus 3)', () => {
  const bad: [label: string, value: unknown][] = [
    ['a colour name', 'red'],
    ['a short code', '#ff00'],
    ['an empty text', ''],
    ['a code without #', 'ff0000'],
    ['a colour outside the palette', '#123456'],
    ['a number', 42],
    ['nothing at all', undefined],
  ];

  it.each(bad)('%s (%j) on set pixel: compiles with a warning on the colour block, and lights red', async (_label, value) => {
    const block = { ...colour('#00ff00'), id: 'the-colour', fields: value === undefined ? {} : { COLOUR: value } };
    const result = compile([setPixel(num(0), num(0), block)]);
    expect(result.ok).toBe(true);
    expect(warnings(result)).toEqual([expect.objectContaining({ severity: 'warning', code: 'invalid-colour', blockId: 'the-colour' })]);
    const { outcome, frames } = await run(compiled([setPixel(num(0), num(0), block)]));
    expect(outcome).toEqual({ status: 'finished' });
    expect(frames).toEqual([['R....', '.....', '.....', '.....', '.....']]);
  });

  it.each(bad)('%s (%j) in the colour field of a picture: red, with a warning on the picture', async (_label, value) => {
    const block: Json = { ...showImageIn(images.DOT, '#00ff00'), id: 'the-picture' };
    const fields = { ...(block.fields as Json) };
    if (value === undefined) {
      // Absent is a picture saved before N17: red, and nothing to warn about.
      delete fields.COLOUR;
    } else {
      fields.COLOUR = value;
    }
    const result = compile([{ ...block, fields }]);
    expect(result.ok).toBe(true);
    expect(warnings(result)).toEqual(value === undefined ? [] : [expect.objectContaining({ code: 'invalid-colour', blockId: 'the-picture' })]);
    const { frames } = await run(compiled([{ ...block, fields }]));
    expect(frames).toEqual([['.....', '.....', '..R..', '.....', '.....']]);
  });

  it('reads a text typed into a colour input (a program not made by the editor): a palette code is used, anything else is red with a warning', async () => {
    const typed = (value: string) => ({ ...setAll(), inputs: { COLOUR: { block: { ...text(value), id: 'typed' } } } });
    expect(warnings(compile([typed('#ffffff')]))).toEqual([]);
    expect((await run(compiled([typed('#ffffff')]))).frames[0]?.[0]).toBe('WWWWW');
    expect(warnings(compile([typed('red')]))).toEqual([expect.objectContaining({ code: 'invalid-colour', blockId: 'typed' })]);
    expect((await run(compiled([typed('red')]))).frames[0]?.[0]).toBe('RRRRR');
  });

  it('shows red, with a warning, for a block in a colour input that is not a colour at all', async () => {
    const odd = { ...setAll(), inputs: { COLOUR: { block: { ...num(3), id: 'odd' } } } };
    const result = compile([odd]);
    expect(result.ok).toBe(true);
    expect(warnings(result)).toEqual([expect.objectContaining({ code: 'invalid-colour', blockId: 'odd' })]);
    expect((await run(compiled([odd]))).frames[0]?.[0]).toBe('RRRRR');
  });

  it('uses the shadow colour when the block over it is disabled, as Blockly shows it', async () => {
    const covered = { ...setAll(), inputs: { COLOUR: { shadow: colour('#0000ff'), block: { ...colour('#ffffff'), disabledReasons: ['MANUALLY_DISABLED'] } } } };
    const result = compile([covered]);
    expect(result.ok && warnings(result)).toEqual([]);
    expect((await run(compiled([covered]))).frames[0]?.[0]).toBe('BBBBB');
  });

  it('refuses the colour block where a value is computed or as a statement: it only fills a colour input', () => {
    expect(compile([{ type: 'text_print', id: 'p', inputs: { TEXT: { block: colour('#ff0000') } } }]).diagnostics.map((d) => d.code)).toEqual(['unsupported-construct']);
    expect(compile([colour('#ff0000')]).diagnostics.map((d) => d.code)).toEqual(['unsupported-construct']);
  });
});

describe('blocks saved before N17 load and run as they did (Stability)', () => {
  it('shows a picture without a colour field in red, with no warning', async () => {
    expect(legacyShowImage(images.RING).fields).not.toHaveProperty('COLOUR');
    const result = compile([legacyShowImage(images.RING)]);
    expect(result.ok && warnings(result)).toEqual([]);
    const { frames } = await run(compiled([legacyShowImage(images.RING)]));
    expect(frames).toEqual([['RRRRR', 'R...R', 'R...R', 'R...R', 'RRRRR']]);
  });

  it('scrolls a text and a number without a colour input in red, with no warning', async () => {
    const result = compile([scrollText(text('A')), scrollNumber(num(7))]);
    expect(result.ok && warnings(result)).toEqual([]);
    const { frames } = await run(compiled([scrollText(text('A'))]));
    expect(frames).toEqual([['.RRR.', 'R...R', 'RRRRR', 'R...R', 'R...R']]);
  });

  it('gives the same IR for an old picture and for one whose colour field says red', () => {
    const strip = (ir: YbcProgramIR) => JSON.parse(JSON.stringify(ir).replace(/"blockId":"[^"]*"/g, '"blockId":""')) as unknown;
    const legacy = legacyShowImage(images.CROSS);
    const current = { ...showImageIn(images.CROSS, '#ff0000'), id: legacy.id };
    expect(strip(compiled([current]))).toEqual(strip(compiled([legacy])));
  });
});

describe('a frame colour is always the upper-case form a frame holds', () => {
  it('stores #00ff00 as #00FF00 in the IR, so the display gets a well-formed frame', () => {
    const ir = compiled([setPixel(num(0), num(0), colour('#00ff00'))]);
    const statement = ir.onStart[0] as { operand?: { colour?: HexColour } };
    expect(statement.operand?.colour).toBe('#00FF00');
  });
});
