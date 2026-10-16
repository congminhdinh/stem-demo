import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLaunch } from '../app/launch';
import { blockName, coreMessageRules, launchProblemRules, localizeCoreMessage, localizeLaunchProblem, matchingRule } from './core-text';

const sourceRoot = join(import.meta.dirname, '..', '..');

/** The files whose messages reach the UI: compile diagnostics, runtime faults, validity layers, the run session. */
const messageSources = [
  'core/program/compile-program.ts',
  'core/program/compile-ybc-program.ts',
  'core/program/ybc-interpreter.ts',
  'core/program/values.ts',
  'core/constructs/ybc.pins.ts',
  'core/run/ybc-pin-io.ts',
  'core/profiles/validity.ts',
  'core/run/run-session.ts',
];

/**
 * Every message literal of those files, as `report(severity, code, …)`, `new RuntimeFault(code, …)` or `message: …`
 * writes it, with each `${…}` replaced by X: what the overlay must recognise, whatever the values.
 */
function coreMessages(): string[] {
  const literal = /(?:report\(\s*'(?:error|warning)',\s*'[a-z-]+',\s*|new RuntimeFault\(\s*'[a-z-]+',\s*|message:\s*)(?:'((?:\\.|[^'\\])*)'|`((?:\\.|[^`\\])*)`)/g;
  const found = new Set<string>();
  for (const file of messageSources) {
    for (const match of readFileSync(join(sourceRoot, file), 'utf8').matchAll(literal)) {
      const text = (match[1] ?? match[2] ?? '').replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, 'X');
      // A template with a nested template (validity.ts' profile sentence) is listed by hand below.
      if (!text.includes('${') && !text.includes('`')) {
        found.add(text);
      }
    }
  }
  return [...found];
}

/** Messages the scan cannot read (built by a ternary, or a nested template), as the core writes them. */
const handWritten = [
  '"<" compares whole numbers, not a text and a whole number.',
  '"==" compares two values of one type, not a true / false value and a text.',
  '"ybc_light_level" is not available in the ybc-basic profile.',
  '"ybc_light_level" is not available in a generic project.',
  'led cannot be used in a ybc-basic project.',
  'led, button cannot be used in a generic project.',
  'This board has no analog input, so this block cannot be used.',
];

describe('the core’s messages in Vietnamese (N8s)', () => {
  it('reads the core’s sources', () => {
    expect(coreMessages().length).toBeGreaterThan(80);
  });

  it.each(coreMessages())('knows %j', (message) => {
    expect(matchingRule(coreMessageRules, message)).toBeGreaterThanOrEqual(0);
    expect(localizeCoreMessage(message, 'vi')).not.toBe(message);
  });

  it.each(handWritten)('knows %j, which the scan cannot read', (message) => {
    expect(matchingRule(coreMessageRules, message)).toBeGreaterThanOrEqual(0);
  });

  it('has no rule that no message of the core reaches', () => {
    const reached = new Set([...coreMessages(), ...handWritten].map((message) => matchingRule(coreMessageRules, message)));
    const unreached = coreMessageRules.map(([pattern], index) => (reached.has(index) ? null : String(pattern))).filter((rule) => rule !== null);
    expect(unreached).toEqual([]);
  });

  it.each([
    ['Only one "stem_on_start" block is allowed.', 'Chỉ được có một khối "khi bắt đầu".'],
    ['"if" needs a condition.', 'Khối "nếu" cần một điều kiện.'],
    ['"while" needs a true / false condition, not a whole number.', 'Khối "lặp khi" cần một điều kiện đúng / sai, không phải một số nguyên.'],
    ['"repeat" needs a whole number, not a text.', '"lặp lại" cần một số nguyên, không phải một đoạn chữ.'],
    ['"count up" start needs a whole number, not a true / false value.', 'Số bắt đầu của "đếm lên" cần một số nguyên, không phải một giá trị đúng / sai.'],
    ['"x" (a whole-number variable) needs a whole number, not a text.', '"x" (biến số nguyên) cần một số nguyên, không phải một đoạn chữ.'],
    ['A wait must be between 0 and 60000, not 70000.', 'Thời gian chờ phải nằm trong khoảng 0 tới 60000, không phải 70000.'],
    ['The number of repetitions must be between -1000000 and 1000000.', 'Số lần lặp phải nằm trong khoảng -1000000 tới 1000000.'],
    ['The sum is outside the supported integer range (±9007199254740991).', 'Tổng vượt quá khoảng số nguyên được hỗ trợ (±9007199254740991).'],
    ['Division by zero.', 'Chia cho 0.'],
    ['Pin P1 is not connected to anything, so it cannot be read.', 'Chân P1 chưa nối với gì, nên không đọc được.'],
    ['This board has no display for "ybc_display_show_image".', 'Bo mạch này không có màn hình cho khối "hiển thị hình".'],
    ['Blocks outside "on start" and "forever" do not run.', 'Khối nằm ngoài "khi bắt đầu" và "lặp mãi mãi" sẽ không chạy.'],
    ['The circuit needs a board.', 'Mạch cần có một bo mạch.'],
    ['"ybc_light_level" is not available in the ybc-basic profile.', 'Khối "mức ánh sáng" không có ở cấp độ ybc-basic.'],
    ['Unknown block "stem_servo".', 'Không biết khối "stem_servo".'],
  ])('says %j as %j', (english, vietnamese) => {
    expect(localizeCoreMessage(english, 'vi')).toBe(vietnamese);
  });

  it('leaves English as the core wrote it, and a sentence it does not know as it is', () => {
    expect(localizeCoreMessage('Division by zero.', 'en')).toBe('Division by zero.');
    expect(localizeCoreMessage('Something new happened.', 'vi')).toBe('Something new happened.');
  });

  it.each([
    ['stem_on_start', 'khi bắt đầu'],
    ['ybc_sound_note', 'phát nốt trong nhịp'],
    ['controls_if', 'nếu'],
    ['stem_servo', 'stem_servo'],
    ['constructor', 'constructor'],
  ])('names the block %s "%s"', (type, name) => {
    expect(blockName(type)).toBe(name);
  });
});

