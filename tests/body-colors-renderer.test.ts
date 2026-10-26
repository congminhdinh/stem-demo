import { describe, expect, it } from 'vitest';
import { bodyKindColors, GRIPPER_FINGER_COLOR } from '../src/core/world/arena/body-colors';
import { robot3dColors } from '../src/ui/robot3d/colors';

// N19 B3 (plan §4.4: body-colors.ts is the one source for the renderer and the sensors): a body without a colour of its own looks to the
// colour sensor and the IR as the 3D view paints it, and so do the gripper's fingers. src/core cannot import the UI (B1), so the two tables
// are held together here.

describe('body kind colours (N19 B3)', () => {
  it('are the colours the 3D view paints a wall, a box, a cylinder and an object without one of their own', () => {
    expect(bodyKindColors).toEqual({ wall: robot3dColors.wall, box: robot3dColors.box, cylinder: robot3dColors.cylinder, object: robot3dColors.object });
  });

  it('give the gripper’s fingers the rubber the 3D view paints their pads with (the IR and the colour sensor see it on a closed claw)', () => {
    expect(GRIPPER_FINGER_COLOR).toBe(robot3dColors.gripperPad);
  });
});
