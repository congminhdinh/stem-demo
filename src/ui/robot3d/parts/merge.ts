import { BufferAttribute, BufferGeometry, Color, Float32BufferAttribute, FrontSide, Group, Matrix4, Mesh, MeshLambertMaterial, MeshStandardMaterial, type Material, type Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Merging the 3D view's static parts (N18 R4.7): a robot of a dozen modelled parts, each a few meshes, draws in one call per material
// once the parts that never move against the robot are merged into it (`mergeStatic`); the parts that move or change (a wheel, the
// servo's horn, an LED) stay their own nodes, marked `userData.moves`. On the low tier (`plain`) every opaque material without a
// texture is baked into the vertex colours (its colour times the baked ambient occlusion already there), so all of them draw as one
// mesh of one cheap material: a software renderer pays for every draw and every lit pixel. The merged geometries are the caller's.

/** A copy of `geometry` with positions, normals, uvs and colours only, indexed, in the frame `matrix` takes it to. */
function prepared(geometry: BufferGeometry, matrix: Matrix4, colour: 'keep' | 'drop' | Color): BufferGeometry {
  const copy = new BufferGeometry();
  for (const name of ['position', 'normal', 'uv'] as const) {
    const attribute = geometry.getAttribute(name);
    if (attribute) copy.setAttribute(name, (attribute as BufferAttribute).clone());
  }
  const count = copy.getAttribute('position').count;
  const source = geometry.getAttribute('color') as BufferAttribute | undefined;
  if (colour === 'keep' && source) copy.setAttribute('color', source.clone());
  if (colour instanceof Color) {
    // The material's colour (linear) times the baked occlusion (or 1), as plain floats.
    const rgb = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const ao = source ? source.getX(i) : 1;
      rgb[i * 3] = colour.r * ao;
      rgb[i * 3 + 1] = colour.g * (source ? source.getY(i) : 1);
      rgb[i * 3 + 2] = colour.b * (source ? source.getZ(i) : 1);
    }
    copy.setAttribute('color', new Float32BufferAttribute(rgb, 3));
  }
  if (!copy.getAttribute('normal')) copy.computeVertexNormals();
  if (!copy.getAttribute('uv')) copy.setAttribute('uv', new BufferAttribute(new Float32Array(count * 2), 2));
  // Typed all the way (a part's index is copied, never boxed into a list): this runs for every part while the view is made.
  const index = new Uint32Array(geometry.index ? geometry.index.count : count);
  if (geometry.index) index.set(geometry.index.array);
  else for (let i = 0; i < count; i++) index[i] = i;
  // A mirrored part (the right wheel's motor) would turn its faces inside out once baked: keep them facing out.
  if (matrix.determinant() < 0) {
    for (let i = 0; i < index.length; i += 3) {
      const swap = index[i + 1]!;
      index[i + 1] = index[i + 2]!;
      index[i + 2] = swap;
    }
  }
  copy.setIndex(new BufferAttribute(index, 1));
  copy.applyMatrix4(matrix);
  return copy;
}

/** Whether `node` or one of its ancestors up to `root` moves. */
function moves(node: Object3D, root: Object3D): boolean {
  for (let at: Object3D | null = node; at && at !== root; at = at.parent) if (at.userData.moves) return true;
  return false;
}

/** A material the low tier bakes into vertex colours: opaque, one colour, no texture, no light of its own. */
function isPlain(material: Material): material is MeshStandardMaterial {
  if (!(material instanceof MeshStandardMaterial) || material.side !== FrontSide) return false;
  return !material.map && !material.transparent && material.alphaTest === 0 && (material.emissiveIntensity === 0 || material.emissive.getHex() === 0);
}

export type MergeOptions = {
  castShadow: boolean;
  receiveShadow: boolean;
  /** The low tier's one material for every plain part (vertex colours); null keeps each material. */
  plain?: MeshLambertMaterial | null;
  /** The material a mesh draws with (the low tier's cheaper copy of a textured one). */
  swap?: (material: Material) => Material;
};

/**
 * Merges every mesh under `root` that does not move into one mesh per material, in `root`'s frame, and takes the originals out
 * (their geometries are templates' and are left alone). Returns the merged meshes, already added to `root`.
 */
