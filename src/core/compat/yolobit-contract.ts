import type {
  Claim,
  ClaimKind,
  ConstructContract,
  Domain,
  EvidenceRef,
  FieldEntry,
  ModuleContract,
  NaReason,
  OfField,
  Pred,
  Profiles,
  YolobitContract,
} from './contract-types';
import { evidenceLedger } from './yolobit-evidence';

export * from './contract-types';

// The Yolo:Bit compatibility contract as data (YB-1, from docs/yolobit-compatibility-contract.md
// 1.0-draft r3, frozen). The document is the source of truth: nothing here may say more than it does.
// Every field of every row has a label, its claims (each with the evidence behind it) and, derived,
// whether it rests on the public simulator alone. Rows that are EXCLUDED or DEFERRED are data only:
// no profile lists them, they have no Python mapping, and the gate (contract-validation.ts) refuses them.

// --- Builders ------------------------------------------------------------------------

const claim = (kind: ClaimKind, sources: EvidenceRef | readonly EvidenceRef[], statement: string, value?: unknown): Claim => ({
  kind,
  statement,
  sources: typeof sources === 'string' ? [sources] : sources,
  ...(value === undefined ? {} : { value }),
});

/** VERIFIED when a source is generated Python or the simulator; otherwise DOCUMENTED. */
const field = (claims: readonly Claim[], corroboratedBy?: readonly EvidenceRef[]): FieldEntry => {
  const verified = claims.some((c) => c.sources.some((id) => ['GEN', 'SIM'].includes(evidenceLedger[id]?.kind ?? '')));
  return {
    label: verified ? 'VERIFIED' : 'DOCUMENTED',
    claims,
    ...(corroboratedBy ? { corroboratedBy } : {}),
  };
};
const na = (note: string, reason: NaReason = 'not-applicable'): FieldEntry => ({ label: 'n/a', reason, note });
const byDomain = (note: string) => na(note, 'domain-restricted');
const explicit = (note: string) => na(note, 'explicit-parameter');
const unknown = (note: string): FieldEntry => ({ label: 'UNKNOWN', note });
const inferred = (note: string): FieldEntry => ({ label: 'INFERRED', note });

const irrelevant = 'Not relevant to this construct.';
const open = (partial: Partial<Record<OfField, FieldEntry>>): Record<OfField, FieldEntry> => ({
  call: na(irrelevant), import: na(irrelevant), module: na(irrelevant), unit: na(irrelevant), range: na(irrelevant),
  default: na(irrelevant), clamp: na(irrelevant), round: na(irrelevant), block: na(irrelevant), yield: na('No learner-visible background activity in the supported subset.'),
  return: na(irrelevant), error: na(irrelevant), coord: na(irrelevant), event: na('Events are DEFERRED (contract §13).'), content: na(irrelevant),
  ...partial,
});
const notEstablished = 'Not established: the construct is not offered.';
const closed = (partial: Partial<Record<OfField, FieldEntry>>): Record<OfField, FieldEntry> => ({
  call: unknown(notEstablished), import: unknown(notEstablished), module: unknown(notEstablished), unit: unknown(notEstablished),
  range: unknown(notEstablished), default: unknown(notEstablished), clamp: unknown(notEstablished), round: unknown(notEstablished),
  block: unknown(notEstablished), yield: unknown(notEstablished), return: unknown(notEstablished), error: unknown(notEstablished),
  coord: unknown(notEstablished), event: unknown(notEstablished), content: unknown(notEstablished),
  ...partial,
});

const BOTH: Profiles = ['ybc-basic', 'ybc-advanced'];
const ADVANCED: Profiles = ['ybc-advanced'];

// Predicates --------------------------------------------------------------------------

const arg = (name: string) => ({ arg: name });
const num = (value: number) => ({ const: value });
const between = (name: string, low: number, high: number): Pred => ({ all: [{ le: [num(low), arg(name)] }, { le: [arg(name), num(high)] }] });
const oneOf = (name: string, values: readonly (number | string)[]): Pred => ({ oneOf: { arg: name, values } });
const all = (...preds: Pred[]): Pred => ({ all: preds });

/** A domain whose checks are all of one shape; `compileTime` repeats them for literals. */
const domain = (args: Domain['args'], rule: Pred, diagnostic: Domain['compileTime'][number]['diagnostic'] = 'value-out-of-range'): Domain => ({
  args,
  compileTime: [{ when: rule, diagnostic }],
  runtime: rule,
});
/** A restriction the closed predicate language cannot express (a shape, a structure); `restrictions` carries it in words. */
const structural = (args: Domain['args']): Domain => ({ args, compileTime: [], runtime: { all: [] } });

const MAX = 1_000_000;
const palette = ['#FF0000', '#FFA500', '#FFFF00', '#00FF00', '#0000FF', '#4B0082', '#800080', '#FFFFFF'] as const;
const pins012 = oneOf('pin', [0, 1, 2]);

// Recurrent claims -----------------------------------------------------------------------

const callShape = (statement: string) => claim('call-shape', 'EVD-03', statement);
const importLine = (statement: string) => claim('import-syntax', 'EVD-03', statement);
const ui = (statement: string) => claim('ui-statement', 'EVD-02U', statement);
const lang = (statement: string, source: EvidenceRef = 'DOC-M8') => claim('documented', source, statement);
const moduleYolobit = claim('sim-module', 'EVD-06', 'The yolobit module and its API run in the accepted simulator snapshot (C-03b). On the physical firmware: unverified (L3).');
const moduleMusic = claim('sim-module', 'EVD-08', 'The music module runs in the accepted simulator snapshot (C-03c). On the physical firmware: unverified (L3).');
// An `OF-block` claim cites the trace that exercised THAT call (ledger EVD-06, 16, 24–28): the
// observation is only that the call returned promptly in the accepted public simulator, not a
// physical timing.
const returnsAtOnce = (what: string, source: EvidenceRef) => claim('blocking', source, `${what} returned promptly in the accepted simulator trace; it does not wait.`);

// --- Modules (contract §2.2): availability is separate from import syntax --------------------

const importYolobit = 'from yolobit import *';
const preambleYolobit = [
  'button_a.on_pressed = None',
  'button_b.on_pressed = None',
  'button_a.on_pressed_ab = button_b.on_pressed_ab = -1',
] as const;

const modules: readonly ModuleContract[] = [
  {
    id: 'C-03a',
    module: 'time',
    importForm: 'import time',
    fields: {
      import: field([importLine('import time')]),
      module: field([
        lang('ESP32 MicroPython: "Use the time module: import time … time.sleep_ms(500)".', 'DOC-M10'),
        claim('documented', 'DOC-W5', 'The Yolo:Bit is programmed in MicroPython.'),
      ]),
    },
    eligibility: 'ELIGIBLE',
  },
  {
    id: 'C-03b',
    module: 'yolobit',
    importForm: importYolobit,
    preamble: preambleYolobit,
    fields: {
      import: field([
        importLine('from yolobit import *'),
        claim('preamble-text', 'EVD-03', 'Three preamble lines follow the import (IM-2).'),
      ]),
      module: field([moduleYolobit]),
    },
    eligibility: 'ELIGIBLE',
  },
  {
    id: 'C-03c',
    module: 'music',
    importForm: 'import music',
    preamble: ['music.set_tempo(4, 120)'],
    fields: {
      import: field([importLine('import music'), claim('preamble-text', 'EVD-03', 'The generator writes music.set_tempo(4, 120) after the import (IM-4).')]),
      module: field([moduleMusic]),
    },
    eligibility: 'ELIGIBLE',
  },
  {
    id: 'C-03d',
    module: 'random',
    importForm: 'import random',
    fields: {
      import: field([importLine('import random')]),
      module: inferred(
        'randint() exists only if MICROPY_PY_RANDOM_EXTRA_FUNCS is enabled (DOC-M2); no public OhStem page shows it on the Yolo:Bit, and the simulator\'s random is CPython (a "language" claim, which the simulator cannot support).',
      ),
    },
    eligibility: 'EXCLUDED',
    exclusionReason: 'OF-module of random.randint on the firmware is INFERRED (contract §2.2, §3.5).',
  },
  {
    id: 'C-03e',
    module: 'builtins',
    importForm: null,
    fields: {
      import: na('Builtins need no import.'),
      module: field([lang('print, range, str, int and len are builtins of the MicroPython language core.')]),
    },
    eligibility: 'ELIGIBLE',
  },
];

