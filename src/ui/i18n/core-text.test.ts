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
  // N18 R2.2: the robot's blocks, their runs, and the kit's pin rules the compiler reports on a block.
  'core/program/compile-uno-modules.ts',
  'core/constructs/uno.roles.ts',
  'core/constructs/uno.run.ts',
  'core/hardware/pin-rules.ts',
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
  'This board has no PWM output, so this block cannot be used.',
  'This board has no servo pin, so this block cannot be used.',
  // N18 R2.2: a field's messages, passed to the module compiler's `choice`; a kit's pin conflict (a nested template); L-1's kit.
  'A drive block needs its direction.',
  'A direction is forward, backward, spin left or spin right.',
  'An LED block needs on or off.',
  'An LED is on or off.',
  'A digital write needs HIGH or LOW.',
  'A pin is written HIGH or LOW.',
  'Pin D5 is wired to more than one port: M1 (EN), M3 (PIN).',
  'The robot kit "acme-rover@2" is not one this app knows.',
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
    // N17 B1.
    ['The colour "red" is not one of the display\'s colours, so it is shown red.', 'Màu "red" không phải một màu của màn hình, nên đèn sáng màu đỏ.'],
    ['"math_number" is not a colour, so it is shown red.', 'Khối "số" không phải một màu, nên đèn sáng màu đỏ.'],
    ['The column must be between 0 and 4, not 5.', 'Cột phải nằm trong khoảng 0 tới 4, không phải 5.'],
    ['The row must be between 0 and 4.', 'Hàng phải nằm trong khoảng 0 tới 4.'],
    ['"set light" needs a value.', 'Khối "bật đèn" cần một giá trị.'],
    // N17 B4: the floating pin, in the words of the owner's ruling, A+B and random numbers.
    ['Pin P1 is floating, so it reads 0. Connect the button to 3V3 or GND.', 'Chân P1 đang thả nổi — đọc là 0. Hãy nối nút với 3V3 hoặc GND.'],
    // N17 B5: a value outside its range is clamped, with a warning, in Vietnamese in a lab launch.
    ['The analog value 2000 for P0 is outside 0 to 1023, so it is clamped to 1023.', 'Giá trị analog 2000 của chân P0 nằm ngoài khoảng 0 tới 1023, nên được kẹp về 1023.'],
    ['The servo angle -40 for P1 is outside 0 to 180, so it is clamped to 0.', 'Góc servo -40 của chân P1 nằm ngoài khoảng 0 tới 180, nên được kẹp về 0.'],
    ['An analog value is between 0 and 1023, not 1024.', 'Giá trị analog nằm trong khoảng 0 tới 1023, không phải 1024.'],
    ['A servo angle is between 0 and 180, not -1.', 'Góc servo nằm trong khoảng 0 tới 180, không phải -1.'],
    ['This board has no PWM output, so this block cannot be used.', 'Bo mạch này không có đầu ra PWM, nên không dùng được khối này.'],
    ['This board has no servo pin, so this block cannot be used.', 'Bo mạch này không có chân servo, nên không dùng được khối này.'],
    ['A button is A, B or A+B.', 'Nút là A, B hoặc A+B.'],
    ['A bound of a random number must be between -1000000 and 1000000, not 1000001.', 'Một đầu của số ngẫu nhiên phải nằm trong khoảng -1000000 tới 1000000, không phải 1000001.'],
    ['The bounds of a random number must be at most 1000000 apart.', 'Hai đầu của số ngẫu nhiên chỉ được cách nhau tối đa 1000000.'],
    ['"random number" needs a value.', 'Khối "số ngẫu nhiên" cần một giá trị.'],
    ['"math_random_int" is not available here; use "ybc_random_int".', 'Khối "số ngẫu nhiên (của Blockly)" không dùng ở đây; hãy dùng khối "số ngẫu nhiên từ tới".'],
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