describe('a broken launch in Vietnamese (N8s)', () => {
  const broken = [
    '?template=blink',
    '?embed=0&template=blink',
    '?embed=1&lab=blockly&lab=blockly&template=blink',
    '?embed=1&lab=scratch&template=blink',
    '?embed=1&lab=&template=blink',
    '?embed=1&lab=yolobit',
    '?embed=1&template=blink&template=led-on',
    '?embed=1&lab=blockly&template=blinky',
    '?embed=1&lab=blockly&template=ybc-heart',
    '?embed=1&lab=yolobit&template=ybc-heart&profile=ybc-basic&profile=ybc-basic',
    '?embed=1&lab=blockly&template=blink&profile=ybc-basic',
    '?embed=1&lab=yolobit&template=ybc-heart&profile=ybc-pro',
    '?embed=1&lab=blockly&template=blink&origin=http://a.example&origin=http://a.example',
    `?embed=1&lab=blockly&template=blink&origin=${encodeURIComponent('http://localhost:3000/')}`,
  ];

  it.each(broken)('says the problem of %s in Vietnamese', (search) => {
    const launch = parseLaunch(search);
    if (launch.mode !== 'invalid') {
      throw new Error(`${search} is not a broken launch`);
    }
    expect(matchingRule(launchProblemRules, launch.problem)).toBeGreaterThanOrEqual(0);
    expect(localizeLaunchProblem(launch.problem, 'vi')).not.toBe(launch.problem);
    expect(localizeLaunchProblem(launch.problem, 'en')).toBe(launch.problem);
  });

  it('has no rule that no broken launch reaches', () => {
    const reached = new Set(
      broken.map((search) => {
        const launch = parseLaunch(search);
        return launch.mode === 'invalid' ? matchingRule(launchProblemRules, launch.problem) : -1;
      }),
    );
    expect(launchProblemRules.map((_, index) => index).filter((index) => !reached.has(index))).toEqual([]);
  });

  it('keeps the key and the lab it names', () => {
    expect(localizeLaunchProblem('The template "ybc-heart" does not open in lab=blockly.', 'vi')).toBe('Mẫu bài "ybc-heart" không mở trong lab=blockly.');
    expect(localizeLaunchProblem('Unknown profile "ybc-pro": use ybc-basic or ybc-advanced.', 'vi')).toBe('Không có cấp độ "ybc-pro": dùng ybc-basic hoặc ybc-advanced.');
  });
});
