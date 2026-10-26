// Binary glTF (GLB) files of the robot lab's 3D assets, spliced (N19 E6/E7): `pnpm build:robot-assets` (scripts/build-robot-assets.mjs)
// keeps the N18 roots of each GLB byte for byte and appends the roots Blender built for N19 (the gripper's parts, the pick-and-place
// props). Why: the ambient occlusion Cycles bakes into the parts' vertex colours is not the same from one run to the next (two builds of
// one commit differ in 13 meshes' vertex counts, the 8-bit colours of some corners by 1/255), so building the rover's parts again would
// change the rover's pixels. The N18 roots are frozen instead: the file's first part is the N18 build's GLB exactly, and `frozenBase`
// gets it back (its SHA-256 is the N18 build's, tests/robot-assets-frozen.test.ts).
//
// The JSON chunk is read and written token for token: a number keeps the text Blender's exporter wrote (Python's float repr, `1e-05`),
// so the N18 part of a spliced file writes back to the same bytes. Only integers of our own (indices, offsets, lengths) are new text.
// Plain TypeScript run by Node 24 (type stripping) and by Vitest; no dependency.

/** A JSON number as its source text (written back as it was read). */
export class RawNumber {
  readonly text: string;
  constructor(text: string) {
    this.text = text;
  }
  valueOf(): number {
    return Number(this.text);
  }
}

export type Json = null | boolean | string | number | RawNumber | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

/** Parses JSON text, numbers kept as their text (RawNumber), keys and the rest as JSON.parse reads them. */
export function parseRawJson(text: string): Json {
  let at = 0;
  const fail = (what: string): never => {
    throw new SyntaxError(`${what} at ${at} of the glTF JSON`);
  };
  const space = () => {
    while (at < text.length && ' \t\n\r'.includes(text[at]!)) at += 1;
  };
  const stringToken = (): string => {
    const start = at;
    at += 1;
    while (at < text.length && text[at] !== '"') at += text[at] === '\\' ? 2 : 1;
    if (at >= text.length) fail('an unterminated string');
    at += 1;
    return JSON.parse(text.slice(start, at)) as string;
  };
  const value = (): Json => {
    space();
    const c = text[at];
    if (c === '{') {
      at += 1;
      const object: JsonObject = {};
      space();
      if (text[at] === '}') {
        at += 1;
        return object;
      }
      for (;;) {
        space();
        if (text[at] !== '"') fail('a key');
        const key = stringToken();
        space();
        if (text[at] !== ':') fail('a colon');
        at += 1;
        object[key] = value();
        space();
        if (text[at] === ',') {
          at += 1;
          continue;
        }
        if (text[at] === '}') {
          at += 1;
          return object;
        }
        fail('a comma or a brace');
      }
    }
    if (c === '[') {
      at += 1;
      const array: Json[] = [];
      space();
      if (text[at] === ']') {
        at += 1;
        return array;
      }
      for (;;) {
        array.push(value());
        space();
        if (text[at] === ',') {
          at += 1;
          continue;
        }
        if (text[at] === ']') {
          at += 1;
          return array;
        }
        fail('a comma or a bracket');
      }
    }
    if (c === '"') return stringToken();
    for (const [word, literal] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as const) {
      if (text.startsWith(word, at)) {
        at += word.length;
        return literal;
      }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(at, at + 64));
    if (!number) return fail('a value');
    at += number[0].length;
    return new RawNumber(number[0]);
  };
  const result = value();
  space();
  if (at !== text.length) fail('text after the value');
  return result;
}