export function mergeStatic(root: Group, options: MergeOptions): Mesh[] {
  root.updateMatrixWorld(true);
  const toRoot = new Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<Material, BufferGeometry[]>();
  const merged: Mesh[] = [];
  const sources: Mesh[] = [];
  root.traverse((node) => {
    if (node instanceof Mesh && !Array.isArray(node.material) && !moves(node, root)) sources.push(node);
  });
  for (const mesh of sources) {
    const original = mesh.material as Material;
    const matrix = new Matrix4().multiplyMatrices(toRoot, mesh.matrixWorld);
    let material: Material;
    let geometry: BufferGeometry;
    if (options.plain && isPlain(original)) {
      material = options.plain;
      geometry = prepared(mesh.geometry, matrix, original.color);
    } else {
      material = options.swap ? options.swap(original) : original;
      geometry = prepared(mesh.geometry, matrix, material.vertexColors ? 'keep' : 'drop');
    }
    const list = groups.get(material) ?? [];
    list.push(geometry);
    groups.set(material, list);
    mesh.removeFromParent();
  }
  for (const [material, geometries] of groups) {
    const geometry = mergeGeometries(geometries, false);
    for (const part of geometries) part.dispose();
    if (!geometry) continue;
    const mesh = new Mesh(geometry, material);
    mesh.name = `merged_${material.name}`;
    mesh.castShadow = options.castShadow;
    mesh.receiveShadow = options.receiveShadow;
    mesh.userData.merged = true;
    root.add(mesh);
    merged.push(mesh);
  }
  return merged;
}

/**
 * The low tier's materials: a Lambert copy of each standard one (its colour, texture, vertex colours, emission, transparency), made
 * once per scene and kept in `cache`; and the one plain material the parts without texture share.
 */
export function lowTierMaterials(cache: Map<Material, Material>) {
  const swap = (material: Material): Material => {
    if (!(material instanceof MeshStandardMaterial)) return material;
    let copy = cache.get(material);
    if (!copy) {
      copy = lambertOf(material);
      cache.set(material, copy);
    }
    return copy;
  };
  const plain = new MeshLambertMaterial({ name: 'plain-low', vertexColors: true });
  cache.set(plain, plain);
  return { swap, plain };
}

/**
 * A Lambert material that looks like `material` without its specular light: colour, texture, vertex colours, emission (N19 E6: with its
 * emissive map, which limits the gripper's glow to its LED; N18's materials have none), alpha.
 */
export function lambertOf(material: MeshStandardMaterial): MeshLambertMaterial {
  return new MeshLambertMaterial({
    name: `${material.name}-low`,
    color: material.color,
    map: material.map,
    aoMap: material.aoMap,
    vertexColors: material.vertexColors,
    emissive: material.emissive,
    emissiveMap: material.emissiveMap,
    emissiveIntensity: material.emissiveIntensity,
    transparent: material.transparent,
    opacity: material.opacity,
    side: material.side,
    forceSinglePass: material.forceSinglePass,
    depthWrite: material.depthWrite,
  });
}

/**
 * The low tier's moving parts (a wheel, the servo's arm, an LED…) drawn with the plain material too: each plain mesh gets its own copy
 * of its geometry with its colour baked into three-channel vertex colours, so it shares the merged parts' shader program; a part whose
 * glow the view sets (`glows`, its own Lambert copy) keeps its material, turned white over the baked colour. A software renderer compiles
 * every program on its first frame, measured at tens of milliseconds each. The new geometries go into `owned`.
 */
export function bakeMovingPlain(root: Object3D, plain: MeshLambertMaterial, glows: ReadonlySet<Material>, owned: BufferGeometry[]): void {
  const identity = new Matrix4();
  root.traverse((node) => {
    if (!(node instanceof Mesh) || node.userData.merged || Array.isArray(node.material)) return;
    const material = node.material as Material;
    const glow = glows.has(material);
    if (!glow && !isPlain(material)) return;
    if (!(material instanceof MeshStandardMaterial || material instanceof MeshLambertMaterial) || material.side !== FrontSide || material.map || material.transparent) return;
    const geometry = prepared(node.geometry, identity, material.color.clone());
    owned.push(geometry);
    node.geometry = geometry;
    if (glow) {
      material.color.set('#ffffff');
      material.vertexColors = true;
      material.needsUpdate = true;
    } else {
      node.material = plain;
    }
  });
}

/** Swaps every material under `node` for its low-tier copy (the moving parts, which are not merged). */
export function swapMaterials(node: Object3D, swap: (material: Material) => Material): void {
  node.traverse((child) => {
    if (child instanceof Mesh && !Array.isArray(child.material)) child.material = swap(child.material as Material);
  });
}
