import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { matPixelSize, matPixelsPerMetre } from '../src/core/scenario/arena-mat';
import { decodePng, writePng } from '../scripts/lib/png';

// N18 R5.3: the PNG writer of scripts/export-arena-mat.mjs (no dependency: node:zlib and the 40 lines of the format). These tests read what it
// wrote back the way any PNG reader does (chunk by chunk, CRC by CRC, then node:zlib), with code of their own that does not call the writer's.

let work: string;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'arena-mat-png-'));
});
afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** CRC-32 of the PNG spec (Annex D), written out here so that the test does not lean on the writer's table. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

type Chunk = { type: string; data: Buffer };

/** The chunks of a PNG file, each checked: the signature, the length, the CRC of its type and data. */
function chunksOf(file: Buffer): Chunk[] {
  expect(file.subarray(0, 8).equals(SIGNATURE)).toBe(true);
  const chunks: Chunk[] = [];
  let at = 8;
  while (at < file.length) {
    const length = file.readUInt32BE(at);
    const type = file.toString('latin1', at + 4, at + 8);
    const data = file.subarray(at + 8, at + 8 + length);
    expect(file.readUInt32BE(at + 8 + length), `CRC of ${type}`).toBe(crc32(file.subarray(at + 4, at + 8 + length)));
    chunks.push({ type, data });
    at += 12 + length;
  }
  expect(at).toBe(file.length);
  return chunks;
}

/** A picture with a different value in every byte of a row, so that a swapped or dropped row is seen. */
function picture(width: number, height: number): Buffer {
  const rgb = Buffer.alloc(width * height * 3);
  for (let row = 0; row < height; row++) {
    for (let i = 0; i < width * 3; i++) rgb[row * width * 3 + i] = (row * 31 + i * 7) & 0xff;
  }
  return rgb;
}

function* strips(rgb: Buffer, width: number, rowsPerStrip: number): Generator<Buffer> {
  const rowBytes = width * 3;
  for (let at = 0; at < rgb.length; at += rowBytes * rowsPerStrip) yield rgb.subarray(at, Math.min(rgb.length, at + rowBytes * rowsPerStrip));
}

describe('writePng', () => {
  it('writes the 150 dpi size of a mat: IHDR of the pixel size, pHYs of 5906 pixels per metre, 8-bit RGB', async () => {
    // 2.54 cm × 1.27 cm is 1 in × 0.5 in: 150 × 75 px at 150 dpi
    const { width, height } = matPixelSize(2.54, 1.27);
    expect({ width, height }).toEqual({ width: 150, height: 75 });
    const file = join(work, 'mat.png');
    await writePng(file, { width, height, pixelsPerMetre: matPixelsPerMetre() }, strips(picture(width, height), width, 25));

    const chunks = chunksOf(readFileSync(file));
    expect(chunks.map((chunk) => chunk.type)).toEqual(expect.arrayContaining(['IHDR', 'pHYs', 'IDAT', 'IEND']));
    expect(chunks[0]!.type).toBe('IHDR');
    expect(chunks.at(-1)!.type).toBe('IEND');
    expect(chunks.at(-1)!.data.length).toBe(0);

    const ihdr = chunks[0]!.data;
    expect(ihdr.length).toBe(13);
    expect({
      width: ihdr.readUInt32BE(0),
      height: ihdr.readUInt32BE(4),
      bitDepth: ihdr[8],
      colourType: ihdr[9],
      compression: ihdr[10],
      filter: ihdr[11],
      interlace: ihdr[12],
    }).toEqual({ width: 150, height: 75, bitDepth: 8, colourType: 2, compression: 0, filter: 0, interlace: 0 });

    const phys = chunks.find((chunk) => chunk.type === 'pHYs')!.data;
    expect([phys.readUInt32BE(0), phys.readUInt32BE(4), phys[8]]).toEqual([5906, 5906, 1]);
    // pHYs comes before the first IDAT, as the format requires
    expect(chunks.findIndex((chunk) => chunk.type === 'pHYs')).toBeLessThan(chunks.findIndex((chunk) => chunk.type === 'IDAT'));
  });

  it('writes the pixels it is given: the IDAT inflates (node:zlib) to one filter byte and one row of RGB per row', async () => {
    const width = 37;
    const height = 23;
    const rgb = picture(width, height);
    const file = join(work, 'pixels.png');
    // Strips of 5 rows, the last one of 3: a strip is any whole number of rows
    await writePng(file, { width, height, pixelsPerMetre: 5906 }, strips(rgb, width, 5));

    const idat = Buffer.concat(chunksOf(readFileSync(file)).filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data));
    const raw = inflateSync(idat);
    expect(raw.length).toBe(height * (1 + width * 3));
    for (let row = 0; row < height; row++) {
      const start = row * (1 + width * 3);
      expect(raw[start], `filter byte of row ${row}`).toBe(0);
      expect(raw.subarray(start + 1, start + 1 + width * 3).equals(rgb.subarray(row * width * 3, (row + 1) * width * 3)), `row ${row}`).toBe(true);
    }
  });

  it('accepts strips from an async source, as the script renders them', async () => {
    const width = 16;
    const height = 12;
    const rgb = picture(width, height);
    async function* slow() {
      for (const strip of strips(rgb, width, 4)) {
        await new Promise((resolve) => setTimeout(resolve, 1));
        yield strip;
      }
    }
    const file = join(work, 'async.png');
    await writePng(file, { width, height, pixelsPerMetre: 5906 }, slow());
    const decoded = decodePng(readFileSync(file));
    expect(Buffer.from(decoded.data).equals(rgb)).toBe(true);
  });

  it('refuses a picture that has fewer or more rows than the header says, and a strip that is not whole rows', async () => {
    const width = 8;
    await expect(writePng(join(work, 'few.png'), { width, height: 10, pixelsPerMetre: 5906 }, strips(picture(width, 9), width, 3))).rejects.toThrow(
      /9 rows.*10/,
    );
    await expect(writePng(join(work, 'many.png'), { width, height: 10, pixelsPerMetre: 5906 }, strips(picture(width, 11), width, 4))).rejects.toThrow(
      /more than the 10 rows/,
    );
    await expect(writePng(join(work, 'ragged.png'), { width, height: 4, pixelsPerMetre: 5906 }, [Buffer.alloc(width * 3 * 2 + 1)])).rejects.toThrow(/whole rows/);
  });

  it('compresses a flat mat to a small file even at a size that is not small: 2000 × 1000 px of one colour', async () => {
    const width = 2000;
    const height = 1000;
    const row = Buffer.alloc(width * 3, 0xf2);
    function* flat() {
      for (let at = 0; at < height; at += 100) yield Buffer.concat(Array.from({ length: 100 }, () => row));
    }
    const file = join(work, 'flat.png');
    await writePng(file, { width, height, pixelsPerMetre: 5906 }, flat());
    expect(readFileSync(file).length).toBeLessThan(20_000);
  });
});

