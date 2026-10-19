import { ANALOG_MAX } from '../../core/constructs/ybc.pins';
import type { Toolbox, ToolboxCategory } from '../../core/program/block-packs';
import type { BlockDefinitionJson } from '../../core/program/blocks';
import type { Locale } from './messages';

// The Vietnamese text of the custom blocks and of the toolbox (N6a S5). The core declares its blocks in English
// (it has no locale, B1: it must not import the UI); the UI overlays this text, by block type, before Blockly
// registers them. Only `message0`, `tooltip` and the shown labels of the dropdown options named in `options`
// (N17 B1: the colours and the built-in pictures) change: the `%n` placeholders are the same as the core's
// (blocks.test.ts), and an option keeps its value, so every field and input stays where the core put it and a
// saved program reads the same in both languages. Blockly's own blocks (if, compare, numbers, variables…) get
// their Vietnamese from `blockly/msg/vi` (src/ui/blockly/locale.ts).

/** `options`: for a dropdown field (by name), the label shown for each option value. */
type BlockText = { message0: string; tooltip: string; options?: Readonly<Record<string, Readonly<Record<string, string>>>> };

/** The palette (constructs/ybc.display.ts `paletteColours`) by value: the names a Vietnamese learner reads. */
export const viColourNames: Readonly<Record<string, string>> = {
  '#ff0000': 'đỏ',
  '#ffa500': 'cam',
  '#ffff00': 'vàng',
  '#00ff00': 'lục',
  '#0000ff': 'lam',
  '#4b0082': 'chàm',
  '#800080': 'tím',
  '#ffffff': 'trắng',
};

/** The gestures of the gesture block (constructs/ybc.input.ts `gestureNames`) by value (N17 B2). */
export const viGestureNames: Readonly<Record<string, string>> = {
  shake: 'lắc',
  tilt_left: 'nghiêng trái',
  tilt_right: 'nghiêng phải',
  face_up: 'ngửa mặt',
  face_down: 'úp mặt',
  logo_up: 'logo hướng lên',
  logo_down: 'logo hướng xuống',
};

/** The built-in pictures (constructs/ybc.images.ts) by name. */
export const viPictureNames: Readonly<Record<string, string>> = {
  HEART: 'trái tim',
  HEART_SMALL: 'trái tim nhỏ',
  HAPPY: 'vui',
  SAD: 'buồn',
  CONFUSED: 'bối rối',
  ANGRY: 'giận',
  SURPRISED: 'ngạc nhiên',
  YES: 'đúng',
  NO: 'sai',
  ARROW_N: 'mũi tên lên',
  ARROW_E: 'mũi tên phải',
  ARROW_S: 'mũi tên xuống',
  ARROW_W: 'mũi tên trái',
};