/** Writes JSON compactly (no spaces), keys in their order, a RawNumber as its text, a plain number as an integer. */
export function stringifyRawJson(value: Json): string {
  if (value === null) return 'null';
  if (value instanceof RawNumber) return value.text;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new RangeError(`Only integers are written as new numbers, not ${value}`);
    return String(value);
  }
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stringifyRawJson).join(',')}]`;
  return `{${Object.entries(value)
    .map(([key, item]) => `${JSON.stringify(key)}:${stringifyRawJson(item)}`)
    .join(',')}}`;
}

export type Glb = { json: JsonObject; bin: Uint8Array };

const MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

/** Reads a GLB's JSON chunk (raw numbers) and its binary chunk. */
export function readGlb(bytes: Uint8Array): Glb {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC || view.getUint32(4, true) !== 2) throw new Error('not a glTF 2.0 binary');
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== JSON_CHUNK) throw new Error('the first chunk is not JSON');
  const json = parseRawJson(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as JsonObject;
  const binAt = 20 + jsonLength;
  if (binAt >= bytes.byteLength) return { json, bin: new Uint8Array(0) };
  if (view.getUint32(binAt + 4, true) !== BIN_CHUNK) throw new Error('the second chunk is not BIN');
  const binLength = view.getUint32(binAt, true);
  return { json, bin: bytes.slice(binAt + 8, binAt + 8 + binLength) };
}

/** Writes a GLB: the JSON chunk padded with spaces to 4 bytes, the binary chunk with zeros (as Blender's exporter does). */
export function writeGlb({ json, bin }: Glb): Uint8Array {
  const text = new TextEncoder().encode(stringifyRawJson(json));
  const jsonPadded = (text.length + 3) & ~3;
  const binPadded = (bin.length + 3) & ~3;
  const total = 12 + 8 + jsonPadded + (bin.length > 0 ? 8 + binPadded : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonPadded, true);
  view.setUint32(16, JSON_CHUNK, true);
  out.set(text, 20);
  out.fill(0x20, 20 + text.length, 20 + jsonPadded);
  if (bin.length > 0) {
    const at = 20 + jsonPadded;
    view.setUint32(at, binPadded, true);
    view.setUint32(at + 4, BIN_CHUNK, true);
    out.set(bin, at + 8);
  }
  return out;
}

const num = (value: Json | undefined): number => (value instanceof RawNumber ? value.valueOf() : typeof value === 'number' ? value : 0);
const list = (json: JsonObject, key: string): Json[] => (Array.isArray(json[key]) ? (json[key] as Json[]) : []);
const asObject = (value: Json | undefined): JsonObject | null => (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof RawNumber) ? value : null);

/** The arrays of a glTF document a splice appends to, in the order the entities reference each other (leaves first). */
export const SPLICED_ARRAYS = ['buffers', 'bufferViews', 'accessors', 'samplers', 'images', 'textures', 'materials', 'meshes', 'nodes'] as const;

/** Where a GLB's N18 part ends: each array's length, the scene's root count, the buffers' lengths, the extension lists. */
export type FrozenLayout = {
  readonly counts: Readonly<Record<(typeof SPLICED_ARRAYS)[number], number>>;
  readonly sceneNodes: number;
  readonly bufferBytes: readonly number[];
  readonly extensionsUsed: readonly string[];
  readonly extensionsRequired: readonly string[];
};

/** The layout of a whole GLB, as the frozen part of the files spliced from it. */
export function layoutOf({ json }: Glb): FrozenLayout {
  const scene = asObject(list(json, 'scenes')[num(json.scene)]);
  return {
    counts: Object.fromEntries(SPLICED_ARRAYS.map((key) => [key, list(json, key).length])) as FrozenLayout['counts'],
    sceneNodes: scene ? list(scene, 'nodes').length : 0,
    bufferBytes: list(json, 'buffers').map((buffer) => num(asObject(buffer)?.byteLength)),
    extensionsUsed: list(json, 'extensionsUsed') as string[],
    extensionsRequired: list(json, 'extensionsRequired') as string[],
  };
}

/** A deep copy of JSON data (RawNumbers are immutable and shared). */
const copy = <T extends Json>(value: T): T => (Array.isArray(value) ? (value.map(copy) as T) : asObject(value) ? (Object.fromEntries(Object.entries(value as JsonObject).map(([k, v]) => [k, copy(v)])) as T) : value);

/**
 * The frozen part of a spliced GLB: every array cut to the layout's length, the scene to its first roots, the buffers to their lengths
 * and the binary chunk with them. For a file `spliceRoots` made from a base, this is that base, byte for byte once written.
 */
export function frozenBase(glb: Glb, layout: FrozenLayout): Glb {
  const json = copy(glb.json);
  for (const key of SPLICED_ARRAYS) {
    if (!Array.isArray(json[key])) continue;
    const kept = (json[key] as Json[]).slice(0, layout.counts[key]);
    if (kept.length === 0 && layout.counts[key] === 0) delete json[key];
    else json[key] = kept;
  }
  const scene = asObject(list(json, 'scenes')[num(json.scene)]);
  if (scene) scene.nodes = list(scene, 'nodes').slice(0, layout.sceneNodes);
  list(json, 'buffers').forEach((buffer, i) => {
    const object = asObject(buffer);
    if (object && layout.bufferBytes[i] !== undefined) object.byteLength = new RawNumber(String(layout.bufferBytes[i]));
  });
  for (const key of ['extensionsUsed', 'extensionsRequired'] as const) {
    if (layout[key].length > 0) json[key] = [...layout[key]];
    else delete json[key];
  }
  // The binary chunk: buffer 0 of a GLB (the one without a uri).
  const binBytes = layout.bufferBytes[0] ?? 0;
  return { json, bin: glb.bin.slice(0, binBytes) };
}

/** The GLB's own binary buffer (no uri, not a meshopt fallback) and its fallback buffer, by index; -1 when absent. */
function bufferRoles(json: JsonObject): { bin: number; fallback: number } {
  let bin = -1;
  let fallback = -1;
  list(json, 'buffers').forEach((buffer, i) => {
    const object = asObject(buffer);
    if (!object || object.uri !== undefined) return;
    const meshopt = asObject(asObject(object.extensions)?.EXT_meshopt_compression);
    if (meshopt?.fallback === true) fallback = fallback < 0 ? i : fallback;
    else bin = bin < 0 ? i : bin;
  });
  return { bin, fallback };
}

const align = (n: number, to = 16) => Math.ceil(n / to) * to;

/** The bytes a bufferView of a GLB holds (in its binary chunk), or null for one in a fallback buffer. */
function viewBytes(glb: Glb, index: number): Uint8Array | null {
  const view = asObject(list(glb.json, 'bufferViews')[index]);
  if (!view || num(view.buffer) !== bufferRoles(glb.json).bin) return null;
  const offset = num(view.byteOffset);
  return glb.bin.subarray(offset, offset + num(view.byteLength));
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, i) => byte === b[i]);

/**
 * `base` with every root of `extra`'s scene appended: extra's buffers' bytes after base's (16-byte aligned), each entity of extra after
 * base's with its references renumbered. A sampler, an image (its bytes), a texture or a material of extra that is the same as one of
 * base's is base's (the merged robot then draws a shared material in one call). Nothing of base changes but the lengths of its buffers,
 * its scene's root list and the extension lists, so `frozenBase(result, layoutOf(base))` is `base`.
 */
export function spliceRoots(base: Glb, extra: Glb): Glb {
  const json = copy(base.json);
  const add = (key: string, value: Json): number => {
    const array = Array.isArray(json[key]) ? (json[key] as Json[]) : (json[key] = []);
    array.push(value);
    return array.length - 1;
  };
  const baseRoles = bufferRoles(json);
  const extraRoles = bufferRoles(extra.json);
  const buffers = list(json, 'buffers');
  // The binary chunk: base's, aligned, then extra's.
  if (baseRoles.bin < 0) throw new Error('the base GLB has no binary buffer');
  const binAt = align(base.bin.length);
  const bin = new Uint8Array(binAt + extra.bin.length);
  bin.set(base.bin, 0);
  bin.set(extra.bin, binAt);
  // The meshopt fallback: a length only (no bytes), extra's after base's.
  let fallbackIndex = baseRoles.fallback;
  let fallbackAt = 0;
  if (extraRoles.fallback >= 0) {
    if (fallbackIndex < 0) fallbackIndex = add('buffers', { byteLength: 0, extensions: { EXT_meshopt_compression: { fallback: true } } });
    const fallback = asObject(list(json, 'buffers')[fallbackIndex])!;
    fallbackAt = align(num(fallback.byteLength));
    fallback.byteLength = fallbackAt + num(asObject(list(extra.json, 'buffers')[extraRoles.fallback])?.byteLength);
  }
  const binBuffer = asObject(buffers[baseRoles.bin])!;
  binBuffer.byteLength = bin.length;
  const bufferMap = (index: number): { to: number; shift: number } => {
    if (index === extraRoles.bin) return { to: baseRoles.bin, shift: binAt };
    if (index === extraRoles.fallback) return { to: fallbackIndex, shift: fallbackAt };
    throw new Error(`buffer ${index} of the spliced GLB is neither its binary chunk nor its meshopt fallback`);
  };

  const viewMap = list(extra.json, 'bufferViews').map((entry) => {
    const view = copy(asObject(entry)!);
    const target = bufferMap(num(view.buffer));
    view.buffer = target.to;
    view.byteOffset = num(view.byteOffset) + target.shift;
    const meshopt = asObject(asObject(view.extensions)?.EXT_meshopt_compression);
    if (meshopt) {
      const compressed = bufferMap(num(meshopt.buffer));
      meshopt.buffer = compressed.to;
      meshopt.byteOffset = num(meshopt.byteOffset) + compressed.shift;
    }
    return add('bufferViews', view);
  });
  const accessorMap = list(extra.json, 'accessors').map((entry) => {
    const accessor = copy(asObject(entry)!);
    if (accessor.bufferView !== undefined) accessor.bufferView = viewMap[num(accessor.bufferView)]!;
    const sparse = asObject(accessor.sparse);
    for (const part of [asObject(sparse?.indices), asObject(sparse?.values)]) if (part) part.bufferView = viewMap[num(part.bufferView)]!;
    return add('accessors', accessor);
  });
  const findSame = (key: string, text: string, limit: number) => list(json, key).slice(0, limit).findIndex((item) => stringifyRawJson(item) === text);
  const baseCounts = layoutOf(base).counts;
  const samplerMap = list(extra.json, 'samplers').map((entry) => {
    const same = findSame('samplers', stringifyRawJson(entry), baseCounts.samplers);
    return same >= 0 ? same : add('samplers', copy(entry));
  });
  const imageMap = list(extra.json, 'images').map((entry) => {
    const image = copy(asObject(entry)!);
    const bytes = image.bufferView === undefined ? null : viewBytes(extra, num(image.bufferView));
    if (bytes) {
      const same = list(json, 'images')
        .slice(0, baseCounts.images)
        .findIndex((other) => {
          const object = asObject(other);
          const otherBytes = object?.bufferView === undefined ? null : viewBytes(base, num(object.bufferView));
          return object?.mimeType === image.mimeType && otherBytes !== null && sameBytes(otherBytes, bytes);
        });
      if (same >= 0) return same;
    }
    if (image.bufferView !== undefined) image.bufferView = viewMap[num(image.bufferView)]!;
    return add('images', image);
  });
  const textureMap = list(extra.json, 'textures').map((entry) => {
    const texture = copy(asObject(entry)!);
    if (texture.source !== undefined) texture.source = imageMap[num(texture.source)]!;
    if (texture.sampler !== undefined) texture.sampler = samplerMap[num(texture.sampler)]!;
    for (const extension of Object.values(asObject(texture.extensions) ?? {})) {
      const object = asObject(extension);
      if (object?.source !== undefined) object.source = imageMap[num(object.source)]!;
    }
    const same = findSame('textures', stringifyRawJson(texture), baseCounts.textures);
    return same >= 0 ? same : add('textures', texture);
  });
  /** Renumbers every texture reference (`…Texture: {index}`) inside a material. */
  const retexture = (value: Json): void => {
    const object = asObject(value);
    if (!object) {
      if (Array.isArray(value)) value.forEach(retexture);
      return;
    }
    for (const [key, item] of Object.entries(object)) {
      const ref = asObject(item);
      if (key.endsWith('Texture') && ref && ref.index !== undefined) ref.index = textureMap[num(ref.index)]!;
      else retexture(item);
    }
  };
  const materialMap = list(extra.json, 'materials').map((entry) => {
    const material = copy(asObject(entry)!);
    retexture(material);
    const same = findSame('materials', stringifyRawJson(material), baseCounts.materials);
    return same >= 0 ? same : add('materials', material);
  });
  const meshMap = list(extra.json, 'meshes').map((entry) => {
    const mesh = copy(asObject(entry)!);
    for (const primitive of list(mesh, 'primitives')) {
      const p = asObject(primitive)!;
      const attributes = asObject(p.attributes) ?? {};
      for (const name of Object.keys(attributes)) attributes[name] = accessorMap[num(attributes[name])]!;
      if (p.indices !== undefined) p.indices = accessorMap[num(p.indices)]!;
      if (p.material !== undefined) p.material = materialMap[num(p.material)]!;
      for (const target of list(p, 'targets')) {
        const t = asObject(target)!;
        for (const name of Object.keys(t)) t[name] = accessorMap[num(t[name])]!;
      }
    }
    return add('meshes', mesh);
  });
  const nodeOffset = list(json, 'nodes').length;
  for (const entry of list(extra.json, 'nodes')) {
    const node = copy(asObject(entry)!);
    if (node.mesh !== undefined) node.mesh = meshMap[num(node.mesh)]!;
    if (Array.isArray(node.children)) node.children = node.children.map((child) => num(child) + nodeOffset);
    if (node.camera !== undefined || node.skin !== undefined) throw new Error('a spliced root has a camera or a skin');
    add('nodes', node);
  }
  const scene = asObject(list(json, 'scenes')[num(json.scene)]);
  const extraScene = asObject(list(extra.json, 'scenes')[num(extra.json.scene)]);
  if (!scene || !extraScene) throw new Error('a GLB without a scene');
  scene.nodes = [...list(scene, 'nodes'), ...list(extraScene, 'nodes').map((node) => num(node) + nodeOffset)];
  for (const key of ['extensionsUsed', 'extensionsRequired'] as const) {
    const names = [...(list(json, key) as string[])];
    for (const name of list(extra.json, key) as string[]) if (!names.includes(name)) names.push(name);
    if (names.length > 0) json[key] = names;
  }
  return { json, bin };
}

/** The names of a GLB's scene roots, in order. */
export function rootNames({ json }: Glb): string[] {
  const scene = asObject(list(json, 'scenes')[num(json.scene)]);
  const nodes = list(json, 'nodes');
  return (scene ? list(scene, 'nodes') : []).map((index) => String(asObject(nodes[num(index)])?.name ?? ''));
}
