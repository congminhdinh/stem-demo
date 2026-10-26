import { createWriteStream, rmSync } from 'node:fs';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createDeflate, inflateSync } from 'node:zlib';

// A PNG writer and reader with nothing but node:zlib (N18 R5.3, scripts/export-arena-mat.mjs). The true-scale mat is 10 000 × 8 000 px and more,
// which no screenshot call is made for: the script renders it in tiles and hands the rows here a strip at a time, so that the whole picture
// is never in memory twice. The reader is for the tiles Chromium gives back and for the tests that read the writer's file with it.
//
// What is written: 8-bit RGB, no interlacing, filter type 0 on every row (a flat mat compresses well without prediction), one zlib stream in
// IDAT chunks of exactly 64 KiB (the last one shorter), and a pHYs chunk so that a print shop's software takes the picture for what it is, a
// 150 dpi image of a mat of that many centimetres. What is read: 8-bit grey, grey+alpha, RGB and RGBA, no interlacing, every filter type.
//
// N19 D1–D3 fix round 1: the chunks are cut from the zlib stream at fixed lengths, not taken as the stream hands them over (a read gives
// whatever it has buffered, which depends on how far the file writer lags behind), so the same picture is always the same bytes.

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IDAT_CHUNK_BYTES = 64 * 1024;
const COLOUR_TYPE_RGB = 2;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 of the chunk's type and data (PNG spec, Annex D). */
function crc32(...parts: Uint8Array[]): number {
  let crc = 0xffffffff;
  for (const part of parts) {
    for (const byte of part) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8), data), 8 + data.length);
  return out;
}

export type PngHeader = {
  width: number;
  height: number;
  /** The pHYs chunk: dots per metre in x and y (150 dpi is 5906). */
  pixelsPerMetre: number;
};

/** What the writer needs of its rows: bytes that are whole rows of `width` RGB pixels, from the top. */
type Strips = AsyncIterable<Uint8Array> | Iterable<Uint8Array>;

/**
 * Writes `strips` (the picture's rows from the top, 8-bit RGB, as many rows in a strip as the caller likes) to `path` as a PNG. Rejects, and
 * deletes what it wrote, when a strip is not whole rows or the rows do not add up to `height`.
 */
export async function writePng(path: string, header: PngHeader, strips: Strips): Promise<void> {
  const { width, height, pixelsPerMetre } = header;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`A PNG is a whole number of pixels each way, not ${width} × ${height}.`);
  }
  const rowBytes = width * 3;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = COLOUR_TYPE_RGB;
  const phys = Buffer.alloc(9);
  phys.writeUInt32BE(pixelsPerMetre, 0);
  phys.writeUInt32BE(pixelsPerMetre, 4);
  phys[8] = 1; // the unit is the metre

  const deflate = createDeflate({ level: 6, chunkSize: IDAT_CHUNK_BYTES });
  // The feed may fail before anything reads the stream; the error reaches the caller through the stream's iteration, so this one is only to
  // keep a destroyed stream's 'error' event from being unhandled.
  deflate.on('error', () => {});
  const feed = (async () => {
    let rows = 0;
    for await (const strip of strips) {
      if (strip.length % rowBytes !== 0) {
        throw new RangeError(`A strip is whole rows of ${width} RGB pixels (${rowBytes} bytes each); this one has ${strip.length} bytes.`);
      }
      const count = strip.length / rowBytes;
      rows += count;
      if (rows > height) throw new RangeError(`The picture has more than the ${height} rows its header says.`);
      // Each row is its filter type (0, none) and then its pixels
      const scanlines = Buffer.alloc(count * (1 + rowBytes));
      for (let row = 0; row < count; row++) scanlines.set(strip.subarray(row * rowBytes, (row + 1) * rowBytes), row * (1 + rowBytes) + 1);
      if (!deflate.write(scanlines)) await once(deflate, 'drain');
    }
    if (rows !== height) throw new RangeError(`The picture has ${rows} rows, and its header says ${height}.`);
    deflate.end();
  })();
  feed.catch((error: unknown) => deflate.destroy(error instanceof Error ? error : new Error(String(error))));

  async function* file(): AsyncGenerator<Uint8Array> {
    yield SIGNATURE;
    yield chunk('IHDR', ihdr);
    yield chunk('pHYs', phys);
    // The zlib stream, cut at every IDAT_CHUNK_BYTES whatever the pieces it comes in.
    let pending: Buffer[] = [];
    let pendingBytes = 0;
    for await (const data of deflate) {
      pending.push(data as Buffer);
      pendingBytes += (data as Buffer).length;
      if (pendingBytes < IDAT_CHUNK_BYTES) continue;
      let joined = Buffer.concat(pending, pendingBytes);
      while (joined.length >= IDAT_CHUNK_BYTES) {
        yield chunk('IDAT', joined.subarray(0, IDAT_CHUNK_BYTES));
        joined = joined.subarray(IDAT_CHUNK_BYTES);
      }
      pending = joined.length > 0 ? [joined] : [];
      pendingBytes = joined.length;
    }
    if (pendingBytes > 0) yield chunk('IDAT', Buffer.concat(pending, pendingBytes));
    await feed;
    yield chunk('IEND', new Uint8Array(0));
  }
  try {
    await pipeline(Readable.from(file()), createWriteStream(path));
  } catch (error) {
    rmSync(path, { force: true });
    throw error;
  }
}