// --- Constructs that may be shown (ELIGIBLE / RESTRICTED, contract §15.1) -------------------------

const timeModuleClaims = [
  lang('ESP32 MicroPython: "Use the time module: import time … time.sleep_ms(500)".', 'DOC-M10'),
  claim('documented', 'DOC-W5', 'The Yolo:Bit is programmed in MicroPython.'),
];

const exposed: readonly ConstructContract[] = [
  {
    id: 'C-01',
    capability: 'program start',
    tier: { 'ybc-basic': 'MUST' },
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: ['Top level'],
    modules: [],
    python: { form: '<statements at top level>' },
    fields: open({
      call: field([callShape('The start block\'s statements are written at the top level; the editor wraps them in `if True:` (IM-5).')]),
      block: field([lang('Statements run in order.')]),
    }),
  },
  {
    id: 'C-02',
    capability: 'forever',
    tier: { 'ybc-basic': 'MUST' },
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: ['`time.sleep_ms(10)` ends every iteration'],
    modules: ['C-03a'],
    python: { form: 'while True:\n    <body>\n    time.sleep_ms(10)' },
    fields: open({
      call: field([callShape('while True: … time.sleep_ms(10)')]),
      import: field([importLine('import time')]),
      module: field(timeModuleClaims),
      unit: field([lang('sleep_ms takes milliseconds.', 'DOC-M1')]),
      block: field([lang('The delay lasts at least the given time.', 'DOC-M1')]),
    }),
  },
  {
    id: 'C-04',
    capability: 'wait (ms)',
    tier: { 'ybc-basic': 'MUST' },
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: ['`ms` is an int in 0..60000 (a limit of the domain, not of the board)'],
    modules: ['C-03a'],
    python: { form: 'time.sleep_ms(<ms>)' },
    fields: open({
      call: field([callShape('time.sleep_ms(n)')]),
      import: field([importLine('import time')]),
      module: field(timeModuleClaims),
      unit: field([ui('The unit is milliseconds.'), lang('sleep_ms takes milliseconds.', 'DOC-M1')]),
      range: field([lang('The delay "should be positive or 0".', 'DOC-M1')]),
      clamp: byDomain('Values outside 0..60000 are outside the domain: a literal is a compile error, a dynamic value is out-of-domain.'),
      block: field([lang('The delay lasts at least the given time.', 'DOC-M1')]),
      error: byDomain('Outside the domain there is no behaviour to describe.'),
    }),
    domain: domain({ ms: 'int' }, between('ms', 0, 60_000)),
  },
  {
    id: 'C-06',
    capability: 'display: own image',
    tier: { 'ybc-basic': 'MUST' },
    profiles: BOTH,
    eligibility: 'RESTRICTED',
    restrictions: [
      '5×5 image',
      'digit 0 (off) or 1 (red) in the verified form',
      'N17 B1: the colour field lights the squares in a palette colour, written as its digit 1–8 (an UNVERIFIED form, below)',
      'replaces the whole frame',
      'does not block',
    ],
    modules: ['C-03b'],
    python: { form: 'display.show(Image("<r0>:<r1>:<r2>:<r3>:<r4>"))' },
    unverifiedForms: [
      {
        form: 'display.show(Image("<c0>:<c1>:<c2>:<c3>:<c4>"))',
        reason:
          'N17 B1. The digit is the palette index the editor writes for a coloured square (EVD-05, V·G), so the text is the editor\'s own; how the board shows digits 2–8 is UNVERIFIED: the accepted simulator drew 2 as yellow and 6 and 7 as magenta (EVD-13, C-70).',
      },
    ],
    fields: open({
      call: field([callShape('display.show(Image("r0:r1:r2:r3:r4"))')]),
      import: field([importLine('from yolobit import *')]),
      module: field([moduleYolobit]),
      range: field([claim('encoding', 'EVD-05', 'Five rows of five digits; only 0 (off) and 1 (red) are used. Digits 2–8 are excluded (C-70).')]),
      block: field([returnsAtOnce('show', 'EVD-06')]),
      coord: field([claim('documented', 'DOC-W4', 'Rows run top to bottom, columns left to right, from 0.')], ['EVD-06']),
      content: field([
        claim('encoding', 'EVD-05', 'The digit is the colour-table index: 0 off, 1 red.'),
        claim('display-transition', 'EVD-17', 'show replaces the whole frame.'),
      ]),
    }),
    domain: structural({ image: 'str' }),
    presentation: ['LED shape and colour on a computer screen'],
  },
  {
    id: 'C-07',
    capability: 'display: scroll text',
    tier: { 'ybc-basic': 'MUST' },
    profiles: BOTH,
    eligibility: 'RESTRICTED',
    restrictions: [
      'ASCII 0x20–0x7E',
      'one character: shown still, does not block',
      'two or more characters: one column per ≈200 ms, six columns per character, blocks 1200 ms × n, ends with an empty frame',
      'timing is a vendor public simulator observation, NOT a physical timing verification',
    ],
    modules: ['C-03b'],
    python: { form: "display.scroll('<text>')" },
    unverifiedForms: [
      {
        form: "display.scroll('<text>', color='<#rrggbb>')",
        reason:
          'N17 B1: the scroll block takes a colour. UNVERIFIED: no evidence shows the editor or the board scrolling in a colour; the keyword `color` is assumed from the yolobit library\'s naming. Red writes the verified form, without it.',
      },
    ],
    fields: open({
      call: field([callShape("display.scroll('…')")]),
      import: field([importLine('from yolobit import *')]),
      module: field([moduleYolobit]),
      unit: field([claim('blocking', 'EVD-07', 'One column per ≈200 ms; six columns per character.')]),
      range: field([claim('display-transition', 'EVD-12', 'All 94 characters 0x21–0x7E are shown, with space 0x20, without error.')]),
      block: field([
        claim('blocking', 'EVD-07', 'Two or more characters block 1200 ms × n, then leave the frame empty.'),
        ui('A single character is shown without scrolling.'),
      ]),
      error: byDomain('Text outside ASCII behaves inconsistently in the simulator: a literal is a compile error, a dynamic text is out-of-domain.'),
      coord: field([claim('display-transition', 'EVD-07', 'The first character starts at column 0.')]),
      content: field([claim('display-transition', 'EVD-07', 'The text scrolls in red; the frame ends empty.')]),
    }),
    domain: domain({ text: 'str' }, { ascii: { arg: 'text', from: 0x20, to: 0x7e } }, 'display-char-unsupported'),
    timing: { blocksMs: '1200 × n for n ≥ 2 characters', source: 'SIM-observed' },
    presentation: ['glyph shapes', 'LED colour on a computer screen'],
  },
  {
    id: 'C-08',
    capability: 'display: scroll number',
    tier: { 'ybc-basic': 'MUST' },
    profiles: BOTH,
    eligibility: 'RESTRICTED',
    restrictions: [
      'shown as str(n): ASCII digits and the minus sign',
      'timing as for C-07: a vendor public simulator observation, NOT a physical timing verification',
    ],
    modules: ['C-03b'],
    python: { form: 'display.scroll(<n>)' },
    unverifiedForms: [
      {
        form: "display.scroll(<n>, color='<#rrggbb>')",
        reason: 'N17 B1: as for C-07, the keyword `color` of a coloured scroll is assumed and UNVERIFIED. Red writes the verified form, without it.',
      },
    ],
    fields: open({
      call: field([callShape('display.scroll(n)')]),
      import: field([importLine('from yolobit import *')]),
      module: field([moduleYolobit]),
      unit: field([claim('blocking', 'EVD-07', 'One column per ≈200 ms; six columns per character.')]),
      range: field([claim('display-transition', 'EVD-12', 'Digits and the minus sign are among the characters shown.')]),
      round: field([lang('An integer is shown as its decimal str().')]),
      block: field([
        claim('blocking', 'EVD-07', 'Two or more characters block 1200 ms × n, then leave the frame empty.'),
        ui('A single character is shown without scrolling.'),
      ]),
      coord: field([claim('display-transition', 'EVD-07', 'The first character starts at column 0.')]),
      content: field([claim('display-transition', 'EVD-07', 'The number scrolls in red; the frame ends empty.')]),
    }),
    domain: structural({ n: 'int' }),
    timing: { blocksMs: '1200 × n for n ≥ 2 characters', source: 'SIM-observed' },
    presentation: ['glyph shapes', 'LED colour on a computer screen'],
  },
  {
    id: 'C-09',
    capability: 'display: clear',
    tier: { 'ybc-basic': 'MUST' },
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: [],
    modules: ['C-03b'],
    python: { form: 'display.clear()' },
    fields: open({
      call: field([callShape('display.clear()')]),
      import: field([importLine('from yolobit import *')]),
      module: field([moduleYolobit]),
      block: field([returnsAtOnce('clear', 'EVD-06')]),
      content: field([ui('Tooltip: turns all the LEDs off.')], ['EVD-06']),
    }),
  },
  {
    id: 'C-05',
    capability: 'display: built-in image',
    tier: { 'ybc-basic': 'MUST', 'ybc-advanced': 'MUST' },
    profiles: BOTH,
    eligibility: 'RESTRICTED',
    restrictions: [
      'N17 B1 (owner, 2026-10-19, "Mô phỏng đủ chức năng"): reopened without copying a vendor asset',
      'HEART, HEART_SMALL, HAPPY, SAD, CONFUSED, ANGRY, SURPRISED, YES and NO are names of the editor\'s list, written Image.<NAME>',
      'ARROW_N, ARROW_E, ARROW_S and ARROW_W are not in the editor\'s list: written as an image of our own (the C-06 form), so the board shows what the simulator shows',
      'the simulator draws the micro:bit MicroPython pictures (MIT); how the board draws a name of the editor is presentation, UNVERIFIED',
      'red; replaces the whole frame; does not block',
    ],
    modules: ['C-03b'],
    python: { form: 'display.show(Image.<name>)' },
    observedPython: 'display.show(Image.HEART)',
    fields: open({
      call: field([callShape('display.show(Image.HEART)')]),
      import: field([importLine('from yolobit import *')]),
      module: field([moduleYolobit]),
      range: field([
        claim(
          'call-shape',
          'EVD-02',
          'The editor offers HEART, HEART_SMALL, HAPPY, SMILE, SAD, CONFUSED, ANGRY, ASLEEP, SURPRISED, SILLY, FABULOUS, YES and NO; the block offers nine of them.',
        ),
      ]),
      block: field([returnsAtOnce('show', 'EVD-06')]),
      content: field([claim('display-transition', 'EVD-17', 'show replaces the whole frame.')]),
    }),
    domain: domain(
      { name: 'str' },
      oneOf('name', ['HEART', 'HEART_SMALL', 'HAPPY', 'SAD', 'CONFUSED', 'ANGRY', 'SURPRISED', 'YES', 'NO', 'ARROW_N', 'ARROW_E', 'ARROW_S', 'ARROW_W']),
    ),
    presentation: ['the 5×5 pattern of each picture (the micro:bit MicroPython table, MIT; the board draws its own)', 'LED colour on a computer screen'],
  },
  {
    id: 'C-10',
    capability: 'display: set one pixel',
    tier: { 'ybc-basic': 'MUST', 'ybc-advanced': 'MUST' },
    profiles: BOTH,
    eligibility: 'RESTRICTED',
    restrictions: [
      'x and y in 0..4 (0-based, origin top-left, x column, y row)',
      'one of the eight palette colours, chosen with the colour block; written in lower case, as the editor\'s colour field writes it',
      'N17 B1, Review Focus 3: any other colour value (a name such as red, a short code, an empty text, a colour outside the palette) is shown red with a warning, never an error',
    ],
    modules: ['C-03b'],
    python: { form: "display.set_pixel(<x>, <y>, '<#rrggbb>')" },
    fields: open({
      call: field([callShape("display.set_pixel(x, y, '#rrggbb')")]),
      import: field([importLine('from yolobit import *')]),
      module: field([moduleYolobit]),
      range: field([claim('documented', 'DOC-W4', 'Columns and rows are numbered 0 to 4.')], ['EVD-13']),
      clamp: byDomain('Coordinates outside 0..4 are outside the domain; the simulator ignores them, which says nothing about the board.'),
      block: field([returnsAtOnce('set_pixel', 'EVD-06')]),
      error: byDomain('Outside the domain there is no behaviour to describe.'),
      coord: field([claim('documented', 'DOC-W4', 'x is the column, y the row; origin top-left; 0-based.')], ['EVD-06']),
      content: field([callShape("The colour is a '#rrggbb' string.")], ['EVD-06']),
    }),
    // The colour is not part of the domain since N17: it is never refused, only shown red (restrictions).
    domain: {
      args: { x: 'int', y: 'int' },
      compileTime: [
        { when: between('x', 0, 4), diagnostic: 'value-out-of-range' },
        { when: between('y', 0, 4), diagnostic: 'value-out-of-range' },
      ],
      runtime: all(between('x', 0, 4), between('y', 0, 4)),
    },
  },
  {
    id: 'C-42',
    capability: 'display: clear one pixel',
    tier: { 'ybc-basic': 'NICE', 'ybc-advanced': 'MUST' },
    profiles: BOTH,
    eligibility: 'RESTRICTED',
    restrictions: ['x and y in 0..4 (0-based, origin top-left, x column, y row)'],
    modules: ['C-03b'],
    python: { form: 'display.clear_pixel(<x>, <y>)' },
    fields: open({
      call: field([callShape('display.clear_pixel(x, y)')]),
      import: field([importLine('from yolobit import *')]),
      module: field([moduleYolobit]),
      range: field([claim('documented', 'DOC-W4', 'Columns and rows are numbered 0 to 4.')], ['EVD-13']),
      clamp: byDomain('Coordinates outside 0..4 are outside the domain.'),
      block: field([returnsAtOnce('clear_pixel', 'EVD-06')]),
      error: byDomain('Outside the domain there is no behaviour to describe.'),
      coord: field([claim('documented', 'DOC-W4', 'x is the column, y the row; origin top-left; 0-based.')], ['EVD-06']),
      content: field([ui('Tooltip: turns the LED at the column and row off.')], ['EVD-06']),
    }),
    domain: domain({ x: 'int', y: 'int' }, all(between('x', 0, 4), between('y', 0, 4))),
  },
  {
    id: 'C-43',
    capability: 'display: set all pixels',
    tier: { 'ybc-basic': 'MUST', 'ybc-advanced': 'MUST' },
    profiles: BOTH,
    eligibility: 'RESTRICTED',
    restrictions: [
      'one of the eight palette colours, chosen with the colour block; written in lower case',
      'N17 B1, Review Focus 3: any other colour value is shown red with a warning, never an error',
    ],
    modules: ['C-03b'],
    python: { form: "display.set_all('<#rrggbb>')" },
    fields: open({
      call: field([callShape("display.set_all('#rrggbb')")]),
      import: field([importLine('from yolobit import *')]),
      module: field([moduleYolobit]),
      range: field([claim('encoding', 'EVD-05', 'The eight editor colours: #FF0000, #FFA500, #FFFF00, #00FF00, #0000FF, #4B0082, #800080, #FFFFFF.')]),
      clamp: byDomain('A colour outside the palette (the editor produces `undefined` for one) is not written: since N17 it is shown red, with a warning.'),
      block: field([returnsAtOnce('set_all', 'EVD-28')]),
      content: field([ui('Tooltip: sets all the LEDs to the colour.')], ['EVD-06']),
    }),
    // A palette colour is the only one written; the closed predicates cannot say how another is turned red (restrictions).
    domain: structural({ colour: 'str' }),
  },
  {
    id: 'C-12',
    capability: 'button: is held',
    tier: { 'ybc-basic': 'MUST' },
    profiles: BOTH,
    eligibility: 'RESTRICTED',
    restrictions: ['button A or B', 'not A+B (unsupported in the accepted simulator snapshot)', 'True while held at the call; not latched'],
    modules: ['C-03b'],
    python: { form: 'button_<a|b>.is_pressed()' },
    fields: open({
      call: field([callShape('button_a.is_pressed(), button_b.is_pressed()')]),
      import: field([importLine('from yolobit import *')]),
      module: field([moduleYolobit]),
      block: field([returnsAtOnce('is_pressed', 'EVD-24')]),
      return: field([
        claim('return-reset', 'EVD-09', 'True only while the button is held at the call; not latched; A and B independent.'),
        ui('Tooltip: checks whether the button is pressed.'),
      ]),
    }),
    domain: domain({ button: 'str' }, oneOf('button', ['A', 'B'])),
  },
  {
    id: 'C-13',
    capability: 'button: press count',
    tier: { 'ybc-basic': 'NICE' },
    profiles: BOTH,
    eligibility: 'RESTRICTED',
    restrictions: ['button A or B', 'reading resets the count to 0', 'counted at the press edge (simulator); debounce on the board: L3'],
    modules: ['C-03b'],
    python: { form: 'button_<a|b>.get_presses()' },
    fields: open({
      call: field([callShape('button_a.get_presses()')]),
      import: field([importLine('from yolobit import *')]),
      module: field([moduleYolobit]),
      block: field([returnsAtOnce('get_presses', 'EVD-25')]),
      return: field([
        ui('Tooltip: counts the presses and starts again from 0.'),
        claim('return-reset', 'EVD-17', 'Presses are counted at the press edge, also during a sleep; a read resets to 0.'),
      ]),
    }),
    domain: domain({ button: 'str' }, oneOf('button', ['A', 'B'])),
  },
  {
    id: 'C-15',
    capability: 'light level',
    tier: { 'ybc-basic': 'MUST' },
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: ['int 0..100 as the tooltip states, not from the widget'],
    modules: ['C-03b'],
    python: { form: 'light_level()' },
    fields: open({
      call: field([callShape('light_level()')]),
      import: field([importLine('from yolobit import *')]),
      module: field([moduleYolobit]),
      unit: field([ui('A relative level of light; there is no physical unit.')]),
      range: field([ui('Tooltip: 0 is the darkest, 100 the brightest.')]),
      round: field([claim('return-reset', 'EVD-10', 'The function returns an int.')]),
      block: field([returnsAtOnce('light_level', 'EVD-26')]),
      return: field([ui('Tooltip: gets the brightness level.')]),
    }),
  },
  {
    id: 'C-16',
    capability: 'temperature',
    tier: { 'ybc-advanced': 'MUST' },
    profiles: ADVANCED,
    eligibility: 'RESTRICTED',
    restrictions: [
      'written as int(temperature())',
      'N17 B2: −10..50 °C is the contract\'s supported domain (the simulator\'s slider, step 1, 25 °C at the start of a run), not a physical range; it was 0..50 before N17',
    ],
    modules: ['C-03b'],
    python: { form: 'int(temperature())', builtins: ['int'] },
    fields: open({
      call: field([callShape('temperature()'), lang('int() turns a float into an integer by truncation.')]),
      import: field([importLine('from yolobit import *')]),
      module: field([moduleYolobit]),
      unit: field([ui('Tooltip: the temperature in degrees Celsius.')]),
      range: byDomain('The physical range is unknown and is not claimed; the supported domain is −10..50 (N17 B2; 0..50 before).'),
      round: explicit('The generator always writes int(...), so the type of the raw return does not matter.'),
      block: field([returnsAtOnce('temperature', 'EVD-26')]),
      return: field([ui('Tooltip: gets the current temperature.')]),
    }),
    domain: { args: { celsius: 'int' }, compileTime: [], runtime: between('celsius', -10, 50) },
  },
  {
    id: 'C-17',
    capability: 'accelerometer',
    tier: { 'ybc-advanced': 'MUST' },
    profiles: ADVANCED,
    eligibility: 'RESTRICTED',
    restrictions: [
      'N17 B2 (owner, 2026-10-19: "Mô phỏng đủ chức năng"): opened with UNVERIFIED fields (unverifiedFields), not by new evidence',
      'axis x, y or z; whole mg in −2048..2048, the contract\'s supported domain (the simulator\'s), not a physical range',
      'lying flat, face up, reads (0, 0, −1024) in the simulator',
    ],
    modules: ['C-03b'],
    python: { form: 'accelerometer.get_x()' },
    unverifiedForms: [
      {
        form: 'accelerometer.get_y()',
        reason: 'N17 B2. UNVERIFIED: only accelerometer.get_x() was seen in the editor\'s output (EVD-03); the y name follows it, as on the micro:bit.',
      },
      {
        form: 'accelerometer.get_z()',
        reason: 'N17 B2. UNVERIFIED: only accelerometer.get_x() was seen in the editor\'s output (EVD-03); the z name follows it, as on the micro:bit.',
      },
    ],
    unverifiedFields: {
      block: 'N17 B2. UNVERIFIED: no trace timed a read of the accelerometer; the simulator returns at once.',
      coord: 'N17 B2. UNVERIFIED: which way each axis points on the board is not shown. The simulator follows the micro:bit: x below 0 tilted left, y below 0 logo up, z −1024 lying flat face up.',
      return: 'N17 B2. UNVERIFIED: the editor\'s tooltip for the reading was not recorded. The simulator returns the acceleration along the axis, whole mg in −2048..2048.',
    },
    fields: open({
      call: field([callShape('accelerometer.get_x()')]),
      import: field([importLine('from yolobit import *')]),
      module: field([moduleYolobit]),
      unit: field([ui('The acceleration is in mg (contract §6).')]),
      range: byDomain('The physical range is UNKNOWN (the simulator\'s 0, 0, -50 is not a claim); the supported domain is −2048..2048 mg.'),
      round: field([claim('return-reset', 'EVD-10', 'The simulator printed the accelerometer as 0, 0, -50: whole numbers (the type, not a range).')]),
      block: unknown('No trace timed a read of the accelerometer.'),
      return: unknown('The tooltip of the reading was not recorded.'),
      coord: unknown('The direction of each axis on the board is not shown.'),
    }),
    domain: {
      args: { axis: 'str', mg: 'int' },
      compileTime: [{ when: oneOf('axis', ['x', 'y', 'z']), diagnostic: 'value-out-of-range' }],
      runtime: all(oneOf('axis', ['x', 'y', 'z']), between('mg', -2048, 2048)),
    },
  },
  {
    id: 'C-18',
    capability: 'gesture / shake',
    tier: { 'ybc-advanced': 'MUST' },
    profiles: ADVANCED,
    eligibility: 'RESTRICTED',
    restrictions: [
      'N17 B2 (owner, 2026-10-19: "Mô phỏng đủ chức năng"): opened with UNVERIFIED fields (unverifiedFields), not by new evidence',
      'gesture shake, tilt_left, tilt_right, face_up, face_down, logo_up or logo_down',
      'simulator: shake is true for 1 s after the "Lắc" button; a tilt is x or y beyond ±400 mg (x first), face up or down from z',
      'the sensitivity block (accelerometer.sensor.shake(n)) is not offered',
    ],
    modules: ['C-03b'],
    python: { form: 'accelerometer.is_gesture("shake")' },
    unverifiedForms: [
      {
        form: 'accelerometer.is_gesture("<gesture>")',
        reason:
          'N17 B2. UNVERIFIED: only "shake" was seen in the editor\'s output (EVD-03); tilt_left, tilt_right, face_up, face_down, logo_up and logo_down follow micro:bit-style names, and the editor\'s own list was not recorded.',
      },
    ],
    unverifiedFields: {
      block: 'N17 B2. UNVERIFIED: no trace timed is_gesture; the simulator returns at once.',
      content: 'N17 B2. UNVERIFIED: how the board decides a gesture is not shown. The simulator: shake for 1 s after the button, a tilt beyond ±400 mg on x (first) or y, then face up or down from z beyond ±400 mg.',
      return: 'N17 B2. UNVERIFIED: when the board reports a gesture is not shown. The simulator returns True while the board makes it, as one current gesture.',
    },
    fields: open({
      call: field([callShape('accelerometer.is_gesture("shake")')]),
      import: field([importLine('from yolobit import *')]),
      module: field([moduleYolobit]),
      range: byDomain('The gestures are the seven of the block\'s dropdown.'),
      block: unknown('No trace timed is_gesture.'),
      return: unknown('When the board reports a gesture is not shown.'),
      content: unknown('The criteria of a gesture are not shown.'),
    }),
    domain: domain({ gesture: 'str' }, oneOf('gesture', ['shake', 'tilt_left', 'tilt_right', 'face_up', 'face_down', 'logo_up', 'logo_down'])),
  },
  {
    id: 'C-50',
    capability: 'sound: play a note (blocking)',
    tier: { 'ybc-basic': 'MUST', 'ybc-advanced': 'MUST' },
    profiles: BOTH,
    eligibility: 'RESTRICTED',
    restrictions: ['15 natural notes C3…C5', '1, 2 or 4 ticks at tempo (4, 120): 125 / 250 / 500 ms', 'timing is a vendor public simulator observation, NOT a physical timing verification'],
    modules: ['C-03c'],
    python: { form: "music.play(['<note>:<ticks>'], wait=True)" },
    fields: open({
      call: field([callShape("music.play(['C4:4'], wait=True)")]),
      import: field([importLine('import music')]),
      module: field([moduleMusic]),
      unit: field([
        claim('sound-indicator', 'EVD-20', 'A length of t ticks lasts t × 60000 / (bpm × ticks per beat) ms; at (4, 120): 1 / 2 / 4 ticks ≈ 125 / 250 / 500 ms.'),
        ui('The tempo is ticks per beat and beats per minute.'),
      ]),
      range: field([claim('sound-indicator', 'EVD-21', 'Fifteen natural notes C3…C5 sound; 1, 2 and 4 ticks are consistent, 8 is not.')]),
      default: explicit('The tempo is set explicitly by music.set_tempo(4, 120) (IM-4).'),
      clamp: byDomain('Notes and lengths outside the domain are not offered.'),
      block: field([ui('Tooltip: wait until the end.')], ['EVD-08']),
      error: byDomain('Outside the domain there is no behaviour to describe.'),
      content: field([claim('sound-indicator', 'EVD-21', 'Each note sounds at its frequency (12-TET, A4 = 440 Hz).')]),
    }),
    domain: {
      args: { note: 'str', ticks: 'int' },
      compileTime: [
        { when: oneOf('note', ['C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5']), diagnostic: 'value-out-of-range' },
        { when: oneOf('ticks', [1, 2, 4]), diagnostic: 'value-out-of-range' },
      ],
      runtime: all(oneOf('note', ['C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5']), oneOf('ticks', [1, 2, 4])),
    },
    timing: { blocksMs: 'ticks × 125 at tempo (4, 120)', source: 'SIM-observed' },
    presentation: ['timbre', 'volume'],
  },
  {
    id: 'C-51',
    capability: 'sound: rest (blocking)',
    tier: { 'ybc-basic': 'NICE', 'ybc-advanced': 'MUST' },
    profiles: BOTH,
    eligibility: 'RESTRICTED',
    restrictions: ['1, 2 or 4 ticks at tempo (4, 120)', 'timing is a vendor public simulator observation, NOT a physical timing verification'],
    modules: ['C-03c'],
    python: { form: "music.play(['R:<ticks>'], wait=True)" },
    fields: open({
      call: field([callShape("music.play(['R:1'], wait=True)")]),
      import: field([importLine('import music')]),
      module: field([moduleMusic]),
      unit: field([
        claim('sound-indicator', 'EVD-20', 'Rests last as notes do: at (4, 120) 1 / 2 / 4 ticks ≈ 125 / 250 / 500 ms.'),
        ui('The tempo is ticks per beat and beats per minute.'),
      ]),
      range: field([claim('sound-indicator', 'EVD-20', 'Rests of 2 ticks last ≈249 ms; 8 ticks (≈500 ms) is inconsistent and not offered.')]),
      default: explicit('The tempo is set explicitly by music.set_tempo(4, 120) (IM-4).'),
      clamp: byDomain('Lengths outside the domain are not offered.'),
      block: field([claim('blocking', 'EVD-20', 'With wait=True a rest blocks for its length.')]),
      error: byDomain('Outside the domain there is no behaviour to describe.'),
    }),
    domain: domain({ ticks: 'int' }, oneOf('ticks', [1, 2, 4])),
    timing: { blocksMs: 'ticks × 125 at tempo (4, 120)', source: 'SIM-observed' },
  },
  {
    id: 'C-23',
    capability: 'pin: digital write',
    tier: { 'ybc-basic': 'MUST' },
    profiles: BOTH,
    eligibility: 'RESTRICTED',
    restrictions: ['pins P0, P1, P2', 'value 0 or 1', 'the simulator\'s write-then-read-back is not evidence'],
    modules: ['C-03b'],
    python: { form: 'pin<N>.write_digital(<value>)' },
    fields: open({
      call: field([callShape('pin0.write_digital(1)')]),
      import: field([importLine('from yolobit import *')]),
      module: field([moduleYolobit]),
      range: field([claim('call-shape', 'EVD-02', 'The block\'s on/off map to write_digital(1) and write_digital(0).'), ui('Tooltip: switches on or off.')]),
      clamp: byDomain('Pins and values outside the domain are not offered.'),
      block: field([returnsAtOnce('write_digital', 'EVD-16')]),
      error: byDomain('Outside the domain there is no behaviour to describe.'),
      content: field([ui('1 is on (high), 0 is off.')]),
    }),
    domain: {
      args: { pin: 'int', value: 'int' },
      compileTime: [{ when: pins012, diagnostic: 'value-out-of-range' }, { when: oneOf('value', [0, 1]), diagnostic: 'value-out-of-range' }],
      runtime: all(pins012, oneOf('value', [0, 1])),
    },
  },
  {
    id: 'C-24',
    capability: 'pin: digital read',
    tier: { 'ybc-basic': 'MUST' },
    profiles: BOTH,
    eligibility: 'RESTRICTED',
    restrictions: ['pins P0, P1, P2', 'always compared `== 1`', 'an open or conflicting net stops the run (out-of-domain)'],
    modules: ['C-03b'],
    python: { form: '(pin<N>.read_digital() == 1)' },
    fields: open({
      call: field([callShape('(pin0.read_digital() == 1)')]),
      import: field([importLine('from yolobit import *')]),
      module: field([moduleYolobit]),
      range: field([ui('Tooltip: reads an on/off value.')]),
      block: field([returnsAtOnce('read_digital', 'EVD-16')]),
      return: field([ui('Tooltip: reads an on/off value.'), lang('True == 1, so the generated comparison is a bool whether the API returns int or bool.')]),
      error: byDomain('An open or conflicting net is outside the domain (out-of-domain); the pull default is unknown.'),
    }),
    domain: domain({ pin: 'int' }, pins012),
  },
  {
    id: 'C-25',
    capability: 'pin: analog read',
    tier: { 'ybc-basic': 'MUST' },
    profiles: BOTH,
    eligibility: 'RESTRICTED',
    restrictions: [
      'pins P0, P1, P2',
      'native scale 0..4095 (owner decision C-Q6 = Option A); the UI shows 0–100 %; no normalisation to 0–1023',
      'an open or conflicting net stops the run (out-of-domain)',
    ],
    modules: ['C-03b'],
    python: { form: 'int(pin<N>.read_analog())', builtins: ['int'] },
    fields: open({
      call: field([callShape('int(pin0.read_analog())')]),
      import: field([importLine('from yolobit import *')]),
      module: field([moduleYolobit]),
      range: field([
        claim('documented', ['DOC-W6', 'DOC-W7'], 'The analog value reads 0 to 4095 on the Yolo:Bit.'),
        claim('documented', ['DOC-W2', 'DOC-W6'], 'P0, P1 and P2 are the multi-function pins an analog sensor connects to.'),
      ]),
      round: explicit('The generator always writes int(...), so the type of the raw return does not matter.'),
      block: field([returnsAtOnce('read_analog', 'EVD-27')]),
      return: field([claim('documented', ['DOC-W6', 'DOC-W7'], 'The value read is the analog value, 0 to 4095.')]),
      error: byDomain('An open or conflicting net is outside the domain (out-of-domain).'),
    }),
    domain: { args: { pin: 'int', raw: 'int' }, compileTime: [{ when: pins012, diagnostic: 'value-out-of-range' }], runtime: all(pins012, between('raw', 0, 4095)) },
  },
  {
    id: 'C-27',
    capability: 'pin: servo 180°',
    tier: { 'ybc-advanced': 'MUST' },
    profiles: ADVANCED,
    eligibility: 'RESTRICTED',
    restrictions: ['pins P0, P1, P2', 'angle 0..180 degrees', 'does not block; the motion itself is presentation'],
    modules: ['C-03b'],
    python: { form: 'pin<N>.servo_write(<angle>)' },
    fields: open({
      call: field([callShape('pin0.servo_write(angle)')]),
      import: field([importLine('from yolobit import *')]),
      module: field([moduleYolobit]),
      unit: field([ui('The unit is degrees.')]),
      range: field([ui('Tooltip: turns to an angle in the range 0–180 degrees.')]),
      clamp: byDomain('Angles outside 0..180 are outside the domain.'),
      block: field([returnsAtOnce('servo_write', 'EVD-16')]),
      error: byDomain('Outside the domain there is no behaviour to describe.'),
      content: field([ui('Tooltip: turns to an angle in the range 0–180 degrees.')]),
    }),
    domain: {
      args: { pin: 'int', angle: 'int' },
      compileTime: [{ when: pins012, diagnostic: 'value-out-of-range' }, { when: between('angle', 0, 180), diagnostic: 'value-out-of-range' }],
      runtime: all(pins012, between('angle', 0, 180)),
    },
    presentation: ['servo motion'],
  },
  {
    id: 'C-29',
    capability: 'print',
    tier: { 'ybc-basic': 'MUST' },
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: ['one argument; prints str(value) and a newline'],
    modules: ['C-03e'],
    python: { form: 'print(<value>)', builtins: ['print'] },
    fields: open({
      call: field([callShape('print(x)')]),
      module: field([lang('print is a MicroPython builtin.')]),
      content: field([lang('print writes str(x) and a newline.'), ui('Tooltip: prints to the serial window.')]),
    }),
  },
  {
    id: 'C-30',
    capability: 'integer variable',
    tier: { 'ybc-basic': 'MUST' },
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: ['int only in Basic', 'results stay inside the safe-integer domain of the plan (§6.4)'],
    modules: [],
    python: { form: '<name> = <int>' },
    fields: open({
      call: field([callShape('x = 0')]),
      range: field([lang('Integers have arbitrary precision; the domain keeps results inside the safe-integer range.')]),
    }),
  },
  {
    id: 'C-31',
    capability: 'integer arithmetic + − ×',
    tier: { 'ybc-basic': 'MUST' },
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: ['safe-integer domain'],
    modules: [],
    python: { form: '<a> + <b>  |  <a> - <b>  |  <a> * <b>' },
    fields: open({
      call: field([callShape('a + b, a - b, a * b')]),
      range: field([lang('Integers have arbitrary precision.')]),
      return: field([lang('An int operation gives an int.')]),
      error: field([lang('Integer + − × raise no error.')]),
    }),
  },
  {
    id: 'C-32',
    capability: 'integer division //',
    tier: { 'ybc-basic': 'MUST' },
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: ['floor semantics', 'division by zero stops the run'],
    modules: [],
    python: { form: '<a> // <b>' },
    fields: open({
      call: field([lang('`//` is the floor-division operator of the language core.')]),
      range: field([lang('Integer operands give an integer result.')]),
      round: field([lang('Floor division rounds towards negative infinity: -7 // 2 == -4.')]),
      return: field([lang('An int // int gives an int.')]),
      error: field([lang('Division by zero raises ZeroDivisionError.')]),
    }),
  },
  {
    id: 'C-33',
    capability: 'remainder %',
    tier: { 'ybc-basic': 'MUST' },
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: ['the result takes the sign of the divisor', 'division by zero stops the run'],
    modules: [],
    python: { form: '<a> % <b>' },
    fields: open({
      call: field([callShape('a % b')]),
      range: field([lang('Integer operands give an integer result.')]),
      round: field([lang('The remainder takes the sign of the divisor: -7 % 3 == 2.')]),
      return: field([lang('An int % int gives an int.')]),
      error: field([lang('A remainder by zero raises ZeroDivisionError.')]),
    }),
  },
  {
    id: 'C-34',
    capability: 'comparison',
    tier: { 'ybc-basic': 'MUST' },
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: ['== and != between operands of one type; < <= > >= between ints'],
    modules: [],
    python: { form: '<a> <op> <b>' },
    fields: open({
      call: field([callShape('a == b, a < b, …')]),
      return: field([lang('A comparison gives a bool.')]),
    }),
  },
  {
    id: 'C-35',
    capability: 'logic: and, or, not',
    tier: { 'ybc-basic': 'MUST' },
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: ['on bools only', 'short-circuit like Python'],
    modules: [],
    python: { form: '<a> and <b>  |  <a> or <b>  |  not <a>' },
    fields: open({
      call: field([callShape('a and b, a or b, not a')]),
      return: field([lang('Short-circuit evaluation: the right operand is not evaluated when not needed.')]),
    }),
  },
  {
    id: 'C-36',
    capability: 'if / elif / else',
    tier: { 'ybc-basic': 'MUST' },
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: ['the condition is a bool'],
    modules: [],
    python: { form: 'if <cond>:\n    <body>\nelif <cond>:\n    <body>\nelse:\n    <body>' },
    fields: open({ call: field([callShape('if / elif / else')]) }),
  },
  {
    id: 'C-37',
    capability: 'repeat N times',
    tier: { 'ybc-basic': 'MUST' },
    profiles: BOTH,
    eligibility: 'RESTRICTED',
    restrictions: ['abs(N) ≤ 1 000 000 (range arguments must fit in a machine word)', 'N ≤ 0 runs zero times'],
    modules: [],
    python: { form: 'for _r<k> in range(<n>):\n    <body>', builtins: ['range'] },
    fields: open({
      call: field([callShape('for count in range(3):')]),
      range: field([claim('documented', 'DOC-M9', 'Range arguments must fit in a machine word; large values misbehave.')]),
      clamp: byDomain('abs(N) above the limit is outside the domain.'),
    }),
    domain: domain({ n: 'int' }, between('n', -MAX, MAX)),
  },
  {
    id: 'C-38',
    capability: 'while',
    tier: { 'ybc-basic': 'MUST' },
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: ['the condition is a bool, tested before each iteration'],
    modules: [],
    python: { form: 'while <cond>:\n    <body>' },
    fields: open({ call: field([callShape('while c:')]) }),
  },
  {
    id: 'C-39',
    capability: 'count up',
    tier: { 'ybc-basic': 'MUST' },
    profiles: BOTH,
    eligibility: 'RESTRICTED',
    restrictions: [
      'start, then end, each evaluated exactly once before the loop',
      '0 ≤ start, end ≤ 1 000 000; step a literal in 1..1 000 000',
      'two literal bounds with start > end: compile error; at run time start > end runs zero times',
    ],
    modules: [],
    python: { form: 'for <i> in range(<a>, <b> + 1[, <s>]):\n    <body>', builtins: ['range'] },
    fields: open({
      call: field([callShape('for i in range(1, 11):'), lang('range(start, stop, step) as in Python.')]),
      range: field([claim('documented', 'DOC-M9', 'Range arguments must fit in a machine word; large values misbehave.')]),
      clamp: byDomain('Bounds outside 0..1 000 000 are outside the domain.'),
      error: byDomain('Outside the domain there is no behaviour to describe.'),
      content: field([lang('The loop variable ends at the last value, or is unchanged after zero iterations; the evaluation order is made explicit by the generator.')]),
    }),
    domain: {
      args: { start: 'int', end: 'int', step: 'int' },
      evaluation: { order: ['start', 'end'], once: true, checkEach: 'after-own-evaluation', temporaries: 'unless-all-literal' },
      compileTime: [
        { when: { literal: { arg: 'step' } }, diagnostic: 'literal-required' },
        { when: between('step', 1, MAX), diagnostic: 'value-out-of-range' },
        { when: between('start', 0, MAX), diagnostic: 'value-out-of-range' },
        { when: between('end', 0, MAX), diagnostic: 'value-out-of-range' },
        { when: { le: [arg('start'), arg('end')] }, diagnostic: 'descending-range-not-supported' },
      ],
      runtime: all(between('start', 0, MAX), between('end', 0, MAX)),
    },
  },
  {
    id: 'C-56',
    capability: 'text, join, str()',
    tier: { 'ybc-basic': 'MUST' },
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: ['str(int) is decimal, str(bool) is True/False'],
    modules: [],
    python: { form: "'<text>' + str(<value>)", builtins: ['str'] },
    fields: open({
      call: field([callShape("'n=' + str(5)")]),
      return: field([lang('str() of an int is its decimal form; of a bool, True or False; of a str, itself.')]),
    }),
  },
  {
    id: 'C-57',
    capability: 'text variable',
    tier: { 'ybc-advanced': 'MUST' },
    profiles: ADVANCED,
    eligibility: 'ELIGIBLE',
    restrictions: ['one static type per variable'],
    modules: [],
    python: { form: "<name> = '<text>'" },
    fields: open({
      call: field([callShape("s = ''")]),
      return: field([lang('A str variable holds a str.')]),
    }),
  },
  {
    id: 'C-58',
    capability: 'text length',
    tier: { 'ybc-advanced': 'NICE' },
    profiles: ADVANCED,
    eligibility: 'RESTRICTED',
    restrictions: ['ASCII strings only'],
    modules: [],
    python: { form: 'len(<text>)', builtins: ['len'] },
    fields: open({
      call: field([callShape("len('abc')")]),
      range: field([lang('len returns the number of characters.')]),
      error: byDomain('Strings outside ASCII are outside the domain.'),
      return: field([lang('len returns an int.')]),
    }),
    domain: domain({ text: 'str' }, { ascii: { arg: 'text', from: 0x20, to: 0x7e } }, 'display-char-unsupported'),
  },
  {
    id: 'C-59',
    capability: 'function (gate FN)',
    tier: { 'ybc-advanced': 'MUST' },
    profiles: ADVANCED,
    eligibility: 'RESTRICTED',
    restrictions: ['FN1–FN10 of plan §6.10 (structure, not a value restriction)'],
    modules: [],
    python: { form: 'def <name>(<params>):\n    <body>\n    return <expr>' },
    fields: open({
      call: field([callShape('def, global, return expr')]),
      return: field([lang('A function returns the value of its return expression.')]),
      error: field([lang('Python 3.4 call semantics; no early return, no recursion in the subset.')]),
    }),
    domain: structural({}),
  },
];

