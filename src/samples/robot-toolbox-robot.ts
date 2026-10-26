import { productionKits, type KitCatalog } from '../core/hardware/catalog';
import type { ToolboxRobot } from '../core/program/block-packs';
import type { RobotTemplateKey } from './robot-keys';
import { robotTemplateKitRef } from './robot-templates';

// Its own module, not robot-templates.ts: the e2e specs import that one under Node, which cannot load the kit catalog's JSON.

/**
 * N19 A4 (review M3): the robot whose blocks a robot lab's toolbox offers (block-packs.ts `kitBlockPacks`): the template's kit and its
 * board. A kit or board the catalog does not know throws: falling back to the profile's whole toolbox would offer a rover the gripper's
 * blocks.
 */
export function robotTemplateToolboxRobot(key: RobotTemplateKey, kits: KitCatalog = productionKits): ToolboxRobot {
  const ref = robotTemplateKitRef(key);
  const kit = kits.get(ref);
  const board = kits.boardOf(ref);
  if (kit === undefined || board === undefined) {
    throw new Error(`The robot template "${key}" names kit ${ref.id}@${ref.version}, which this build does not have`);
  }
  return { kit, board };
}
