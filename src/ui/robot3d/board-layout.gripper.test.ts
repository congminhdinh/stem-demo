import { describe, expect, it } from 'vitest';
import { productionKits, referenceKitRef, unoR3Board } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import { translate, type Locale } from '../i18n/messages';
import type { Text } from '../i18n/text';
import { boardLayout, LABEL_CHAR_UNITS } from './board-layout';
import { hubMap } from './pin-map';
import { bottomLabelChars, padLabel } from './pin-text';

// N19 E2: the names under the analog header of the gripper car ("Hồng ngoại ở càng" on A3, "Cảm biến màu SDA" and "SCL" on A4 and A5) are longer
// than the rover's, so the drawing keeps more room under the board for them; the rover's drawing is the size it was.

const textIn = (locale: Locale): Text => (key, params) => translate(locale, key, params);
const gripperMap = hubMap(productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit, unoR3Board);
const roverMap = hubMap(productionKits.get(referenceKitRef) as Kit, unoR3Board);

describe('boardLayout room for the part names (N19 E2)', () => {
  it('is the rover’s drawing, 500 × 312, whatever the language: its longest name under the board is 9 characters', () => {
    for (const locale of ['vi', 'en'] as const) {
      expect(bottomLabelChars(textIn(locale), roverMap)).toBeLessThanOrEqual(11);
      const layout = boardLayout(roverMap, bottomLabelChars(textIn(locale), roverMap));
      expect([layout.width, layout.height, layout.labelRoom]).toEqual([500, 312, 108]);
    }
    expect(boardLayout(roverMap).height).toBe(312);
  });

  it('grows under the board for the gripper car so that its longest name fits, in both languages', () => {
    for (const locale of ['vi', 'en'] as const) {
      const t = textIn(locale);
      const chars = bottomLabelChars(t, gripperMap);
      expect(chars).toBe(17);
      const layout = boardLayout(gripperMap, chars);
      expect(layout.labelRoom).toBeGreaterThan(108);
      expect(layout.height).toBe(layout.body.y + layout.body.height + layout.labelRoom);
      for (const [pin, owner] of gripperMap.owners) {
        if (!pin.startsWith('A')) continue;
        const { part, signal } = padLabel(t, owner);
        const length = (part.length + (signal === null ? 0 : 1 + signal.length)) * LABEL_CHAR_UNITS;
        expect(length + 6, `${pin} ${part}`).toBeLessThanOrEqual(layout.labelRoom);
      }
    }
    expect(boardLayout(gripperMap, 17).labelRoom).toBe(126);
  });

  it('puts the pads where they were: only the room below changes', () => {
    const wide = boardLayout(gripperMap, 17);
    const usual = boardLayout(gripperMap);
    expect(wide.pads).toEqual(usual.pads);
    expect(wide.body).toEqual(usual.body);
    expect(wide.height - usual.height).toBe(wide.labelRoom - usual.labelRoom);
  });
});
