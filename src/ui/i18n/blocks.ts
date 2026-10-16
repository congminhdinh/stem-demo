import { ANALOG_MAX } from '../../core/constructs/ybc.pins';
import type { Toolbox, ToolboxCategory } from '../../core/program/block-packs';
import type { BlockDefinitionJson } from '../../core/program/blocks';
import type { Locale } from './messages';

// The Vietnamese text of the custom blocks and of the toolbox (N6a S5). The core declares its blocks in English
// (it has no locale, B1: it must not import the UI); the UI overlays this text, by block type, before Blockly
// registers them. Only `message0` and `tooltip` change: the `%n` placeholders are the same as the core's
// (blocks.test.ts), so every field and input stays where the core put it. Blockly's own blocks (if, compare,
// numbers, variables…) get their Vietnamese from `blockly/msg/vi` (src/ui/blockly/locale.ts).

type BlockText = { message0: string; tooltip: string };

export const viBlockText: Readonly<Record<string, BlockText>> = {
  stem_on_start: { message0: 'khi bắt đầu %1 %2', tooltip: 'Chạy một lần khi chương trình bắt đầu.' },
  stem_forever: { message0: 'lặp mãi mãi %1 %2', tooltip: 'Lặp lại cho tới khi chương trình dừng.' },
  stem_digital_write: { message0: 'ghi chân số %1 mức %2', tooltip: 'Đặt một chân số ở mức HIGH hoặc LOW.' },
  stem_digital_read: { message0: 'đọc chân số %1', tooltip: 'Đúng khi chân đang ở mức HIGH.' },
  stem_wait: { message0: 'chờ %1 giây', tooltip: 'Tạm dừng chương trình.' },
  ybc_display_show_image: { message0: 'hiển thị hình', tooltip: 'Hiện hình bạn vẽ trên màn hình 5×5. Ô được đánh dấu là một đèn đỏ sáng; hình mới thay toàn bộ màn hình.' },
  ybc_display_scroll_text: { message0: 'chạy chữ %1', tooltip: 'Cho chữ chạy qua màn hình. Chỉ chữ cái không dấu, chữ số và ký hiệu từ dấu cách tới ~. Chương trình chờ tới khi chữ chạy hết.' },
  ybc_display_scroll_number: { message0: 'chạy số %1', tooltip: 'Cho một số nguyên chạy qua màn hình. Một chữ số thì đứng yên; chương trình chờ tới khi số chạy hết.' },
  ybc_display_clear: { message0: 'xoá màn hình', tooltip: 'Tắt mọi đèn của màn hình.' },
  ybc_button_pressed: { message0: 'nút %1 đang được nhấn', tooltip: 'Đúng khi nút đang được giữ ở thời điểm này.' },
  ybc_button_presses: { message0: 'số lần nhấn nút %1', tooltip: 'Số lần nút được nhấn kể từ lần đọc trước (bởi bất kỳ khối nào); đọc xong thì đếm lại từ 0.' },
  ybc_light_level: { message0: 'mức ánh sáng', tooltip: 'Độ sáng, một số nguyên từ 0 (tối nhất) tới 100 (sáng nhất).' },
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

/** The definitions in `locale`: new objects, the core's left as they are. */
export function localizeBlockDefinitions(definitions: readonly BlockDefinitionJson[], locale: Locale): BlockDefinitionJson[] {
  if (locale === 'en') {
    return [...definitions];
  }
  return definitions.map((definition) => {
    const text = Object.hasOwn(viBlockText, definition.type) ? viBlockText[definition.type] : undefined;
    return text ? { ...definition, message0: text.message0, tooltip: text.tooltip } : definition;
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