export type DecodedPng = {
  width: number;
  height: number;
  /** Bytes per pixel: 1 (grey), 2 (grey and alpha), 3 (RGB) or 4 (RGBA). */
  channels: 1 | 2 | 3 | 4;
  /** The rows from the top, filters undone, `width × channels` bytes each. */
  data: Uint8Array;
  /** The pHYs chunk in pixels per metre (when it says the metre), else null. */
  pixelsPerMetre: number | null;
};

const CHANNELS: Readonly<Record<number, DecodedPng['channels']>> = { 0: 1, 2: 3, 4: 2, 6: 4 };

/** Reads a PNG of the kind in the header of this file. Throws on anything else, and on a chunk whose CRC is wrong. */
export function decodePng(file: Uint8Array): DecodedPng {
  const bytes = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error('This is not a PNG (the signature is wrong).');
  let header: { width: number; height: number; channels: DecodedPng['channels'] } | null = null;
  let pixelsPerMetre: number | null = null;
  const idat: Buffer[] = [];
  let at = 8;
  while (at + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString('latin1', at + 4, at + 8);
    const end = at + 8 + length;
    if (end + 4 > bytes.length) throw new Error(`The ${type} chunk runs past the end of the file.`);
    const data = bytes.subarray(at + 8, end);
    if (bytes.readUInt32BE(end) !== crc32(bytes.subarray(at + 4, at + 8), data)) throw new Error(`The CRC of the ${type} chunk is wrong.`);
    if (type === 'IHDR') {
      const channels = CHANNELS[data[9]!];
      if (data[8] !== 8) throw new Error(`Only 8-bit PNGs are read, not a bit depth of ${data[8]}.`);
      if (channels === undefined) throw new Error(`Colour type ${data[9]} (palette) is not read.`);
      if (data[12] !== 0) throw new Error('An interlaced PNG is not read.');
      header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), channels };
    } else if (type === 'pHYs' && data[8] === 1) {
      pixelsPerMetre = data.readUInt32BE(0);
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    at = end + 4;
  }
  if (header === null) throw new Error('The PNG has no IHDR chunk.');

  const { width, height, channels } = header;
  const rowBytes = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length !== height * (1 + rowBytes)) throw new Error(`The PNG's pixels are ${raw.length} bytes, not the ${height * (1 + rowBytes)} its header needs.`);
  const data = new Uint8Array(height * rowBytes);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (1 + rowBytes)]!;
    const source = y * (1 + rowBytes) + 1;
    const out = y * rowBytes;
    for (let i = 0; i < rowBytes; i++) {
      const left = i >= channels ? data[out + i - channels]! : 0;
      const up = y > 0 ? data[out - rowBytes + i]! : 0;
      const upLeft = y > 0 && i >= channels ? data[out - rowBytes + i - channels]! : 0;
      let predictor: number;
      switch (filter) {
        case 0:
          predictor = 0;
          break;
        case 1:
          predictor = left;
          break;
        case 2:
          predictor = up;
          break;
        case 3:
          predictor = (left + up) >> 1;
          break;
        case 4:
          predictor = paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`Row ${y} has the unknown filter type ${filter}.`);
      }
      data[out + i] = (raw[source + i]! + predictor) & 0xff;
    }
  }
  return { width, height, channels, data, pixelsPerMetre };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
