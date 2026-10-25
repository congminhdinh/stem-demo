import type { Material, Object3D, Texture } from 'three';
import { DoubleSide, Mesh } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { Detail } from '../lighting/look';
import manifest from './robot-assets.manifest.json';

// The robot lab's 3D assets (N18 R4.7): two binary glTFs modelled in Blender by the committed scripts of assets-src/robot3d/ and built
// by `pnpm build:robot-assets` into public/robot3d/: robot-kit.glb (every robot part, a root `part_*` each, its origin at its kit
// mount) and arena-props.glb (`prop_*`: walls, props, the table, the studio), each also as a `-low` file of the low tier's level of
// detail (half the segments). A tier's pair is fetched once per page, lazily, when a 3D view of that tier first mounts, and kept: a
// second view (Try again, a return to the tier) clones the same templates. A scene's GPU copies are freed when it
// unmounts (`releaseGpu`); the next scene uploads them again from the kept data. When a file does not load or parse, the promise gives
// null and the view draws its procedural fallback (RobotView, ArenaView) for the rest of the page: the lab still works.

export type RobotAssets = {
  /** A robot part's template (`part_chassis`, `part_wheel`…), or null when the kit file has none of that name. */
  part(name: string): Object3D | null;
  /** An arena prop's template (`prop_wall`, `prop_cone`…), or null. */
  prop(name: string): Object3D | null;
  /** Frees the templates' GPU copies (geometries, materials, textures); the data stays for the next scene. */
  releaseGpu(): void;
};

export const ROBOT_ASSET_FILES: Readonly<Record<Detail, { kit: string; props: string }>> = {
  high: { kit: 'robot3d/robot-kit.glb', props: 'robot3d/arena-props.glb' },
  low: { kit: 'robot3d/robot-kit-low.glb', props: 'robot3d/arena-props-low.glb' },
};

/** The templates of a parsed glTF by root name: every direct child of the scene. */
function rootsOf(gltf: GLTF): Map<string, Object3D> {
  const roots = new Map<string, Object3D>();
  for (const child of gltf.scene.children) roots.set(child.name, child);
  return roots;
}

/** Every geometry, material and texture under `roots`, once each. */
export function gpuResources(roots: Iterable<Object3D>): { geometries: Set<{ dispose(): void }>; materials: Set<Material>; textures: Set<Texture> } {
  const geometries = new Set<{ dispose(): void }>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  for (const root of roots) {
    root.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      geometries.add(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value && typeof value === 'object' && (value as Texture).isTexture) textures.add(value as Texture);
      }
    });
  }
  return { geometries, materials, textures };
}

/** Wraps two parsed glTFs as the view's assets. */
export function robotAssetsOf(kit: GLTF, props: GLTF): RobotAssets {
  const parts = rootsOf(kit);
  const propRoots = rootsOf(props);
  // A clear double-sided sheet (the carport's roof) in one pass: two would be two shader programs to compile, for no visible difference.
  for (const material of gpuResources([...parts.values(), ...propRoots.values()]).materials) {
    if (material.transparent && material.side === DoubleSide) material.forceSinglePass = true;
  }
  return {
    part: (name) => parts.get(name) ?? null,
    prop: (name) => propRoots.get(name) ?? null,
    releaseGpu() {
      const { geometries, materials, textures } = gpuResources([...parts.values(), ...propRoots.values()]);
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
    },
  };
}

const loading = new Map<Detail, Promise<RobotAssets | null>>();

/** Loads a tier's two files, once per page (the same promise every call, so React's `use` can wait on it). `base` is the app's base URL. */
export function loadRobotAssets(detail: Detail, base: string = import.meta.env.BASE_URL): Promise<RobotAssets | null> {
  const known = loading.get(detail);
  if (known) return known;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  // The file's own hash in its URL: a rebuilt file is a new URL, so a host may cache each one for good.
  const versions = manifest.assets as Readonly<Record<string, { sha256: string }>>;
  const url = (file: string) => `${base.endsWith('/') ? base : `${base}/`}${file}?v=${versions[file.split('/').pop()!]?.sha256.slice(0, 12) ?? '0'}`;
  const files = ROBOT_ASSET_FILES[detail];
  const attempt = Promise.all([loader.loadAsync(url(files.kit)), loader.loadAsync(url(files.props))])
    .then(([kit, props]) => robotAssetsOf(kit, props))
    .catch((error: unknown) => {
      console.warn('The robot lab’s 3D models did not load; the view draws its simple shapes.', error);
      return null;
    });
  loading.set(detail, attempt);
  return attempt;
}
