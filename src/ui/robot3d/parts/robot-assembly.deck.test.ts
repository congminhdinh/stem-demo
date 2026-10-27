import { beforeAll, describe, expect, it } from 'vitest';
import { Mesh, Texture, Vector3, type BufferAttribute, type BufferGeometry, type Object3D } from 'three';
import { productionKits, unoR3Board } from '../../../core/hardware/catalog';
import type { Kit } from '../../../core/hardware/kit';
import { loadTestAssets } from '../__fixtures__/load-glb';
import type { RobotAssets } from '../assets/robot-assets';
import { robotModel } from '../robot-model';
import { assembleRobot, gripperReferenceSizes, referenceSizes, type AssemblyOptions } from './robot-assembly';

// N19 E8 (E6/E7 re-review N3): the chassis part's ambient occlusion (COLOR_0) was baked with the reference robot's modules on its deck, so
// the deck's top under the rover's buzzer board (2 cm square at (−5, 3)) is at the bake's floor, 0.50, where the open deck's top reads
// 1.00 (spikes/n19-e8/deck-ao.test.ts, both tiers). On a kit with no buzzer there (the gripper car) the low tier, which bakes that shade
// into the colours, showed a dark square where no module stands. The gripper car's deck there takes the open deck's shade; the rover's,
// under its buzzer, keeps the bake's.

const roverKit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
const gripperKit = productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;
const reference = referenceSizes(robotModel(roverKit, unoR3Board));
let assets: Record<'high' | 'low', RobotAssets>;

beforeAll(async () => {
  assets = { high: await loadTestAssets('high'), low: await loadTestAssets('low') };
});

/**
 * The shade of the deck's top in the buzzer board's square, as a share of the brightest of the deck's top (each merged mesh's colours:
 * the low tier's are the material's colour times the shade, the high tier's the shade): one value per vertex there.
 */
function deckShadeUnderBuzzer(root: Object3D, deckY: number): number[] {
  root.updateWorldMatrix(true, true);
  const shares: number[] = [];
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    const geometry = node.geometry as BufferGeometry;
    const [position, normal, colour] = [geometry.getAttribute('position'), geometry.getAttribute('normal'), geometry.getAttribute('color') as BufferAttribute | undefined];
    if (!colour) return;
    const [p, n] = [new Vector3(), new Vector3()];
    const top: { inside: boolean; value: number }[] = [];
    for (let i = 0; i < position.count; i++) {
      p.fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld);
      n.fromBufferAttribute(normal, i).transformDirection(node.matrixWorld);
      if (Math.abs(p.y - deckY) > 0.0003 || n.y < 0.9) continue;
      const inside = Math.abs(p.x - -0.05) <= 0.0115 && Math.abs(p.z - -0.03) <= 0.0115;
      top.push({ inside, value: Math.max(colour.getX(i), colour.getY(i), colour.getZ(i)) });
    }
    const brightest = Math.max(...top.map((vertex) => vertex.value));
    for (const vertex of top) if (vertex.inside) shares.push(vertex.value / brightest);
  });
  return shares;
}

const options = (detail: 'high' | 'low', model: ReturnType<typeof robotModel>): AssemblyOptions => ({ detail, shadows: false, flag: null, boardLedPin: 13, blob: new Texture(), gripperReference: gripperReferenceSizes(model) });

describe('the deck where the rover’s buzzer stands (N19 E8)', () => {
  for (const detail of ['low', 'high'] as const) {
    it(`on the gripper car, which has no buzzer, is as light as the open deck; on the rover, under its buzzer, as the bake left it (${detail})`, () => {
      const gripper = robotModel(gripperKit, unoR3Board);
      const rover = robotModel(roverKit, unoR3Board);
      const deckY = reference.body.bottomM + reference.body.heightM;
      const lifted = deckShadeUnderBuzzer(assembleRobot(gripper, reference, assets[detail].part, options(detail, gripper)).root, deckY);
      const baked = deckShadeUnderBuzzer(assembleRobot(rover, reference, assets[detail].part, options(detail, rover)).root, deckY);
      expect(lifted.length).toBeGreaterThan(30);
      expect(baked.length).toBe(lifted.length);
      for (const share of lifted) expect(share).toBeCloseTo(1, 6);
      for (const share of baked) expect(share).toBeLessThan(0.7);
    });
  }

  it('leaves the part’s own geometry (the template every robot is cloned from) as the bake left it', () => {
    const gripper = robotModel(gripperKit, unoR3Board);
    assembleRobot(gripper, reference, assets.low.part, options('low', gripper));
    const plate = assets.low.part('part_chassis')!.getObjectByName('chassis_plate_upper') as Mesh;
    const colour = plate.geometry.getAttribute('color') as BufferAttribute;
    const values = Array.from({ length: colour.count }, (_, i) => colour.getX(i));
    expect(Math.min(...values)).toBeLessThan(0.51);
  });
});