// --- Constructs that are not shown (EXCLUDED / DEFERRED, contract §15.2) ----------------------------

const withdrawn = (
  id: string,
  capability: string,
  eligibility: 'EXCLUDED' | 'DEFERRED',
  exclusionReason: string,
  extra: Omit<Partial<ConstructContract>, 'fields'> & { fields?: Partial<Record<OfField, FieldEntry>> } = {},
): ConstructContract => {
  const { fields: known = {}, ...rest } = extra;
  return {
    id,
    capability,
    tier: {},
    profiles: [],
    eligibility,
    restrictions: [],
    modules: [],
    fields: closed(known),
    exclusionReason,
    ...rest,
  };
};

const callOnly = (statement: string) => ({ call: field([callShape(statement)]) });

const randomDomain: Domain = {
  args: { a: 'int', b: 'int' },
  evaluation: { order: ['a', 'b'], once: true, checkEach: 'after-own-evaluation' },
  compileTime: [],
  runtime: all(
    { le: [num(-MAX), arg('a')] },
    { le: [arg('a'), arg('b')] },
    { le: [arg('b'), num(MAX)] },
    { le: [{ sub: [arg('b'), arg('a')] }, num(MAX)] },
  ),
};

const withdrawnConstructs: readonly ConstructContract[] = [
  withdrawn('C-11', 'display: brightness', 'EXCLUDED', 'The behaviour cannot be observed (EVD-13).', {
    observedPython: 'display.set_brightness(n)',
    fields: callOnly('display.set_brightness(n)'),
  }),
  withdrawn('C-14', 'button: press event', 'DEFERRED', 'Event gate EV: EV1–EV10 are UNKNOWN (contract §13).', {
    observedPython: 'button_a.on_pressed = f',
    fields: callOnly('button_a.on_pressed = f'),
  }),
  withdrawn('C-19', 'running time', 'EXCLUDED', 'Wrap, reset and the range of a difference are UNKNOWN; the origin is contradictory (R3). LATER.', {
    observedPython: 'running_time()',
    fields: callOnly('running_time()'),
  }),
  withdrawn('C-20', 'built-in melody', 'EXCLUDED', 'Asset of the vendor (provenance).', { observedPython: 'music.play(music.ODE)' }),
  withdrawn('C-21', 'music.pitch', 'EXCLUDED', 'How a tone ends and overlapping tones are not observable.', { observedPython: 'music.pitch(440, 1000)' }),
  withdrawn('C-22', 'music.stop', 'EXCLUDED', 'How a tone ends is not observable.', { observedPython: 'music.stop()' }),
  withdrawn('C-26', 'analog write / PWM', 'EXCLUDED', 'OF-range is UNKNOWN; the owner confirmed it stays excluded (C-Q6).', {
    observedPython: 'pin0.write_analog(512)',
    fields: callOnly('pin0.write_analog(512)'),
  }),
  withdrawn('C-28', 'pulse in', 'EXCLUDED', 'OF-error and OF-block are UNKNOWN; the simulator\'s reply is an electrical claim.', { observedPython: 'pin0.pulse_in(1)' }),
  withdrawn('C-40', 'random integer', 'EXCLUDED', 'OF-module of random.randint is INFERRED (C-03d); the domain below is specified for the day it is reopened.', {
    observedPython: 'random.randint(1, 6)',
    modules: ['C-03d'],
    fields: {
      call: field([callShape('random.randint(1, 6)')]),
      import: field([importLine('import random')]),
      module: inferred('Not shown to exist on the Yolo:Bit firmware (C-03d).'),
      range: field([claim('documented', 'DOC-M3', 'randint returns an integer in [a, b], at most the native word size.')]),
    },
    preSpecifiedDomain: randomDomain,
  }),
  withdrawn('C-41', 'program end', 'EXCLUDED', 'Not a construct: the end of a program is avoided by the idle loop (IM-6).'),
  withdrawn('C-44', 'display: graph', 'EXCLUDED', 'OF-content is UNKNOWN.', { observedPython: 'display.show_graph(v, max)' }),
  withdrawn('C-45', 'make an RGB colour', 'EXCLUDED', 'Needs floats and round.', { observedPython: 'colour_rgb(...)' }),
  withdrawn('C-46', 'show information', 'EXCLUDED', 'The editor\'s code does not stand alone (no import).', { observedPython: "say('Hello')" }),
  withdrawn('C-47', 'buttons A+B', 'EXCLUDED', 'Unsupported in the accepted simulator snapshot (AttributeError); no claim about the physical board.', {
    observedPython: 'button_a.is_pressed_ab()',
  }),
  withdrawn('C-48', 'touch pin', 'EXCLUDED', 'Criteria are UNKNOWN.', { observedPython: 'pin0.is_touched()' }),
  withdrawn('C-49', 'timer', 'EXCLUDED', 'The editor\'s code does not stand alone (no import).', { observedPython: 'timer.reset()' }),
  withdrawn('C-52', 'tempo for the learner', 'EXCLUDED', 'The tempo is fixed by the generator (IM-4).', { observedPython: 'music.set_tempo(ticks, bpm)' }),
  withdrawn('C-53', 'servo 270 / 360 / release', 'EXCLUDED', 'Outside the tier; not observable.', { observedPython: 'servo_write(a, max=270)' }),
  withdrawn('C-54', 'pin pull', 'EXCLUDED', 'The editor\'s code does not stand alone (no import).', { observedPython: 'pin0.set_pull(...)' }),
  withdrawn('C-60', 'unusual note lengths', 'EXCLUDED', '8 or more ticks, fractional ticks and frequency strings are inconsistent in the simulator.', {
    observedPython: "music.play(['C4:8'], wait=True)",
  }),
  withdrawn('C-69', 'ultrasonic sensor', 'EXCLUDED', 'Depends on pulse_in (C-28). LATER.'),
  withdrawn('C-70', 'image digits 2–8', 'EXCLUDED', 'OF-content is contradictory (colour table vs. display, EVD-13). Not a construct of its own: since N17 B1 the colour field of C-06 writes digits 2–8 as an UNVERIFIED form of C-06.', { observedPython: 'Image("2…")' }),
  withdrawn('C-55', 'grouped exclusions', 'EXCLUDED', 'Domain, non-goal, or code that does not stand alone: serial block, floats and extended maths, map/constrain/to-number, wait-until, break/list, background run, Bluetooth/game/device blocks.', {
    alsoCovers: ['C-61', 'C-62', 'C-63', 'C-64', 'C-65', 'C-66'],
  }),
];