export const viBlockText: Readonly<Record<string, BlockText>> = {
  stem_on_start: { message0: 'khi bắt đầu %1 %2', tooltip: 'Chạy một lần khi chương trình bắt đầu.' },
  stem_forever: { message0: 'lặp mãi mãi %1 %2', tooltip: 'Lặp lại cho tới khi chương trình dừng.' },
  stem_digital_write: { message0: 'ghi chân số %1 mức %2', tooltip: 'Đặt một chân số ở mức HIGH hoặc LOW.' },
  stem_digital_read: { message0: 'đọc chân số %1', tooltip: 'Đúng khi chân đang ở mức HIGH.' },
  stem_wait: { message0: 'chờ %1 giây', tooltip: 'Tạm dừng chương trình.' },
  ybc_display_show_image: {
    message0: 'hiển thị hình %1',
    tooltip: 'Hiện hình bạn vẽ trên màn hình 5×5. Ô được đánh dấu sáng bằng màu bạn chọn; hình mới thay toàn bộ màn hình.',
    options: { COLOUR: viColourNames },
  },
  ybc_display_scroll_text: {
    message0: 'chạy chữ %1 màu %2',
    tooltip: 'Cho chữ chạy qua màn hình bằng một màu (đỏ nếu không chọn). Chỉ chữ cái không dấu, chữ số và ký hiệu từ dấu cách tới ~. Chương trình chờ tới khi chữ chạy hết.',
  },
  ybc_display_scroll_number: {
    message0: 'chạy số %1 màu %2',
    tooltip: 'Cho một số nguyên chạy qua màn hình bằng một màu (đỏ nếu không chọn). Một chữ số thì đứng yên; chương trình chờ tới khi số chạy hết.',
  },
  ybc_display_clear: { message0: 'xoá màn hình', tooltip: 'Tắt mọi đèn của màn hình.' },
  ybc_display_show_icon: { message0: 'hiển thị hình có sẵn %1', tooltip: 'Hiện một hình có sẵn bằng màu đỏ; hình mới thay toàn bộ màn hình.', options: { ICON: viPictureNames } },
  ybc_display_set_pixel: {
    message0: 'bật đèn tại cột %1 hàng %2 màu %3',
    tooltip: 'Bật một đèn bằng một màu. Cột và hàng đánh số từ 0 tới 4, bắt đầu ở góc trên bên trái.',
  },
  ybc_display_clear_pixel: { message0: 'tắt đèn tại cột %1 hàng %2', tooltip: 'Tắt một đèn. Cột và hàng đánh số từ 0 tới 4, bắt đầu ở góc trên bên trái.' },
  ybc_display_set_all: { message0: 'bật tất cả đèn màu %1', tooltip: 'Bật cả 25 đèn bằng một màu.' },
  ybc_colour: { message0: '%1', tooltip: 'Một màu của màn hình: một trong tám màu của bảng màu.', options: { COLOUR: viColourNames } },
  ybc_button_pressed: { message0: 'nút %1 đang được nhấn', tooltip: 'Đúng khi nút đang được giữ ở thời điểm này.' },
  ybc_button_presses: { message0: 'số lần nhấn nút %1', tooltip: 'Số lần nút được nhấn kể từ lần đọc trước (bởi bất kỳ khối nào); đọc xong thì đếm lại từ 0.' },
  ybc_light_level: { message0: 'mức ánh sáng', tooltip: 'Độ sáng, một số nguyên từ 0 (tối nhất) tới 100 (sáng nhất).' },
  ybc_temperature: { message0: 'nhiệt độ (°C)', tooltip: 'Nhiệt độ theo độ C, một số nguyên.' },
  ybc_accel: {
    message0: 'gia tốc %1 (mg)',
    tooltip: 'Gia tốc theo một trục, đơn vị mg (1024 mg là sức hút của Trái Đất). Nằm phẳng, ngửa mặt: x 0, y 0, z −1024.',
  },
  ybc_gesture_is: {
    message0: 'cử chỉ là %1',
    tooltip: 'Đúng khi bo mạch đang có cử chỉ này: bị lắc (trong 1 giây sau khi lắc), nghiêng trái hoặc phải, ngửa hoặc úp mặt, logo hướng lên hoặc xuống.',
    options: { GESTURE: viGestureNames },
  },
  ybc_sound_note: { message0: 'phát nốt %1 trong %2 nhịp', tooltip: 'Phát một nốt rồi chờ nốt kết thúc. Một nhịp dài 125 mili giây.' },
  ybc_sound_rest: { message0: 'nghỉ %1 nhịp', tooltip: 'Im lặng và chờ. Một nhịp dài 125 mili giây.' },
  ybc_pin_write: { message0: 'đặt chân %1 thành %2', tooltip: 'Bật hoặc tắt một chân.' },
  ybc_pin_read: { message0: 'đọc số chân %1', tooltip: 'Đúng khi chân đang bật.' },
  ybc_pin_analog: { message0: 'đọc tương tự chân %1', tooltip: `Đọc giá trị tương tự của một chân: từ 0 tới ${ANALOG_MAX}.` },
  ybc_arith: { message0: '%1 %2 %3', tooltip: 'Cộng, trừ hoặc nhân hai số nguyên.' },
  ybc_int_divide: { message0: '%1 // %2', tooltip: 'Chia lấy phần nguyên, làm tròn xuống (như // của Python).' },
  ybc_while: { message0: 'lặp khi %1 %2', tooltip: 'Lặp lại khi điều kiện còn đúng.' },
  ybc_count_up: { message0: 'đếm lên với %1 từ %2 tới %3 bước %4 %5', tooltip: 'Đếm từ số thứ nhất lên số thứ hai, theo bước.' },
  ybc_wait_ms: { message0: 'chờ %1 ms', tooltip: 'Tạm dừng chương trình trong một số mili giây.' },
};

/** The toolbox categories, by the core's English name. */
export const viCategoryNames: Readonly<Record<string, string>> = {
  Events: 'Sự kiện',
  Program: 'Chương trình',
  Pins: 'Chân',
  Logic: 'Logic',
  Loops: 'Vòng lặp',
  Time: 'Thời gian',
  Math: 'Toán',
  Text: 'Chữ',
  Variables: 'Biến',
  Display: 'Màn hình',
  Input: 'Đầu vào',
  Sound: 'Âm thanh',
};

/** `args` with the shown label of each option of the dropdowns `options` names replaced; the values, and everything else, kept. */
function localizeArgs(args: unknown, options: NonNullable<BlockText['options']>): unknown {
  if (!Array.isArray(args)) {
    return args;
  }
  return args.map((arg: unknown) => {
    const field = arg as { type?: unknown; name?: unknown; options?: unknown };
    const labels = typeof field.name === 'string' && Object.hasOwn(options, field.name) ? options[field.name] : undefined;
    if (field.type !== 'field_dropdown' || labels === undefined || !Array.isArray(field.options)) {
      return arg;
    }
    const localized = field.options.map((option: unknown) => {
      const [label, value] = option as [unknown, unknown];
      return typeof value === 'string' && Object.hasOwn(labels, value) ? [labels[value], value] : [label, value];
    });
    return { ...field, options: localized };
  });
}

/** The definitions in `locale`: new objects, the core's left as they are. */
export function localizeBlockDefinitions(definitions: readonly BlockDefinitionJson[], locale: Locale): BlockDefinitionJson[] {
  if (locale === 'en') {
    return [...definitions];
  }
  return definitions.map((definition) => {
    const text = Object.hasOwn(viBlockText, definition.type) ? viBlockText[definition.type] : undefined;
    if (!text) {
      return definition;
    }
    const localized: BlockDefinitionJson = { ...definition, message0: text.message0, tooltip: text.tooltip };
    if (text.options) {
      for (const key of Object.keys(definition).filter((name) => /^args\d+$/.test(name))) {
        localized[key] = localizeArgs(definition[key], text.options);
      }
    }
    return localized;
  });
}

/** The toolbox in `locale`: only category names change. */
export function localizeToolbox(toolbox: Toolbox, locale: Locale): Toolbox {
  if (locale === 'en') {
    return toolbox;
  }
  const localize = (category: ToolboxCategory): ToolboxCategory =>
    category.name !== undefined && Object.hasOwn(viCategoryNames, category.name) ? { ...category, name: viCategoryNames[category.name] } : category;
  return { ...toolbox, contents: toolbox.contents.map(localize) };
}
