import { describe, expect, it } from 'vitest';
import { fitPageBoxes, mediaBoxesOf } from '../scripts/lib/pdf-page-box';
import { pdfWith, xrefProblems } from './arena-mat.fixtures';

// N18 R5.3: Chromium sizes a PDF page in whole device units (1/300 in) after its own rounding, so a page printed for a 170 × 140 cm mat comes out
// up to a point off (0.6 pt on the height). The content is exactly to scale (1 cm is 28.3465 pt), so scripts/lib/pdf-page-box.ts sets the page box
// to the exact size, keeping the page's top-left corner where the content starts, and moves the cross-reference offsets with the bytes.

describe('fitPageBoxes', () => {
  it('reads the page boxes of a PDF as widths and heights, whatever their corner', () => {
    expect(mediaBoxesOf(pdfWith('[0 0 3684.96 3684.96]', '[0 0.5 100 200.5]'))).toEqual([
      { x0: 0, y0: 0, x1: 3684.96, y1: 3684.96, width: 3684.96, height: 3684.96 },
      { x0: 0, y0: 0.5, x1: 100, y1: 200.5, width: 100, height: 200 },
    ]);
  });

  it('sets the page to the exact size, keeping the left and the top of the page where they are', () => {
    // 170 × 140 cm: Chromium's 4818.96 × 3969.12 pt for 4818.8976 × 3968.5039 pt
    const widthPt = (170 / 2.54) * 72;
    const heightPt = (140 / 2.54) * 72;
    const fitted = fitPageBoxes(pdfWith('[0 0 4818.96 3969.12]'), widthPt, heightPt);
    const [box] = mediaBoxesOf(fitted);
    expect(box!.x0).toBe(0);
    expect(box!.y1).toBe(3969.12);
    expect(Math.abs(box!.width - widthPt)).toBeLessThan(0.005);
    expect(Math.abs(box!.height - heightPt)).toBeLessThan(0.005);
    // The content hangs from the top: the page now ends 0.62 pt above the bottom of the old page
    expect(box!.y0).toBeCloseTo(3969.12 - heightPt, 2);
  });

  it('leaves a valid file: every xref offset follows the bytes that moved, and startxref points at the table', () => {
    const original = pdfWith('[0 0 3684.96 3684.96]', '[0 0 595.92 841.92]', '[0 0 595.92 841.92]');
    expect(xrefProblems(original)).toEqual([]);
    // Shorter and longer boxes than the original text: the bytes move both ways
    const longer = fitPageBoxes(original, 3684.8976123, 3684.8976123);
    expect(xrefProblems(longer)).toEqual([]);
    expect(longer.length).not.toBe(original.length);
    const shorter = fitPageBoxes(pdfWith('[0 0 4818.96 3969.12]', '[0 0 4818.96 3969.12]'), 4818, 3969);
    expect(xrefProblems(shorter)).toEqual([]);
    expect(mediaBoxesOf(shorter).map((box) => [box.width, box.height])).toEqual([
      [4818, 3969],
      [4818, 3969],
    ]);
  });

  it('changes nothing but the page boxes: the text outside them is the same', () => {
    const original = pdfWith('[0 0 100 100]');
    const fitted = fitPageBoxes(original, 100, 100);
    expect(fitted.equals(original)).toBe(true);
  });

  it('refuses a PDF without a classic cross-reference table, rather than hand back one a reader cannot open', () => {
    expect(() => fitPageBoxes(Buffer.from('%PDF-1.7\n1 0 obj\n<</MediaBox [0 0 1 1]>>\nendobj\n'), 2, 2)).toThrow(/cross-reference/);
    expect(() => fitPageBoxes(Buffer.from('not a pdf'), 2, 2)).toThrow(/MediaBox/);
  });
});
