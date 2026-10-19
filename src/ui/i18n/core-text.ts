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
};

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
  [/^Pin (.+) is driven by two things at once, so it cannot be read\.$/, (pin) => `Chân ${pin} bị hai thứ cùng điều khiển, nên không đọc được.`],
  [/^Pin (.+) carries an analog level, which is neither on nor off\. Use "analog read"\.$/, (pin) => `Chân ${pin} mang mức tương tự, không phải bật hay tắt. Dùng "đọc tương tự".`],
  [/^Pin (.+) could not be read\.$/, (pin) => `Không đọc được chân ${pin}.`],
  [/^The circuit needs a board\.$/, () => 'Mạch cần có một bo mạch.'],
  [/^The circuit can have only one board\.$/, () => 'Mạch chỉ được có một bo mạch.'],
  [/^(.+) cannot be used in (.+)\.$/, (ids, where) => `Không dùng được ${ids} trong ${place(where)}.`],
  [/^The board could not be set up\.$/, () => 'Không khởi động được bo mạch.'],
  // Faults that only a broken program or a bug can cause: said plainly, the details kept.
  [/^The board is missing a part this block needs\.$/, () => 'Bo mạch thiếu bộ phận mà khối này cần.'],
  [/^The board does not have the capability this block needs\.$/, () => 'Bo mạch không có khả năng mà khối này cần.'],
  [/^A button block names a button that does not exist\.$/, () => 'Khối nút gọi một nút không tồn tại.'],
  [/^The board cannot count presses\.$/, () => 'Bo mạch không đếm được số lần nhấn.'],
  [/^The press count is not a whole number\.$/, () => 'Số lần nhấn không phải số nguyên.'],
  [/^The light level is not a whole number from 0 to 100\.$/, () => 'Mức ánh sáng không phải số nguyên từ 0 tới 100.'],
  [/^The temperature is not a whole number from (.+) to (.+)\.$/, (low, high) => `Nhiệt độ không phải số nguyên từ ${low} tới ${high}.`],
  [/^An acceleration block names an axis that does not exist\.$/, () => 'Khối gia tốc gọi một trục không tồn tại.'],
  [/^The acceleration is not a whole number from (.+) to (.+)\.$/, (low, high) => `Gia tốc không phải số nguyên từ ${low} tới ${high}.`],
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

/** The rules for the launch parser's problems (src/ui/app/launch.ts), most specific first. Exported for its tests. */
export const launchProblemRules: readonly Rule[] = [
  [/^A template opens only in an embedded lab: add embed=1\.$/, () => 'Mẫu bài chỉ mở trong lab nhúng: thêm embed=1.'],
  [/^embed must be given once, as embed=1\.$/, () => 'Tham số embed phải có đúng một lần, dạng embed=1.'],
  [/^lab must be given once\.$/, () => 'Tham số lab chỉ được có một lần.'],
  [/^Unknown lab "(.*)": use lab=blockly or lab=yolobit\.$/, (lab) => `Không có lab "${lab}": dùng lab=blockly hoặc lab=yolobit.`],
  [/^No template was given: add template=<key>\.$/, () => 'Chưa có mẫu bài: thêm template=<key>.'],
  [/^template must be given once\.$/, () => 'Tham số template chỉ được có một lần.'],
  [/^Unknown template "(.*)"\.$/, (key) => `Không có mẫu bài "${key}".`],
  [/^The template "(.*)" does not open in lab=(.+)\.$/, (key, lab) => `Mẫu bài "${key}" không mở trong lab=${lab}.`],
  [/^profile must be given once\.$/, () => 'Tham số profile chỉ được có một lần.'],
  [/^profile is only for lab=yolobit\.$/, () => 'Tham số profile chỉ dùng với lab=yolobit.'],
  [/^Unknown profile "(.*)": use (.+) or (.+)\.$/, (profile, a, b) => `Không có cấp độ "${profile}": dùng ${a} hoặc ${b}.`],
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
