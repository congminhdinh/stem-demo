// The page box of a PDF Chromium printed (N18 R5.3, scripts/export-arena-mat.mjs).
//
// Chromium sizes a page in whole device units (1/300 in) after rounding the size it was given, and Playwright turns `cm` into pixels with 37.8
// per cm instead of 37.7953, so the page of a 170 × 140 cm mat comes out 4818.96 × 3969.12 pt where 4818.90 × 3968.50 is the size. The content is
// not affected: Skia writes it in device units under one transform (`.24 0 0 -.24 0 H cm`, then `118.11 0 0 118.11 0 0 cm` for a centimetre), so a
// centimetre of the page is 28.3465 pt to within a millionth. Only the box around it is off, by up to a point.
//
// So the box is set to the exact size afterwards: the left and the top of the page stay where the content starts (the content hangs from the
// top, `H` in that transform is the box's upper edge) and the box's width and height become exactly those asked for, which moves its lower edge.
// Bytes are replaced in the text of the file, which Chromium writes uncompressed with a classic cross-reference table: the offsets of every
// object after a replaced box move with the bytes, and `startxref` with them. A file that is not of that shape is refused, never returned broken.

export type PageBox = { x0: number; y0: number; x1: number; y1: number; width: number; height: number };

const MEDIA_BOX = /\/MediaBox\s*\[\s*([-+\d.]+)\s+([-+\d.]+)\s+([-+\d.]+)\s+([-+\d.]+)\s*\]/g;

/** A number at most three decimals long (a thousandth of a point is 0.35 µm), without a trailing zero or an exponent. */
function pdfNumber(value: number): string {
  const text = (Math.round(value * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '');
  return text === '-0' || text === '' ? '0' : text;
}

/** The MediaBox of every page of the PDF, in the order they are written. */
export function mediaBoxesOf(pdf: Uint8Array): PageBox[] {
  const text = Buffer.from(pdf.buffer, pdf.byteOffset, pdf.byteLength).toString('latin1');
  return [...text.matchAll(MEDIA_BOX)].map((match) => {
    const [x0, y0, x1, y1] = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])] as const;
    return { x0, y0, x1, y1, width: x1 - x0, height: y1 - y0 };
  });
}

/** The PDF with every page's MediaBox `widthPt` × `heightPt` points, its left and its top where they were. See the top of this file. */
export function fitPageBoxes(pdf: Uint8Array, widthPt: number, heightPt: number): Buffer {
  const original = Buffer.from(pdf.buffer, pdf.byteOffset, pdf.byteLength);
  const text = original.toString('latin1');
  const boxes = [...text.matchAll(MEDIA_BOX)];
  if (boxes.length === 0) throw new Error('The PDF has no MediaBox to set.');

  // Where each box starts and how many bytes it grows by, to move what comes after
  const moves: { at: number; delta: number }[] = [];
  let out = '';
  let from = 0;
  for (const match of boxes) {
    const x0 = Number(match[1]);
    const y1 = Number(match[4]);
    const box = `/MediaBox [${pdfNumber(x0)} ${pdfNumber(y1 - heightPt)} ${pdfNumber(x0 + widthPt)} ${pdfNumber(y1)}]`;
    out += text.slice(from, match.index) + box;
    moves.push({ at: match.index, delta: box.length - match[0].length });
    from = match.index + match[0].length;
  }
  out += text.slice(from);
  const shift = (offset: number) => moves.reduce((total, move) => (move.at < offset ? total + move.delta : total), 0);

  // The classic cross-reference table: `startxref`, then at that offset `xref`, subsections of `first count` and 20-byte entries, `trailer`
  const startMatch = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(text);
  const tableAt = startMatch === null ? -1 : Number(startMatch[1]);
  if (startMatch === null || !text.startsWith('xref', tableAt)) {
    throw new Error('The PDF has no classic cross-reference table (xref ... trailer), so its offsets cannot be moved with the page boxes.');
  }
  const tableEnd = text.indexOf('trailer', tableAt);
  if (tableEnd < 0) throw new Error('The PDF has no classic cross-reference table: the xref has no trailer.');
  const table = text.slice(tableAt, tableEnd);
  const fixed = table.replace(/^(\d{10}) (\d{5}) n( ?\r?\n)/gm, (_entry, offset: string, generation: string, end: string) => {
    return `${String(Number(offset) + shift(Number(offset))).padStart(10, '0')} ${generation} n${end}`;
  });
  const tableStart = tableAt + shift(tableAt);
  const rebuilt = out.slice(0, tableStart) + fixed + out.slice(tableStart + table.length);
  const startxref = rebuilt.replace(/startxref(\s+)\d+(\s+%%EOF\s*)$/, (_all, before: string, after: string) => `startxref${before}${tableStart}${after}`);
  return Buffer.from(startxref, 'latin1');
}
