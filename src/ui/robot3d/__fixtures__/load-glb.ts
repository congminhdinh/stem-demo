import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { robotAssetsOf, ROBOT_ASSET_FILES, type RobotAssets } from '../assets/robot-assets';
import type { Detail } from '../lighting/look';

// Tests only (N18 R4.7): the committed GLBs of public/robot3d/ parsed in Node by three's own GLTFLoader and meshopt decoder. Node has no
// image decoder, so the files' images and textures are taken out of their JSON first; every geometry, node and material stays.

const publicDir = join(import.meta.dirname, '..', '..', '..', '..', 'public');

/** A GLB's JSON chunk and its binary chunk. */
export function readGlb(path: string): { json: Record<string, unknown> & { [key: string]: unknown }; bin: Buffer } {
  const buffer = readFileSync(path);
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8')) as Record<string, unknown>;
  const binStart = 20 + jsonLength;
  const binLength = buffer.readUInt32LE(binStart);
  return { json, bin: buffer.subarray(binStart + 8, binStart + 8 + binLength) };
}

function withoutImages(path: string): ArrayBuffer {
  const { json, bin } = readGlb(path);
  delete json.images;
  delete json.textures;
  delete json.samplers;
  const strip = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const key of Object.keys(value)) {
      if (/Texture$/.test(key)) delete (value as Record<string, unknown>)[key];
      else strip((value as Record<string, unknown>)[key]);
    }
  };
  strip(json.materials);
  for (const list of ['extensionsUsed', 'extensionsRequired']) {
    if (Array.isArray(json[list])) json[list] = (json[list] as string[]).filter((name) => name !== 'EXT_texture_webp');
  }
  const text = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonChunk = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const binChunk = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4, 0)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
  const chunk = (type: number, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32LE(data.length, 0);
    head.writeUInt32LE(type, 4);
    return Buffer.concat([head, data]);
  };
  const glb = Buffer.concat([header, chunk(0x4e4f534a, jsonChunk), chunk(0x004e4942, binChunk)]);
  return glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
}

export async function parseGlb(path: string): Promise<GLTF> {
  await MeshoptDecoder.ready;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return new Promise((resolve, reject) => loader.parse(withoutImages(path), '', resolve, reject));
}

export const assetPath = (file: string) => join(publicDir, file);

/** The committed assets of a tier, as the view gets them. */
export async function loadTestAssets(detail: Detail): Promise<RobotAssets> {
  const files = ROBOT_ASSET_FILES[detail];
  const [kit, props] = await Promise.all([parseGlb(assetPath(files.kit)), parseGlb(assetPath(files.props))]);
  return robotAssetsOf(kit, props);
}