// --- The contract ----------------------------------------------------------------------------------

export const yolobitContract: YolobitContract = {
  contractId: 'yolobit-micropython',
  version: '1.0.0-draft.r3',
  status: 'Frozen for YB-1 (YB-0 approved, RV-1 = ACCEPT WITH RESTRICTIONS, OQ-E approved, C-Q6 = Option A). Pinned to a public evidence snapshot, not a timeless guarantee.',
  snapshot: {
    observedOn: '2026-10-14',
    editorBuildMarker: '20261007130057',
    blocklyVersion: '8.0.1',
    simulatorBuild: '658a5…',
    firmwareListing: ['Yolo:Bit v1.12', 'Yolo:Bit S3 v1.14'],
    firmwareExact: 'UNKNOWN',
    micropythonVersion: 'UNKNOWN',
    statement:
      'Exact firmware version UNKNOWN; compatibility contract is pinned to this public evidence snapshot (editor ?v=20261007130057, simulator build 658a5…, firmware listing "Yolo:Bit v1.12" / "Yolo:Bit S3 v1.14" as of 2026-10-14) and is not a timeless compatibility guarantee.',
  },
  rv1: 'ACCEPT_WITH_RESTRICTIONS',
  evidence: evidenceLedger,
  constants: {
    MAX_RANGE_VALUE: 1_000_000,
    MAX_REPEAT_ABS: 1_000_000,
    MAX_RANDOM_ABS: 1_000_000,
    MAX_RANDOM_SPAN: 1_000_000,
    DISPLAY_CHARSET: { from: 0x20, to: 0x7e },
  },
  display: {
    width: 5,
    height: 5,
    indexBase: 0,
    origin: 'top-left',
    x: 'column',
    y: 'row',
    colourFormat: '#rrggbb',
    defaultColour: '#FF0000',
    palette,
    approval: 'OQ-E APPROVED by the owner, 2026-10-14 (contract §4.3)',
  },
  analog: {
    nativeMax: 4095,
    uiPercentMax: 100,
    normalisedTo1023: false,
    approval: 'C-Q6 = Option A by the owner, 2026-10-14 (contract §10.2); PWM / analog write stays EXCLUDED',
  },
  modules,
  constructs: [...exposed, ...withdrawnConstructs],
};
