import * as Blockly from 'blockly';
import { describe, expect, it } from 'vitest';
import { applyEditorLocale } from './locale';

// N18 R4.2 (the R2.4 carry): a collapsed block that holds a block with a warning (a diagnostic of the robot's run) shows Blockly's own
// warning text, and its context menu folds and unfolds blocks. blockly/msg/vi says them as "bị sập" (crashed) and "Mảnh" (a piece); the
// editor says them the way the rest of the lab does.

describe('applyEditorLocale: the collapse texts (N18 R4.2)', () => {
  it('says the warning of a collapsed block and the fold menu in the lab’s words', () => {
    applyEditorLocale('vi');
    expect(Blockly.Msg['COLLAPSED_WARNINGS_WARNING']).toBe('Trong khối đang thu gọn có khối bị cảnh báo.');
    expect(Blockly.Msg['COLLAPSE_BLOCK']).toBe('Thu gọn khối');
    expect(Blockly.Msg['COLLAPSE_ALL']).toBe('Thu gọn mọi khối');
    expect(Blockly.Msg['EXPAND_BLOCK']).toBe('Mở rộng khối');
    expect(Blockly.Msg['EXPAND_ALL']).toBe('Mở rộng mọi khối');
  });
});