describe('decodePng', () => {
  /** A PNG of the given rows, each with its own filter type, built here from first principles. */
  function filtered(
    width: number,
    height: number,
    bytesPerPixel: number,
    colourType: number,
    filters: number[],
    rows: Buffer[],
    header: { bitDepth?: number; interlace?: number } = {},
  ): Buffer {
    const rowBytes = width * bytesPerPixel;
    const scanlines: Buffer[] = [];
    rows.forEach((row, y) => {
      const type = filters[y % filters.length]!;
      const previous = y === 0 ? Buffer.alloc(rowBytes) : rows[y - 1]!;
      const out = Buffer.alloc(1 + rowBytes);
      out[0] = type;
      for (let i = 0; i < rowBytes; i++) {
        const left = i >= bytesPerPixel ? row[i - bytesPerPixel]! : 0;
        const up = previous[i]!;
        const upLeft = i >= bytesPerPixel ? previous[i - bytesPerPixel]! : 0;
        const predictor = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][type]!;
        out[1 + i] = (row[i]! - predictor) & 0xff;
      }
      scanlines.push(out);
    });
    const chunk = (type: string, data: Buffer) => {
      const head = Buffer.alloc(8);
      head.writeUInt32BE(data.length, 0);
      head.write(type, 4, 'latin1');
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
      return Buffer.concat([head, data, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = header.bitDepth ?? 8;
    ihdr[9] = colourType;
    ihdr[12] = header.interlace ?? 0;
    return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(scanlines))), chunk('IEND', Buffer.alloc(0))]);
  }

  function paeth(a: number, b: number, c: number): number {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  }

  it.each([
    ['RGB', 2, 3],
    ['RGBA', 6, 4],
  ])('reads %s rows written with every filter type (None, Sub, Up, Average, Paeth)', (_name, colourType, bytesPerPixel) => {
    const width = 9;
    const height = 10;
    const rows = Array.from({ length: height }, (_, y) => Buffer.from(Array.from({ length: width * bytesPerPixel }, (_, i) => (y * 53 + i * 29 + (i % 3) * 91) & 0xff)));
    const decoded = decodePng(filtered(width, height, bytesPerPixel, colourType, [0, 1, 2, 3, 4], rows));
    expect([decoded.width, decoded.height, decoded.channels]).toEqual([width, height, bytesPerPixel]);
    expect(Buffer.from(decoded.data).equals(Buffer.concat(rows))).toBe(true);
    expect(decoded.pixelsPerMetre).toBeNull();
  });

  it('reads back the size and the resolution of what the writer wrote', async () => {
    const file = join(work, 'round.png');
    await writePng(file, { width: 21, height: 13, pixelsPerMetre: 5906 }, strips(picture(21, 13), 21, 13));
    const decoded = decodePng(readFileSync(file));
    expect([decoded.width, decoded.height, decoded.channels, decoded.pixelsPerMetre]).toEqual([21, 13, 3, 5906]);
  });

  it('refuses what it cannot read: not a PNG, a chunk whose CRC is wrong, interlacing, a bit depth of 16, a palette', () => {
    expect(() => decodePng(Buffer.from('not a png at all'))).toThrow(/not a PNG/);
    const rows = [Buffer.alloc(6, 7), Buffer.alloc(6, 9)];
    expect(decodePng(filtered(2, 2, 3, 2, [0], rows)).data).toEqual(new Uint8Array(Buffer.concat(rows)));
    const corrupt = filtered(2, 2, 3, 2, [0], rows);
    // A byte of the IDAT's data (the chunk before IEND's 12 bytes: its CRC is the 4 bytes before them)
    corrupt[corrupt.length - 12 - 4 - 1]! ^= 0xff;
    expect(() => decodePng(corrupt)).toThrow(/CRC of the IDAT/);
    expect(() => decodePng(filtered(2, 2, 3, 2, [0], rows, { interlace: 1 }))).toThrow(/interlaced/);
    expect(() => decodePng(filtered(2, 2, 3, 2, [0], rows, { bitDepth: 16 }))).toThrow(/bit depth of 16/);
    expect(() => decodePng(filtered(2, 2, 1, 3, [0], [Buffer.alloc(2), Buffer.alloc(2)]))).toThrow(/palette/);
  });
});
