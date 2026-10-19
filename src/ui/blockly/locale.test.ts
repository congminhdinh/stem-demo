import * as Blockly from 'blockly';
import { describe, expect, it } from 'vitest';
import { applyEditorLocale } from './locale';

describe('applyEditorLocale', () => {
  it('reads "in lên màn hình" on the print block in Vietnamese, not the "màng hình" of blockly/msg/vi (Fix 6, N17 c3)', () => {
    applyEditorLocale('vi');
    expect(Blockly.Msg['TEXT_PRINT_TITLE']).toBe('in lên màn hình %1');
    // The rest of Blockly's Vietnamese is still there.
    expect(Blockly.Msg['CONTROLS_IF_MSG_IF']).toBe('nếu');
  });
});
