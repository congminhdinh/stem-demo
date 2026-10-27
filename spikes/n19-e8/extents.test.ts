// N19 E8 spike: the gripper's parts' extents across the car (cm) in each GLB, in each part's own frame: nothing past the physics' ±6.8 cm
// cross bar but the boom's two screw heads (E6/E7 re-review N1: the shaft's end was 1 mm proud).
//   SPIKE=extents pnpm exec vitest run --config spikes/n19-e8/vitest.config.ts extents
import { join } from 'node:path';
import { Box3, Mesh, Vector3, type BufferAttribute } from 'three';
import { it } from 'vitest';
import { parseGlb } from '../../src/ui/robot3d/__fixtures__/load-glb';

it.runIf(process.env.SPIKE === 'extents')('measures the gripper parts across', async () => {
  for (const file of ['robot-kit.glb', 'robot-kit-low.glb']) {
    const gltf = await parseGlb(join(import.meta.dirname, '..', '..', 'public', 'robot3d', file));
    const rows: string[] = [];
    for (const name of ['part_gripper_boom', 'part_gripper_bracket', 'part_gripper_carriage', 'part_gripper_link']) {
      const part = gltf.scene.getObjectByName(name);
      if (!part) continue;
      part.updateMatrixWorld(true);
      const toPart = part.matrixWorld.clone().invert();
      const meshes: string[] = [];
      const box = new Box3();
      part.traverse((node) => {
        if (!(node instanceof Mesh)) return;
        const pos = node.geometry.getAttribute('position') as BufferAttribute;
        const own = new Box3();
        for (let i = 0; i < pos.count; i++) own.expandByPoint(new Vector3().fromBufferAttribute(pos, i).applyMatrix4(node.matrixWorld).applyMatrix4(toPart));
        box.union(own);
        meshes.push(`${node.name} z ${(own.min.z * 100).toFixed(3)}..${(own.max.z * 100).toFixed(3)}`);
      });
      rows.push(`${name}: across (three z) ${(box.min.z * 100).toFixed(3)}..${(box.max.z * 100).toFixed(3)} cm; ${meshes.join('; ')}`);
    }
    process.stdout.write(`${file}\n${rows.join('\n')}\n`);
  }
});
