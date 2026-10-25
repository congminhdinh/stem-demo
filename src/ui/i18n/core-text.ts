import type { Locale } from './messages';
import { viBlockText } from './blocks';

// What the core says, in the UI's language (N8s). The core has no locale (B1): its compiler, interpreter and
// validity layers word their diagnostics in English, and the launch parser words a broken URL in English. This
// overlay recognises those sentences, one rule per sentence frame, and says them in Vietnamese; the names inside
// (a block, a pin, a number) are carried over, a block by its Vietnamese text where the UI has one. A sentence no
// rule knows is shown as the core wrote it: English, never nothing. English launches get the core's text unchanged.
// When the core gains or rewords a message, core-text.test.ts (which reads the core's sources) says so.

type Rule = readonly [pattern: RegExp, say: (...parts: string[]) => string];

/** Words of the core's sentences that name a block or an input by its English label. */
const terms: Readonly<Record<string, string>> = {
  if: 'nếu',
  'else if': 'nếu không thì nếu',
  while: 'lặp khi',
  repeat: 'lặp lại',
  'count up': 'đếm lên',
  'count up from': 'đếm lên từ',
  'count up to': 'đếm lên tới',
  wait: 'chờ',
  'scroll text': 'chạy chữ',
  'scroll number': 'chạy số',
  compare: 'so sánh',
  join: 'nối chữ',
  not: 'phủ định',
  and: 'và',
  or: 'hoặc',
  'on start': 'khi bắt đầu',
  forever: 'lặp mãi mãi',
  'set pin': 'đặt chân',
  set: 'đặt',
  'analog read': 'đọc tương tự',
  'set light': 'bật đèn',
  'turn off light': 'tắt đèn',
  'start tone': 'bật âm',
  'random number': 'số ngẫu nhiên',
  'analog write': 'ghi analog',
  servo: 'servo',
  // N18 R2.2: the robot's blocks.
  'robot go': 'robot đi',
  motor: 'motor',
  'buzzer tone': 'còi kêu',
  'PWM write': 'ghi PWM',
};

/** Blockly's own blocks that the core may name by type; the custom blocks are named by their Vietnamese text. */
const builtinBlockNames: Readonly<Record<string, string>> = {
  controls_if: 'nếu',
  controls_repeat_ext: 'lặp lại',
  logic_compare: 'so sánh',
  logic_operation: 'và / hoặc',
  logic_negate: 'phủ định',
  logic_boolean: 'đúng / sai',
  math_number: 'số',
  math_arithmetic: 'phép tính',
  math_modulo: 'chia lấy dư',
  math_random_int: 'số ngẫu nhiên (của Blockly)',
  text: 'chữ',
  text_join: 'nối chữ',
  text_print: 'in',
  variables_get: 'biến',
  variables_set: 'đặt biến',
};

/** What the type checker calls a type (compile-ybc-program.ts `describe`). */
const types: Readonly<Record<string, string>> = {
  'a whole number': 'một số nguyên',
  'a true / false value': 'một giá trị đúng / sai',
  'a text': 'một đoạn chữ',
};

/** The quantities of a range or overflow message (`what`). */
const quantities: Readonly<Record<string, string>> = {
  'The number of repetitions': 'Số lần lặp',
  'The start': 'Số bắt đầu',
  'The end': 'Số kết thúc',
  'A wait': 'Thời gian chờ',
  'The sum': 'Tổng',
  'The difference': 'Hiệu',
  'The product': 'Tích',
  'The quotient': 'Thương',
  'The remainder': 'Số dư',
  'The column': 'Cột',
  'The row': 'Hàng',
  'The frequency': 'Tần số',
  'The length of a tone': 'Độ dài âm',
  'A bound of a random number': 'Một đầu của số ngẫu nhiên',
  'The running time': 'Thời gian chạy',
  'An analog value': 'Giá trị analog',
  'A servo angle': 'Góc servo',
  // N18 R2.2: the robot's blocks, and what the board answers them.
  'The speed': 'Tốc độ',
  'The angle': 'Góc',
  'A PWM value': 'Giá trị PWM',
  'The ultrasonic distance': 'Khoảng cách siêu âm',
  'The raw line value': 'Giá trị thô của cảm biến line',
  'The analog value': 'Giá trị analog',
};

/** The capabilities a board may lack (constructs' `capability`). */
const capabilities: Readonly<Record<string, string>> = {
  display: 'màn hình',
  buttons: 'nút bấm',
  light: 'cảm biến ánh sáng',
  sound: 'loa',
  temperature: 'cảm biến nhiệt độ',
  motion: 'gia tốc kế',
  digital: 'chân số',
  analogIn: 'đầu vào tương tự',
  'analog input': 'đầu vào tương tự',
  'digital pin': 'chân số',
  'PWM output': 'đầu ra PWM',
  'servo pin': 'chân servo',
  // N18 R2.2: the robot's (the kit's modules) and the UNO's PWM.
  modules: 'mô-đun robot',
  pwm: 'đầu ra PWM',
};