describe('the robot’s messages in Vietnamese (N18 R2.2, lab=robot)', () => {
  it.each([
    ['"uno_servo_set" needs servo 1, which the kit acme-rover@2 does not have.', 'Khối "servo góc °" cần servo 1, mà bộ robot acme-rover@2 không có.'],
    ['"uno_drive_move" needs the left and the right motor, which the kit k@1 does not have.', 'Khối "robot đi tốc độ %" cần motor trái và motor phải, mà bộ robot k@1 không có.'],
    ['The kit k@1 has the left line sensor, but not for "uno_line_raw".', 'Bộ robot k@1 có cảm biến line trái, nhưng không dùng được cho khối "giá trị thô cảm biến line".'],
    ['This board has no modules for "uno_led_set".', 'Bo mạch này không có mô-đun robot cho khối "đèn".'],
    ['The speed 150 for the left motor is outside -100 to 100, so it is clamped to 100.', 'Tốc độ 150 của motor trái nằm ngoài khoảng -100 tới 100, nên được kẹp về 100.'],
    ['The frequency 10 for the buzzer is outside 31 to 4000, so it is clamped to 31.', 'Tần số 10 của còi nằm ngoài khoảng 31 tới 4000, nên được kẹp về 31.'],
    ['The PWM value 300 for D10 is outside 0 to 255, so it is clamped to 255.', 'Giá trị PWM 300 của D10 nằm ngoài khoảng 0 tới 255, nên được kẹp về 255.'],
    ['The speed needs a whole number, not a true / false value.', 'Tốc độ cần một số nguyên, không phải một giá trị đúng / sai.'],
    ['"robot go" needs a value.', 'Khối "robot đi" cần một giá trị.'],
    ['pwm.write cannot use D5: port M1 of the kit uses it.', 'Khối ghi PWM không dùng được chân D5: cổng M1 của bộ robot đang dùng chân này.'],
    ['digital.write cannot use D0: the program prints, and Serial holds D0 and D1.', 'Khối ghi số không dùng được chân D0: chương trình có in, và Serial giữ D0 và D1.'],
    ['digital.read cannot use A3: no input module is wired to it, and a floating pin reads at random.', 'Khối đọc số không dùng được chân A3: không có mô-đun đầu vào nào nối với chân này, và chân thả nổi đọc ra giá trị ngẫu nhiên.'],
    ['digital.read cannot use D99: it is not a pin of uno-r3.', 'Khối đọc số không dùng được chân D99: uno-r3 không có chân này.'],
    ['A3 has no PWM: pwm.write drives it HIGH from 128 up and LOW below.', 'Chân A3 không có PWM: ghi PWM từ 128 trở lên là HIGH, dưới 128 là LOW.'],
    ['PWM on D10 is not possible: the servo holds timer T1 there, so the pin would stay LOW (contract U-48).', 'Không ghi PWM được ở chân D10: servo đang giữ timer T1 ở đó, nên chân sẽ luôn ở mức LOW (contract U-48).'],
    ['Port M1 needs PWM on D10, but the servo holds timer T1 there: the pin would stay LOW (contract U-48).', 'Cổng M1 cần PWM ở chân D10, nhưng servo đang giữ timer T1 ở đó: chân sẽ luôn ở mức LOW (contract U-48).'],
    ['The ultrasonic distance is not a whole number from 2 to 400.', 'Khoảng cách siêu âm không phải số nguyên từ 2 tới 400.'],
    ['The robot kit "acme-rover@2" is not one this app knows.', 'Ứng dụng này chưa có bộ robot "acme-rover@2".'],
  ])('says %j as %j', (english, vietnamese) => {
    expect(localizeCoreMessage(english, 'vi')).toBe(vietnamese);
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
    '?embed=1&lab=yolobit&template=ybc-dice&profile=ybc-basic',
    // N18 R4.1: the robot lab's own sentences (a scenario of the legacy launch; a level that is not the robot's).
    '?embed=1&template=rb-sandbox',
    '?embed=1&lab=blockly&template=rb-sandbox',
    '?embed=1&lab=robot&template=rb-unknown',
    '?embed=1&lab=robot&template=rb-sandbox&profile=ybc-basic',
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

  it('says which level a lab of the Advanced board needs (N17 B6)', () => {
    expect(localizeLaunchProblem('The template "ybc-thermometer" needs profile=ybc-advanced: it uses blocks or parts that ybc-basic does not have.', 'vi')).toBe(
      'Mẫu bài "ybc-thermometer" cần mức Nâng cao (profile=ybc-advanced): bài dùng khối hoặc linh kiện mà mức Cơ bản không có.',
    );
  });

  it('keeps the key and the lab it names', () => {
    expect(localizeLaunchProblem('The template "ybc-heart" does not open in lab=blockly.', 'vi')).toBe('Mẫu bài "ybc-heart" không mở trong lab=blockly.');
    expect(localizeLaunchProblem('Unknown profile "ybc-pro": use ybc-basic or ybc-advanced.', 'vi')).toBe('Không có cấp độ "ybc-pro": dùng ybc-basic hoặc ybc-advanced.');
  });
});
