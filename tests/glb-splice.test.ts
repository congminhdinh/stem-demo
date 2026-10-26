import { describe, expect, it } from 'vitest';
import { frozenBase, layoutOf, parseRawJson, RawNumber, readGlb, rootNames, spliceRoots, stringifyRawJson, writeGlb, type Glb, type JsonObject } from '../scripts/lib/glb-splice';

// N19 E6/E7: scripts/lib/glb-splice.ts appends the N19 roots Blender builds to the robot lab's GLBs and keeps their N18 roots byte for
// byte (scripts/build-robot-assets.mjs). Here on small GLBs made in the test: numbers are written back as they were read, every
// reference of the appended roots is renumbered, a shared material or image is the base's, and the base comes back exactly.

/** A GLB of one root `name` with one triangle (meshopt-style views: a fallback buffer and the binary chunk), a material and an image. */
function tinyGlb(name: string, material: JsonObject, imageBytes: number[], extra = 0): Glb {
  const bin = new Uint8Array([...Array.from({ length: 16 + extra }, (_, i) => (i * 7 + name.length) & 0xff), ...imageBytes]);
  const json = parseRawJson(
    JSON.stringify({
      asset: { version: '2.0' },
      extensionsUsed: ['EXT_meshopt_compression', 'EXT_texture_webp'],
      scene: 0,
      scenes: [{ name: 'Scene', nodes: [1] }],
      nodes: [{ mesh: 0, name: `${name}_mesh`, translation: [0, 0.019999999552965164, 0] }, { children: [0], name }],
      materials: [material],
      meshes: [{ name, primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
      textures: [{ extensions: { EXT_texture_webp: { source: 0 } }, sampler: 0 }],
      images: [{ bufferView: 2, mimeType: 'image/webp', name: 'img' }],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, max: [1e-5, 1, 0], min: [-3.7608202546834946e-5, 0, 0], type: 'VEC3' },
        { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
      ],
      bufferViews: [
        { buffer: 1, byteLength: 36, byteOffset: 0, extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: 0, byteLength: 8, byteStride: 12, count: 3, mode: 'ATTRIBUTES' } } },
        { buffer: 1, byteLength: 6, byteOffset: 36, extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: 8, byteLength: 8, byteStride: 2, count: 3, mode: 'TRIANGLES' } } },
        { buffer: 0, byteLength: imageBytes.length, byteOffset: 16 + extra },
      ],
      samplers: [{ magFilter: 9729, minFilter: 9987 }],
      buffers: [{ byteLength: bin.length }, { byteLength: 44, extensions: { EXT_meshopt_compression: { fallback: true } } }],
    }).replace('"max":[0.00001,', '"max":[1e-05,'),
  ) as JsonObject;
  return { json, bin };
}

const steel = { name: 'steel', pbrMetallicRoughness: { metallicFactor: 1, roughnessFactor: 0.25 } };
const textured = { name: 'pcb', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } };

describe('GLB splicing (N19 E6/E7)', () => {
  it('reads and writes JSON numbers as their text, so Python’s float repr survives (1e-05, -3.7608202546834946e-05)', () => {
    const text = '{"a":[1e-05,-3.7608202546834946e-05,1.0,0.019999999552965164],"b":{"c":"x"}}';
    const value = parseRawJson(text) as JsonObject;
    expect((value.a as RawNumber[]).map(Number)).toEqual([1e-5, -3.7608202546834946e-5, 1, 0.019999999552965164]);
    expect(stringifyRawJson(value)).toBe(text);
    // A number read as a JavaScript number would lose that text: only integers (indices, offsets) are written from numbers.
    expect(() => stringifyRawJson(JSON.parse(text) as JsonObject)).toThrow(RangeError);
  });

  it('writes a GLB it read to the same bytes', () => {
    const glb = writeGlb(tinyGlb('part_a', steel, [1, 2, 3, 4, 5]));
    expect(writeGlb(readGlb(glb))).toEqual(glb);
    expect(glb.length % 4).toBe(0);
  });

  it('appends the extra GLB’s roots, renumbering every reference, its bytes after the base’s', () => {
    const base = tinyGlb('part_a', steel, [1, 2, 3, 4, 5]);
    const extra = tinyGlb('part_b', textured, [9, 9, 9], 4);
    const spliced = spliceRoots(base, extra);
    expect(rootNames(spliced)).toEqual(['part_a', 'part_b']);
    const json = JSON.parse(stringifyRawJson(spliced.json));
    expect(json.nodes[3]).toEqual({ children: [2], name: 'part_b' });
    expect(json.nodes[2].mesh).toBe(1);
    expect(json.meshes[1].primitives[0]).toEqual({ attributes: { POSITION: 2 }, indices: 3, material: 1 });
    expect(json.accessors[2].bufferView).toBe(3);
    // Extra's views moved after the base's bytes (aligned to 16) and after its fallback's length.
    const binAt = Math.ceil(base.bin.length / 16) * 16;
    expect(json.bufferViews[3].extensions.EXT_meshopt_compression.byteOffset).toBe(binAt);
    expect(json.bufferViews[3].byteOffset).toBe(48);
    expect(json.bufferViews[5]).toEqual({ buffer: 0, byteLength: 3, byteOffset: binAt + 20 });
    expect(json.images[1]).toEqual({ bufferView: 5, mimeType: 'image/webp', name: 'img' });
    expect(json.textures[1].extensions.EXT_texture_webp.source).toBe(1);
    expect(json.materials[1].pbrMetallicRoughness.baseColorTexture.index).toBe(1);
    expect(json.buffers).toEqual([{ byteLength: binAt + extra.bin.length }, { byteLength: 48 + 44, extensions: { EXT_meshopt_compression: { fallback: true } } }]);
    expect(Array.from(spliced.bin.subarray(binAt))).toEqual(Array.from(extra.bin));
    // The sampler is the same as the base's: shared.
    expect(json.samplers).toHaveLength(1);
    expect(json.textures[1].sampler).toBe(0);
  });

  it('shares a material and an image that the base already has (one draw for a shared material, no second copy of an image)', () => {
    const base = tinyGlb('part_a', textured, [1, 2, 3, 4, 5]);
    const spliced = JSON.parse(stringifyRawJson(spliceRoots(base, tinyGlb('part_b', textured, [1, 2, 3, 4, 5], 4)).json));
    expect(spliced.images).toHaveLength(1);
    expect(spliced.textures).toHaveLength(1);
    expect(spliced.materials).toHaveLength(1);
    expect(spliced.meshes[1].primitives[0].material).toBe(0);
  });

  it('gives the base back byte for byte from a spliced file (its frozen part)', () => {
    const base = tinyGlb('part_a', steel, [1, 2, 3, 4, 5]);
    const spliced = readGlb(writeGlb(spliceRoots(base, tinyGlb('part_b', textured, [9, 9, 9], 4))));
    expect(writeGlb(frozenBase(spliced, layoutOf(base)))).toEqual(writeGlb(base));
    expect(layoutOf(base).counts).toEqual({ buffers: 2, bufferViews: 3, accessors: 2, samplers: 1, images: 1, textures: 1, materials: 1, meshes: 1, nodes: 2 });
  });
});