/** N18 R2.2: the robot's modules as the core names them (constructs/uno.roles.ts `roleNames`, `DRIVE_NAME`). */
const robotRoles: Readonly<Record<string, string>> = {
  'the left motor': 'motor trái',
  'the right motor': 'motor phải',
  'the ultrasonic sensor': 'cảm biến siêu âm',
  'the left line sensor': 'cảm biến line trái',
  'the center line sensor': 'cảm biến line giữa',
  'the right line sensor': 'cảm biến line phải',
  'servo 1': 'servo 1',
  'the LED': 'đèn',
  'the buzzer': 'còi',
  'the button': 'nút',
  'the left and the right motor': 'motor trái và motor phải',
};

/** N18 R2.2: what a clamped value is (constructs/uno.roles.ts `clampWarning`). */
const clampWords: Readonly<Record<string, string>> = { speed: 'Tốc độ', angle: 'Góc', frequency: 'Tần số', length: 'Độ dài', 'PWM value': 'Giá trị PWM' };

/** N18 R2.2: the raw pin ops (hardware/pin-rules.ts `RawPinOp`) by the robot's blocks. */
const rawPinOps: Readonly<Record<string, string>> = { 'digital.write': 'ghi số', 'pwm.write': 'ghi PWM', 'digital.read': 'đọc số', 'analogIn.read': 'đọc analog' };

/** N18 R2.2: what holds a timer (the board's `timerClaims`). */
const claimers: Readonly<Record<string, string>> = { servo: 'servo', tone: 'còi (tone)' };

const pinList = (pins: string) => pins.replace(/ and /g, ' và ');

/** N18 R2.2: why a raw pin cannot be used (hardware/pin-rules.ts `rawPinCheck`). */
function pinReason(why: string): string {
  const notOnBoard = /^it is not a pin of (.+)$/.exec(why);
  if (notOnBoard) {
    return `${notOnBoard[1] ?? ''} không có chân này`;
  }
  const serial = /^the program prints, and Serial holds (.+)$/.exec(why);
  if (serial) {
    return `chương trình có in, và Serial giữ ${pinList(serial[1] ?? '')}`;
  }
  const used = /^port (.+) of the kit uses it$/.exec(why);
  if (used) {
    return `cổng ${used[1] ?? ''} của bộ robot đang dùng chân này`;
  }
  if (why === 'no input module is wired to it, and a floating pin reads at random') {
    return 'không có mô-đun đầu vào nào nối với chân này, và chân thả nổi đọc ra giá trị ngẫu nhiên';
  }
  if (why === 'no module read as analog is wired to it') {
    return 'không có mô-đun analog nào nối với chân này';
  }
  return why;
}

const own = <Value>(table: Readonly<Record<string, Value>>, key: string): Value | undefined => (Object.hasOwn(table, key) ? table[key] : undefined);
const term = (label: string) => own(terms, label) ?? label;
const typeName = (english: string) => own(types, english) ?? english;

/** A block type as the learner knows it: the text of the block (placeholders dropped), or the type itself. */
export function blockName(type: string): string {
  const custom = own(viBlockText, type)?.message0;
  if (custom !== undefined) {
    const words = custom.replace(/%\d+/g, '').replace(/\s+/g, ' ').trim();
    if (words !== '') {
      return words;
    }
  }
  return own(builtinBlockNames, type) ?? type;
}

