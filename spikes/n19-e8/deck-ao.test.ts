// N19 E8 spike: the baked ambient occlusion (COLOR_0) on the top of the chassis's deck, low and high tier, round the rover's buzzer spot
// (−5, 3) and the places beside it, to judge the "faint buzzer mark" on the gripper car's deck (E6/E7 re-review N3).
//   SPIKE=deck pnpm exec vitest run --config spikes/n19-e8/vitest.config.ts deck-ao
import { join } from 'node:path';
import { Mesh, type BufferAttribute } from 'three';
import { it } from 'vitest';
import { parseGlb } from '../../src/ui/robot3d/__fixtures__/load-glb';

it.runIf(process.env.SPIKE === 'deck')('reads the deck AO', async () => {
  for (const file of ['robot-kit-low.glb', 'robot-kit.glb']) {
    const gltf = await parseGlb(join(import.meta.dirname, '..', '..', 'public', 'robot3d', file));
    const chassis = gltf.scene.getObjectByName('part_chassis')!;
    chassis.updateMatrixWorld(true);
    const rows: string[] = [];
    let topY = -Infinity;
    const meshes: Mesh[] = [];
    chassis.traverse((node) => node instanceof Mesh && meshes.push(node));
    // three: x forward, y up, z right (robot y left = −z). The deck's top: the highest flat face.
    const heights = new Map<number, number>();
    for (const mesh of meshes) {
      const pos = mesh.geometry.getAttribute('position') as BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const p = mesh.localToWorld(mesh.position.clone().set(pos.getX(i), pos.getY(i), pos.getZ(i)));
        if (Math.hypot(p.x * 100 + 3, -p.z * 100 - 0) > 5) continue;
        const key = Math.round(p.y * 10000);
        heights.set(key, (heights.get(key) ?? 0) + 1);
      }
    }
    process.stdout.write(`${file} heights near (-3, 0): ${[...heights].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k / 100} cm ×${n}`).join(', ')}\n`);
    topY = [...heights].sort((a, b) => b[1] - a[1]).map(([k]) => k / 10000).filter((y) => y > 0.05).sort((a, b) => b - a)[0]!;
    const spots: Record<string, [number, number]> = { 'buzzer (-5, 3)': [-5, 3], 'led (-5, -3)': [-5, -3], 'mirror (5, 3)': [5, 3], 'side (-2, 4.5)': [-2, 4.5], 'rear (-6.5, 4)': [-6.5, 4] };
    for (const [name, [xCm, yCm]] of Object.entries(spots)) {
      const values: number[] = [];
      for (const mesh of meshes) {
        const pos = mesh.geometry.getAttribute('position') as BufferAttribute;
        const col = mesh.geometry.getAttribute('color') as BufferAttribute | undefined;
        if (!col) continue;
        for (let i = 0; i < pos.count; i++) {
          const p = mesh.localToWorld(mesh.position.clone().set(pos.getX(i), pos.getY(i), pos.getZ(i)));
          if (Math.abs(p.y - topY) > 0.0005) continue;
          if (Math.hypot(p.x * 100 - xCm, -p.z * 100 - yCm) > 1.6) continue;
          values.push(col.getX(i));
        }
      }
      values.sort((a, b) => a - b);
      rows.push(`${name}: ${values.length} vertices, AO min ${values[0]?.toFixed(3)} median ${values[Math.floor(values.length / 2)]?.toFixed(3)} max ${values.at(-1)?.toFixed(3)}`);
    }
    process.stdout.write(`${file} (deck top y ${(topY * 100).toFixed(2)} cm)\n${rows.join('\n')}\n`);
  }
});

it.runIf(process.env.SPIKE === 'deck')('pairs the buzzer spot with its mirror across x', async () => {
  for (const file of ['robot-kit-low.glb', 'robot-kit.glb']) {
    const gltf = await parseGlb(join(import.meta.dirname, '..', '..', 'public', 'robot3d', file));
    const chassis = gltf.scene.getObjectByName('part_chassis')!;
    chassis.updateMatrixWorld(true);
    const meshes: Mesh[] = [];
    chassis.traverse((node) => node instanceof Mesh && meshes.push(node));
    const out: string[] = [];
    for (const mesh of meshes) {
      const pos = mesh.geometry.getAttribute('position') as BufferAttribute;
      const col = mesh.geometry.getAttribute('color') as BufferAttribute | undefined;
      const nor = mesh.geometry.getAttribute('normal') as BufferAttribute | undefined;
      if (!col) continue;
      const key = (x: number, y: number, z: number) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
      const at = new Map<string, number[]>();
      for (let i = 0; i < pos.count; i++) {
        const k = key(pos.getX(i), pos.getY(i), pos.getZ(i));
        at.set(k, [...(at.get(k) ?? []), i]);
      }
      let [inside, paired, up] = [0, 0, 0];
      const pairs: string[] = [];
      for (let i = 0; i < pos.count; i++) {
        const p = mesh.localToWorld(mesh.position.clone().set(pos.getX(i), pos.getY(i), pos.getZ(i)));
        if (Math.hypot(p.x * 100 + 5, -p.z * 100 - 3) > 2.2) continue;
        if (p.y < 0.064 || p.y > 0.066) continue;
        inside += 1;
        if (nor && nor.getY(i) > 0.9) up += 1;
        const mirror = at.get(key(-pos.getX(i), pos.getY(i), pos.getZ(i)));
        if (mirror) {
          paired += 1;
          if (pairs.length < 6) pairs.push(`${col.getX(i).toFixed(2)}→${col.getX(mirror[0]!).toFixed(2)}`);
        }
      }
      if (inside > 0) out.push(`${mesh.name}: ${inside} deck vertices within 2.2 cm (${up} facing up), ${paired} with a mirror across x; ${pairs.join(' ')}`);
    }
    process.stdout.write(`${file}\n${out.join('\n')}\n`);
  }
});

it.runIf(process.env.SPIKE === 'deck')('looks for a clean twin of the buzzer spot under a translation of the deck', async () => {
  for (const file of ['robot-kit-low.glb', 'robot-kit.glb']) {
    const gltf = await parseGlb(join(import.meta.dirname, '..', '..', 'public', 'robot3d', file));
    const mesh = gltf.scene.getObjectByName('part_chassis')!.getObjectByName('chassis_plate_upper') as Mesh;
    const pos = mesh.geometry.getAttribute('position') as BufferAttribute;
    const col = mesh.geometry.getAttribute('color') as BufferAttribute;
    const key = (x: number, y: number, z: number) => `${Math.round(x * 2e4)},${Math.round(y * 2e4)},${Math.round(z * 2e4)}`;
    const at = new Map<string, number>();
    for (let i = 0; i < pos.count; i++) at.set(key(pos.getX(i), pos.getY(i), pos.getZ(i)), i);
    // The mesh's own frame (the part's): three's x forward, z right; print where the buzzer spot is in it.
    const near: number[] = [];
    for (let i = 0; i < pos.count; i++) if (Math.hypot(pos.getX(i) * 100 + 5, -pos.getZ(i) * 100 - 3) < 2.2 && pos.getY(i) > 0.0005) near.push(i);
    const rows: string[] = [`${file}: ${near.length} vertices of the upper plate within 2.2 cm of (-5, 3), y ${[...new Set(near.map((i) => (pos.getY(i) * 100).toFixed(2)))].join('/')}`];
    for (const [dx, dy] of Array.from({ length: 33 * 25 }, (_, k) => [-4 + (k % 33) * 0.5, -9 + Math.floor(k / 33) * 0.5])) {
      let matched = 0;
      const aos: number[] = [];
      for (const i of near) {
        const twin = at.get(key(pos.getX(i) + dx / 100, pos.getY(i), pos.getZ(i) - dy / 100));
        if (twin === undefined) continue;
        matched += 1;
        aos.push(col.getX(twin));
      }
      aos.sort((a, b) => a - b);
      if (matched < near.length * 0.9) continue;
      rows.push(`  twin +(${dx}, ${dy}) cm: ${matched}/${near.length} matched, twin AO min ${aos[0]?.toFixed(3)} median ${aos[Math.floor(aos.length / 2)]?.toFixed(3)}`);
    }
    process.stdout.write(`${rows.join('\n')}\n`);
  }
});

it.runIf(process.env.SPIKE === 'deck')('the open deck round the buzzer spot, and the AO along a line through it', async () => {
  for (const file of ['robot-kit-low.glb', 'robot-kit.glb']) {
    const gltf = await parseGlb(join(import.meta.dirname, '..', '..', 'public', 'robot3d', file));
    const mesh = gltf.scene.getObjectByName('part_chassis')!.getObjectByName('chassis_plate_upper') as Mesh;
    mesh.updateMatrixWorld(true);
    const pos = mesh.geometry.getAttribute('position') as BufferAttribute;
    const nor = mesh.geometry.getAttribute('normal') as BufferAttribute;
    const col = mesh.geometry.getAttribute('color') as BufferAttribute;
    const top: { x: number; y: number; ao: number }[] = [];
    for (let i = 0; i < pos.count; i++) {
      const p = mesh.localToWorld(mesh.position.clone().set(pos.getX(i), pos.getY(i), pos.getZ(i)));
      if (Math.abs(p.y - 0.065) > 0.0003 || nor.getY(i) < 0.9) continue;
      top.push({ x: p.x * 100, y: -p.z * 100, ao: col.getX(i) });
    }
    const board = (q: { x: number; y: number }) => q.x > -4.35 - 0.5 && q.x < 0.98 + 0.5 && Math.abs(q.y) < 3.43 + 0.5;
    const near = (q: { x: number; y: number }, [x, y]: [number, number], r: number) => Math.hypot(q.x - x, q.y - y) < r;
    const median = (list: number[]) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
    const ring = top.filter((q) => near(q, [-5, 3], 4.2) && !near(q, [-5, 3], 2.8) && !board(q) && !near(q, [-6.5, 0], 2.6) && !near(q, [-5, -3], 2.6));
    const open = top.filter((q) => !board(q) && ![[-5, 3], [-6.5, 0], [-5, -3], [1.5, 0], [7, 0]].some((m) => near(q, m as [number, number], 3)));
    process.stdout.write(`${file}: ${top.length} top vertices; ring round the spot ${ring.length}, median ${median(ring.map((q) => q.ao))?.toFixed(3)}; open deck ${open.length}, median ${median(open.map((q) => q.ao))?.toFixed(3)}\n`);
    const square = top.filter((q) => Math.abs(q.x + 5) <= 1.15 && Math.abs(q.y - 3) <= 1.15);
    process.stdout.write(`  the buzzer board's square (±1.15 cm): ${square.length} top vertices, AO ${square.map((q) => q.ao.toFixed(2)).join(' ')}\n`);
    for (let d = 0; d <= 4; d += 0.4) {
      const at = top.filter((q) => Math.abs(Math.hypot(q.x + 5, q.y - 3) - d) < 0.2 && !board(q));
      process.stdout.write(`  ${d.toFixed(1)} cm: ${at.length} vertices, median ${median(at.map((q) => q.ao))?.toFixed(3)}\n`);
    }
  }
});
