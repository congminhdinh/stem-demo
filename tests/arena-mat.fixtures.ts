// Shared by the tests of N18 R5.3's PDF page boxes (arena-mat-pdf.test.ts) and of the script that writes them (export-arena-mat.test.ts).

/** A PDF of Chromium's shape (classic xref table, one object a line, uncompressed text), pages given as their MediaBox text. */
export function pdfWith(...boxes: string[]): Buffer {
  const objects: string[] = [];
  const pageRefs = boxes.map((_, i) => `${3 + i} 0 R`).join(' ');
  objects.push('<</Type /Catalog\n/Pages 2 0 R>>');
  objects.push(`<</Type /Pages\n/Kids [${pageRefs}]\n/Count ${boxes.length}>>`);
  boxes.forEach((box) => objects.push(`<</Type /Page\n/Parent 2 0 R\n/MediaBox ${box}\n/Contents 9 0 R>>`));
  let text = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(text.length);
    text += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = text.length;
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) text += `${String(offset).padStart(10, '0')} 00000 n \n`;
  text += `trailer\n<</Size ${objects.length + 1}\n/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text, 'latin1');
}

/** Every `n` entry of the xref table points at its own `N 0 obj`, and startxref points at the table: what a reader needs to open the file. */
export function xrefProblems(pdf: Buffer): string[] {
  const text = pdf.toString('latin1');
  const problems: string[] = [];
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)?.[1]);
  if (text.slice(start, start + 5) !== 'xref\n') problems.push(`startxref ${start} is not at "xref"`);
  const header = /xref\n0 (\d+)\n/.exec(text.slice(start));
  const count = Number(header?.[1]);
  const entries = text.slice(start + (header?.[0].length ?? 0));
  for (let i = 1; i < count; i++) {
    const entry = entries.slice(i * 20, i * 20 + 20);
    const offset = Number(entry.slice(0, 10));
    if (!text.startsWith(`${i} 0 obj\n`, offset)) problems.push(`object ${i} is not at ${offset}`);
  }
  return problems;
}