/** `"repeat"` → `"lặp lại"`, `"count up" start` → `số bắt đầu của "đếm lên"`, `"x" (a whole-number variable)` → … */
function subject(what: string): string {
  const known = own(quantities, what);
  if (known !== undefined) {
    return known;
  }
  const bound = /^"(.+)" (start|end)$/.exec(what);
  if (bound) {
    return `${bound[2] === 'start' ? 'Số bắt đầu' : 'Số kết thúc'} của "${term(bound[1] ?? '')}"`;
  }
  const variable = /^"(.+)" \(a whole-number variable\)$/.exec(what);
  if (variable) {
    return `"${variable[1]}" (biến số nguyên)`;
  }
  const quoted = /^"(.+)"$/.exec(what);
  return quoted ? `"${term(quoted[1] ?? '')}"` : what;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** `a generic project` → `dự án mạch thường`, `a ybc-basic project` → `dự án ybc-basic` (validity.ts `where`). */
function place(where: string): string {
  if (where === 'a generic project') {
    return 'dự án mạch thường';
  }
  const profile = /^a (.+) project$/.exec(where);
  return profile ? `dự án ${profile[1]}` : where;
}

/** The rules for the core's diagnostics and runtime errors, most specific first. Exported for its tests. */
export const coreMessageRules: readonly Rule[] = [
  // Program shape (both compilers)
  [/^The program is not a Blockly workspace\.$/, () => 'Chương trình không phải một vùng làm việc Blockly.'],
  [/^The program is nested too deeply\.$/, () => 'Chương trình lồng nhau quá sâu.'],
  [/^A block in the program is malformed\.$/, () => 'Một khối trong chương trình bị hỏng.'],
  [/^The "(.+)" input is malformed\.$/, (input) => `Ô "${input}" bị hỏng.`],
  [/^The else-if count or the else of "if" is malformed\.$/, () => 'Số nhánh "nếu không thì nếu" hoặc nhánh "nếu không thì" của khối "nếu" bị hỏng.'],
  [/^The number of parts of "join" is malformed\.$/, () => 'Số phần của khối "nối chữ" bị hỏng.'],
  [/^A program is limited to (.+) blocks\.$/, (count) => `Một chương trình có tối đa ${count} khối.`],
  [/^Blocks outside "on start" and "forever" do not run\.$/, () => 'Khối nằm ngoài "khi bắt đầu" và "lặp mãi mãi" sẽ không chạy.'],
  [/^Only one "(.+)" block is allowed\.$/, (type) => `Chỉ được có một khối "${blockName(type)}".`],
  [/^Unknown condition block "(.+)"\.$/, (type) => `Không biết khối điều kiện "${blockName(type)}".`],
  [/^Unknown block "(.+)"\.$/, (type) => `Không biết khối "${blockName(type)}".`],
  [/^"(.+)" is not available: it is excluded \((.+)\)\.$/, (type, row) => `Khối "${blockName(type)}" không dùng được: đã bị loại (${row}).`],
  [/^"(.+)" is not available here; use "(.+)"\.$/, (type, replacement) => `Khối "${blockName(type)}" không dùng ở đây; hãy dùng khối "${blockName(replacement)}".`],
  [/^"(.+)" is not supported by the compiler\.$/, (type) => `Trình dịch chưa hỗ trợ khối "${blockName(type)}".`],
  [/^"(.+)" cannot be used as a value\.$/, (type) => `Khối "${blockName(type)}" không dùng làm giá trị được.`],
  [/^"(.+)" cannot be used as a statement\.$/, (type) => `Khối "${blockName(type)}" không dùng làm câu lệnh được.`],
  [/^"(.+)" is not available in the (.+) profile\.$/, (type, profile) => `Khối "${blockName(type)}" không có ở cấp độ ${profile}.`],
  [/^"(.+)" is not available in a generic project\.$/, (type) => `Khối "${blockName(type)}" không có trong dự án mạch thường.`],
  // Inputs and conditions
  [/^"(.+)" needs a condition; the one it has is disabled\.$/, (label) => `Khối "${term(label)}" cần một điều kiện; điều kiện đang có bị vô hiệu hoá.`],
  [/^"(.+)" needs a condition\.$/, (label) => `Khối "${term(label)}" cần một điều kiện.`],
  [/^"(.+)" needs a value; the one it has is disabled\.$/, (label) => `Khối "${term(label)}" cần một giá trị; giá trị đang có bị vô hiệu hoá.`],
  [/^"(.+)" needs a value\.$/, (label) => `Khối "${term(label)}" cần một giá trị.`],
  [/^"(.+)" needs a true \/ false condition, not (.+)\.$/, (label, type) => `Khối "${term(label)}" cần một điều kiện đúng / sai, không phải ${typeName(type)}.`],
  [/^"(.+)" compares whole numbers, not (.+) and (.+)\.$/, (op, a, b) => `"${op}" so sánh hai số nguyên, không phải ${typeName(a)} và ${typeName(b)}.`],
  [/^"(.+)" compares two values of one type, not (.+) and (.+)\.$/, (op, a, b) => `"${op}" so sánh hai giá trị cùng loại, không phải ${typeName(a)} và ${typeName(b)}.`],
  // N18 R2.3: on the UNO a text is only printed.
  [/^"(.+)" compares numbers or true \/ false values here; a text can only be printed\.$/, (op) => `"${op}" ở đây chỉ so sánh số hoặc giá trị đúng / sai; đoạn chữ chỉ dùng để in.`],
  [/^(.+) needs (.+), not (.+)\.$/, (what, wanted, got) => `${capitalize(subject(what))} cần ${typeName(wanted)}, không phải ${typeName(got)}.`],
  [/^digital read needs a pin name\.$/, () => 'Khối "đọc chân số" cần tên chân.'],
  [/^digital write needs a pin name and a HIGH or LOW level\.$/, () => 'Khối "ghi chân số" cần tên chân và mức HIGH hoặc LOW.'],
  [/^wait needs a number of seconds\.$/, () => 'Khối "chờ" cần số giây.'],
  [/^A button block needs its button\.$/, () => 'Khối nút cần chọn nút.'],
  [/^A button is A or B\.$/, () => 'Nút là A hoặc B.'],
  [/^A button is A, B or A\+B\.$/, () => 'Nút là A, B hoặc A+B.'],
  [/^An acceleration block needs its axis\.$/, () => 'Khối gia tốc cần chọn trục.'],
  [/^An axis is x, y or z\.$/, () => 'Trục là x, y hoặc z.'],
  [/^A gesture block needs its gesture\.$/, () => 'Khối cử chỉ cần chọn cử chỉ.'],
  // N17 B3: the melodies and the tone.
  [/^A melody block needs its melody\.$/, () => 'Khối giai điệu cần chọn giai điệu.'],
  [/^A melody is one of the built-in melodies\.$/, () => 'Giai điệu là một trong các giai điệu có sẵn.'],
  [/^A melody block needs to say whether the program waits for it\.$/, () => 'Khối giai điệu cần chọn "chờ xong" hoặc "không chờ".'],
  [/^A melody plays until done or in the background\.$/, () => 'Giai điệu phát "chờ xong" hoặc "không chờ".'],
  [/^A gesture is one of shake, tilted left or right, face up or down, logo up or down\.$/, () => 'Cử chỉ là lắc, nghiêng trái hoặc phải, ngửa hoặc úp mặt, logo hướng lên hoặc xuống.'],
  [/^A note or rest needs its length\.$/, () => 'Khối nốt hoặc nghỉ cần độ dài.'],
  [/^A length is 1, 2 or 4 ticks\.$/, () => 'Độ dài là 1, 2 hoặc 4 nhịp.'],
  [/^A note block needs its note\.$/, () => 'Khối nốt cần chọn nốt.'],
  [/^A note is one of the natural notes from C3 to C5\.$/, () => 'Nốt là một nốt tự nhiên từ C3 tới C5.'],
  [/^A pin block needs its pin\.$/, () => 'Khối chân cần chọn chân.'],
  [/^A "set pin" block needs ON or OFF\.$/, () => 'Khối "đặt chân" cần BẬT hoặc TẮT.'],
  [/^A pin is set ON or OFF\.$/, () => 'Chân chỉ đặt được BẬT hoặc TẮT.'],
  [/^A true \/ false block needs its value\.$/, () => 'Khối đúng / sai cần giá trị.'],
  [/^A text block needs its text\.$/, () => 'Khối chữ cần nội dung.'],
  [/^A variable block needs its variable\.$/, () => 'Khối biến cần chọn biến.'],
  [/^A "set" block needs its variable\.$/, () => 'Khối "đặt" cần chọn biến.'],
  [/^"count up" needs its variable\.$/, () => 'Khối "đếm lên" cần chọn biến.'],
  [/^"count up" needs a whole-number step\.$/, () => 'Khối "đếm lên" cần bước là số nguyên.'],
  [/^"count up" cannot count down; use "repeat" and a variable\.$/, () => 'Khối "đếm lên" không đếm xuống được; dùng "lặp lại" và một biến.'],
  [/^"count up" counts by (.+) on this board\.$/, (step) => `Trên bo mạch này, khối "đếm lên" chỉ đếm với bước ${step}.`],
  [/^This variable does not exist\.$/, () => 'Biến này không tồn tại.'],
  [/^An arithmetic block needs its operation\.$/, () => 'Khối phép tính cần chọn phép tính.'],
  [/^A comparison needs its operator\.$/, () => 'Khối so sánh cần chọn phép so sánh.'],
  [/^A logic block needs "and" or "or"\.$/, () => 'Khối logic cần "và" hoặc "hoặc".'],
  [/^Every square of a picture is either lit or not\.$/, () => 'Mỗi ô của hình chỉ sáng hoặc tắt.'],
  // The RGB display (N17 B1): a colour that is not one is shown red, with a warning.
  [/^A picture block needs its picture\.$/, () => 'Khối hình có sẵn cần chọn hình.'],
  [/^A picture is one of the built-in pictures of the display\.$/, () => 'Hình phải là một hình có sẵn của màn hình.'],
  [/^A colour block needs its colour, so it is shown red\.$/, () => 'Khối màu chưa có màu, nên đèn sáng màu đỏ.'],
  [/^The colour "(.*)" is not one of the display's colours, so it is shown red\.$/, (colour) => `Màu "${colour}" không phải một màu của màn hình, nên đèn sáng màu đỏ.`],
  [/^"(.+)" is not a colour, so it is shown red\.$/, (type) => `Khối "${blockName(type)}" không phải một màu, nên đèn sáng màu đỏ.`],
  // Values and limits
  [/^Only \+, − and × are supported; use \/\/ for whole-number division\.$/, () => 'Chỉ có +, − và ×; dùng // để chia lấy phần nguyên.'],
  [/^This arithmetic block is not available here; use the \+ − × block of this profile\.$/, () => 'Khối phép tính này không dùng ở đây; dùng khối + − × của cấp độ này.'],
  [/^Only whole numbers are supported\.$/, () => 'Chỉ dùng được số nguyên.'],
  [/^A number must be between (.+) and (.+)\.$/, (low, high) => `Số phải nằm trong khoảng ${low} tới ${high}.`],
  [/^A text is limited to (.+) characters\.$/, (count) => `Một đoạn chữ có tối đa ${count} ký tự.`],
  [/^A text cannot contain control characters\.$/, () => 'Đoạn chữ không được chứa ký tự điều khiển.'],
  [/^"join" takes at most (.+) parts\.$/, (count) => `Khối "nối chữ" có tối đa ${count} phần.`],
  [/^The step must be between 1 and (.+)\.$/, (high) => `Bước phải nằm trong khoảng 1 tới ${high}.`],
  [/^The display shows only the characters from space to ~ \(ASCII\)\.$/, () => 'Màn hình chỉ hiện được ký tự từ dấu cách tới ~ (ASCII): chữ không dấu, chữ số và ký hiệu.'],
  // N17 B4: a random number.
  [/^The bounds of a random number must be at most (.+) apart, not (.+)\.$/, (span, value) => `Hai đầu của số ngẫu nhiên chỉ được cách nhau tối đa ${span}, không phải ${value}.`],
  [/^The bounds of a random number must be at most (.+) apart\.$/, (span) => `Hai đầu của số ngẫu nhiên chỉ được cách nhau tối đa ${span}.`],
  [/^(.+) must be between (.+) and (.+), not (.+)\.$/, (what, low, high, value) => `${capitalize(subject(what))} phải nằm trong khoảng ${low} tới ${high}, không phải ${value}.`],
  [/^(.+) must be between (.+) and (.+)\.$/, (what, low, high) => `${capitalize(subject(what))} phải nằm trong khoảng ${low} tới ${high}.`],
  [/^(.+) is outside the supported integer range \(±(.+)\)\.$/, (what, max) => `${capitalize(subject(what))} vượt quá khoảng số nguyên được hỗ trợ (±${max}).`],
  [/^Division by zero\.$/, () => 'Chia cho 0.'],
  // N18 R2.3: the UNO gives 0 for a division by zero, with a warning.
  [/^A division or a remainder by 0 gave 0, as on the board\.$/, () => 'Phép chia hoặc phép chia lấy dư cho 0 cho ra 0, như trên bo mạch.'],
  // The board, its pins and its parts
  [/^The board has no pin "(.+)"\.$/, (pin) => `Bo mạch không có chân "${pin}".`],
  [/^This board has no (.+) for "(.+)"\.$/, (capability, type) => `Bo mạch này không có ${own(capabilities, capability) ?? capability} cho khối "${blockName(type)}".`],
  [/^This board has no (.+), so this block cannot be used\.$/, (capability) => `Bo mạch này không có ${own(capabilities, capability) ?? capability}, nên không dùng được khối này.`],
  [/^Only the pins P0, P1 and P2 can be used\.$/, () => 'Chỉ dùng được các chân P0, P1 và P2.'],
  [/^Pin (.+) cannot be used on this board\.$/, (pin) => `Không dùng được chân ${pin} trên bo mạch này.`],
  [/^A pin must be P0, P1 or P2, not (.+)\.$/, (pin) => `Chân phải là P0, P1 hoặc P2, không phải ${pin}.`],
  [/^A pin is set to 0 \(off\) or 1 \(on\), not (.+)\.$/, (level) => `Chân chỉ đặt được 0 (tắt) hoặc 1 (bật), không phải ${level}.`],
  [/^An analog reading is between 0 and (.+), not (.+)\.$/, (max, raw) => `Giá trị đọc tương tự nằm trong khoảng 0 tới ${max}, không phải ${raw}.`],
  [/^Pin (.+) is set by this program, so it cannot be read as well\.$/, (pin) => `Chân ${pin} đang được chương trình này đặt, nên không đọc được nữa.`],
  [/^Pin (.+) is not connected to anything, so it cannot be read\.$/, (pin) => `Chân ${pin} chưa nối với gì, nên không đọc được.`],
  // N17 B4: an on/off read of a pin nothing drives reads 0, and says so once.
  [/^Pin (.+) is floating, so it reads 0\. Connect the button to 3V3 or GND\.$/, (pin) => `Chân ${pin} đang thả nổi — đọc là 0. Hãy nối nút với 3V3 hoặc GND.`],
  // N17 B5: an analog write or a servo angle outside its range is clamped, and the run says so once per pin.
  [/^The analog value (.+) for (.+) is outside 0 to (.+), so it is clamped to (.+)\.$/, (value, pin, max, clamped) => `Giá trị analog ${value} của chân ${pin} nằm ngoài khoảng 0 tới ${max}, nên được kẹp về ${clamped}.`],
  [/^The servo angle (.+) for (.+) is outside 0 to (.+), so it is clamped to (.+)\.$/, (value, pin, max, clamped) => `Góc servo ${value} của chân ${pin} nằm ngoài khoảng 0 tới ${max}, nên được kẹp về ${clamped}.`],
  [/^An analog value is between 0 and (.+), not (.+)\.$/, (max, value) => `Giá trị analog nằm trong khoảng 0 tới ${max}, không phải ${value}.`],
  [/^A servo angle is between 0 and (.+), not (.+)\.$/, (max, value) => `Góc servo nằm trong khoảng 0 tới ${max}, không phải ${value}.`],
  // N18 R2.2: a robot's value outside its range is clamped, and the run says so once per module (a raw pin: per pin).
  [
    /^The (.+?) (\S+) for (.+) is outside (\S+) to (\S+), so it is clamped to (\S+)\.$/,
    (word, value, who, low, high, clamped) =>
      `${own(clampWords, word) ?? word} ${value} của ${own(robotRoles, who) ?? who} nằm ngoài khoảng ${low} tới ${high}, nên được kẹp về ${clamped}.`,
  ],
  [/^Pin (.+) is driven by two things at once, so it cannot be read\.$/, (pin) => `Chân ${pin} bị hai thứ cùng điều khiển, nên không đọc được.`],
  [/^Pin (.+) carries an analog level, which is neither on nor off\. Use "analog read"\.$/, (pin) => `Chân ${pin} mang mức tương tự, không phải bật hay tắt. Dùng "đọc tương tự".`],
  [/^Pin (.+) could not be read\.$/, (pin) => `Không đọc được chân ${pin}.`],
  // N18 R2.2: the robot's blocks against the kit, and the kit's pin rules (contract UNO §9, §13).
  [/^"(.+)" needs (.+), which the kit (.+) does not have\.$/, (type, role, kit) => `Khối "${blockName(type)}" cần ${own(robotRoles, role) ?? role}, mà bộ robot ${kit} không có.`],
  [/^The kit (.+) has (.+), but not for "(.+)"\.$/, (kit, role, type) => `Bộ robot ${kit} có ${own(robotRoles, role) ?? role}, nhưng không dùng được cho khối "${blockName(type)}".`],
  [/^"(.+)" needs the robot's kit, to know which pins are free\.$/, (type) => `Khối "${blockName(type)}" cần biết bộ robot để biết chân nào còn trống.`],
  [/^A robot block needs its module\.$/, () => 'Khối robot cần chọn mô-đun.'],
  [/^"(.+)" is not one of the modules this block offers\.$/, (role) => `Khối này không có mô-đun "${role}".`],
  [/^A drive block needs its direction\.$/, () => 'Khối robot đi cần chọn hướng.'],
  [/^A direction is forward, backward, spin left or spin right\.$/, () => 'Hướng là tới, lùi, xoay trái hoặc xoay phải.'],
  [/^An LED block needs on or off\.$/, () => 'Khối đèn cần chọn bật hoặc tắt.'],
  [/^An LED is on or off\.$/, () => 'Đèn chỉ bật hoặc tắt.'],
  [/^A digital write needs HIGH or LOW\.$/, () => 'Khối ghi số cần mức HIGH hoặc LOW.'],
  [/^A pin is written HIGH or LOW\.$/, () => 'Chân chỉ ghi được mức HIGH hoặc LOW.'],
  [/^(.+) cannot use (.+): (.+)\.$/, (op, pin, why) => `Khối ${own(rawPinOps, op) ?? op} không dùng được chân ${pin}: ${pinReason(why)}.`],
  [/^(.+) has no PWM: pwm\.write drives it HIGH from 128 up and LOW below\.$/, (pin) => `Chân ${pin} không có PWM: ghi PWM từ 128 trở lên là HIGH, dưới 128 là LOW.`],
  [
    /^PWM on (.+) is not possible: the (.+) holds timer (.+) there, so the pin would stay LOW \(contract U-48\)\.$/,
    (pin, claimer, timer) => `Không ghi PWM được ở chân ${pin}: ${own(claimers, claimer) ?? claimer} đang giữ timer ${timer} ở đó, nên chân sẽ luôn ở mức LOW (contract U-48).`,
  ],
  [
    /^Port (.+) needs PWM on (.+), but the (.+) holds timer (.+) there: the pin would stay LOW \(contract U-48\)\.$/,
    (port, pin, claimer, timer) => `Cổng ${port} cần PWM ở chân ${pin}, nhưng ${own(claimers, claimer) ?? claimer} đang giữ timer ${timer} ở đó: chân sẽ luôn ở mức LOW (contract U-48).`,
  ],
  [/^Port (.+) uses (.+), but the program prints: Serial holds (.+)\.$/, (port, pin, pins) => `Cổng ${port} dùng chân ${pin}, nhưng chương trình có in: Serial giữ ${pinList(pins)}.`],
  [/^Pin (.+) is wired to more than one port: (.+)\.$/, (pin, ports) => `Chân ${pin} được nối với nhiều hơn một cổng: ${ports}.`],
  [/^The robot kit "(.+)" is not one this app knows\.$/, (kit) => `Ứng dụng này chưa có bộ robot "${kit}".`],
  [/^The circuit needs a board\.$/, () => 'Mạch cần có một bo mạch.'],
  [/^The circuit can have only one board\.$/, () => 'Mạch chỉ được có một bo mạch.'],
  [/^(.+) cannot be used in (.+)\.$/, (ids, where) => `Không dùng được ${ids} trong ${place(where)}.`],
  [/^The board could not be set up\.$/, () => 'Không khởi động được bo mạch.'],
  // Faults that only a broken program or a bug can cause: said plainly, the details kept.
  [/^The board is missing a part this block needs\.$/, () => 'Bo mạch thiếu bộ phận mà khối này cần.'],
  [/^The program asks for a number model or a loop pause that does not exist\.$/, () => 'Chương trình đòi một kiểu số hoặc một khoảng nghỉ của vòng lặp không tồn tại.'],
  [/^The board does not have the capability this block needs\.$/, () => 'Bo mạch không có khả năng mà khối này cần.'],
  [/^A button block names a button that does not exist\.$/, () => 'Khối nút gọi một nút không tồn tại.'],
  [/^The board cannot count presses\.$/, () => 'Bo mạch không đếm được số lần nhấn.'],
  [/^The press count is not a whole number\.$/, () => 'Số lần nhấn không phải số nguyên.'],
  [/^The light level is not a whole number from 0 to 100\.$/, () => 'Mức ánh sáng không phải số nguyên từ 0 tới 100.'],
  [/^The temperature is not a whole number from (.+) to (.+)\.$/, (low, high) => `Nhiệt độ không phải số nguyên từ ${low} tới ${high}.`],
  [/^An acceleration block names an axis that does not exist\.$/, () => 'Khối gia tốc gọi một trục không tồn tại.'],
  [/^The acceleration is not a whole number from (.+) to (.+)\.$/, (low, high) => `Gia tốc không phải số nguyên từ ${low} tới ${high}.`],
  // N18 R2.2: what the robot's board answered is outside the contract's domain (a broken capability).
  [/^(.+) is not a whole number from (.+) to (.+)\.$/, (what, low, high) => `${capitalize(subject(what))} không phải số nguyên từ ${low} tới ${high}.`],
  [/^A sensor gave no true \/ false value\.$/, () => 'Cảm biến không trả về giá trị đúng / sai.'],
  [/^The time since the start is not a whole number of ms\.$/, () => 'Thời gian từ lúc bắt đầu không phải một số nguyên mili giây.'],
  [/^A robot block names a module that does not exist\.$/, () => 'Khối robot gọi một mô-đun không tồn tại.'],
  [/^A robot block was given the wrong number of values\.$/, () => 'Khối robot nhận sai số giá trị.'],
  [/^A drive block names a direction that does not exist\.$/, () => 'Khối robot đi gọi một hướng không tồn tại.'],
  [/^A pin block names a pin that does not exist\.$/, () => 'Khối chân gọi một chân không tồn tại.'],
  [/^A read of the robot came without its wait for the world\.$/, () => 'Một lần đọc của robot không chờ thế giới mô phỏng theo kịp.'],
  [/^A gesture block names a gesture that does not exist\.$/, () => 'Khối cử chỉ gọi một cử chỉ không tồn tại.'],
  [/^A melody block names a melody that does not exist\.$/, () => 'Khối giai điệu gọi một giai điệu không tồn tại.'],
  [/^A tone block was given the wrong number of values\.$/, () => 'Khối âm nhận sai số giá trị.'],
  [/^A random block was given the wrong number of values\.$/, () => 'Khối số ngẫu nhiên nhận sai số giá trị.'],
  [/^The random number is not between its bounds\.$/, () => 'Số ngẫu nhiên không nằm giữa hai đầu của nó.'],
  [/^The board cannot tell its gesture\.$/, () => 'Bo mạch không cho biết cử chỉ của nó.'],
  [/^A variable has no value\.$/, () => 'Một biến chưa có giá trị.'],
  [/^A read gave another type than its block says\.$/, () => 'Một lần đọc trả về loại khác với khối của nó.'],
  [/^A note or rest has a length that does not exist\.$/, () => 'Khối nốt hoặc nghỉ có độ dài không tồn tại.'],
  [/^A text block was given another type\.$/, () => 'Khối chữ nhận một loại khác.'],
  [/^A number block was given another type\.$/, () => 'Khối số nhận một loại khác.'],
  [/^A note block names a note that does not exist\.$/, () => 'Khối nốt gọi một nốt không tồn tại.'],
  [/^A picture block names a picture that does not exist\.$/, () => 'Khối hình gọi một hình không tồn tại.'],
  [/^A light block was given the wrong number of values\.$/, () => 'Khối đèn nhận sai số giá trị.'],
  [/^This block is not known to the board\.$/, () => 'Bo mạch không biết khối này.'],
  [/^An int variable was given another type\.$/, () => 'Biến số nguyên nhận một loại khác.'],
  [/^A pin block was given the wrong number of values\.$/, () => 'Khối chân nhận sai số giá trị.'],
  [/^Expected an int, got (.+)\.$/, (type) => `Cần một số nguyên, nhận được ${type}.`],
  [/^Expected a bool, got (.+)\.$/, (type) => `Cần một giá trị đúng / sai, nhận được ${type}.`],
  [/^Cannot compare (.+) with (.+)\.$/, (a, b) => `Không so sánh được ${a} với ${b}.`],
  [/^Unexpected runtime error\.$/, () => 'Lỗi không mong đợi khi chạy.'],
];

/** A board profile by the name of its level, as the LMS shows it: Cơ bản (Basic), Nâng cao (Advanced); the robot's two levels too (N18 R4.1). */
const levelName = (profile: string): string =>
  profile === 'ybc-basic' || profile === 'uno-basic' ? 'Cơ bản' : profile === 'ybc-advanced' || profile === 'uno-advanced' ? 'Nâng cao' : profile;

/** The rules for the launch parser's problems (src/ui/app/launch.ts), most specific first. Exported for its tests. */
export const launchProblemRules: readonly Rule[] = [
  [/^A template opens only in an embedded lab: add embed=1\.$/, () => 'Mẫu bài chỉ mở trong lab nhúng: thêm embed=1.'],
  [/^embed must be given once, as embed=1\.$/, () => 'Tham số embed phải có đúng một lần, dạng embed=1.'],
  [/^lab must be given once\.$/, () => 'Tham số lab chỉ được có một lần.'],
  [/^Unknown lab "(.*)": use lab=blockly, lab=yolobit or lab=robot\.$/, (lab) => `Không có lab "${lab}": dùng lab=blockly, lab=yolobit hoặc lab=robot.`],
  [/^No template was given: add template=<key>\.$/, () => 'Chưa có mẫu bài: thêm template=<key>.'],
  [/^template must be given once\.$/, () => 'Tham số template chỉ được có một lần.'],
  [/^Unknown template "(.*)"\.$/, (key) => `Không có mẫu bài "${key}".`],
  [/^The template "(.*)" does not open in lab=(.+)\.$/, (key, lab) => `Mẫu bài "${key}" không mở trong lab=${lab}.`],
  [/^The template "(.*)" opens only in lab=robot: add lab=robot\.$/, (key) => `Mẫu bài "${key}" chỉ mở trong lab=robot: thêm lab=robot.`],
  [/^profile must be given once\.$/, () => 'Tham số profile chỉ được có một lần.'],
  [/^profile is only for lab=yolobit or lab=robot\.$/, () => 'Tham số profile chỉ dùng với lab=yolobit hoặc lab=robot.'],
  [/^Unknown profile "(.*)": use (.+) or (.+)\.$/, (profile, a, b) => `Không có cấp độ "${profile}": dùng ${a} hoặc ${b}.`],
  // N17 B6: the levels by the names the LMS shows them by.
  [
    /^The template "(.*)" needs profile=(.+): it uses blocks or parts that (.+) does not have\.$/,
    (key, needed, given) => `Mẫu bài "${key}" cần mức ${levelName(needed)} (profile=${needed}): bài dùng khối hoặc linh kiện mà mức ${levelName(given)} không có.`,
  ],
  [/^origin must be given once\.$/, () => 'Tham số origin chỉ được có một lần.'],
  [/^origin "(.*)" is not a page origin such as (.+)\.$/, (origin, example) => `origin "${origin}" không phải origin của một trang, ví dụ ${example}.`],
];

/** The index of the first rule that matches `message`, or -1. Exported for its tests. */
export function matchingRule(rules: readonly Rule[], message: string): number {
  return rules.findIndex(([pattern]) => pattern.test(message));
}

function translate(rules: readonly Rule[], message: string, locale: Locale): string {
  if (locale === 'en') {
    return message;
  }
  for (const [pattern, say] of rules) {
    const match = pattern.exec(message);
    if (match) {
      return say(...match.slice(1).map((part) => part ?? ''));
    }
  }
  return message;
}

/** A diagnostic or runtime error of the core in `locale`; English, or a sentence no rule knows, as it is. */
export const localizeCoreMessage = (message: string, locale: Locale): string => translate(coreMessageRules, message, locale);

/** A broken launch's problem (launch.ts) in `locale`; English, or a sentence no rule knows, as it is. */
export const localizeLaunchProblem = (problem: string, locale: Locale): string => translate(launchProblemRules, problem, locale);
