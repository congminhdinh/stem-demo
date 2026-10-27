import { expect, test } from '@playwright/test';
import { basicSkip } from '../tests/basic-skip';

basicSkip(test.skip, 'the gripper car’s lessons and the modelled scene');

// N19 E6/E7: the gripper car and the pick-and-place props in the robot lab's 3D view (e2e/robot-gripper-look.html: Scene.tsx with a fixture
// snapshot; no gripper scenario ships yet, plan D4) are the modelled scene on both tiers, holding the red cube, with no error. The gallery
// itself (spikes/n19-e67/shots.mjs) and its review are E8's.

// A busy machine draws SwiftShader's first high-tier frame slowly: the limit is for a hang (as robot-lab-look.spec.ts's).
test.describe.configure({ timeout: 120_000 });

for (const tier of ['high', 'low'] as const) {
  test(`the gripper car holding a cube is the modelled scene (${tier})`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(`/e2e/robot-gripper-look.html?tier=${tier}&lift=45&claw=26.97&held=cube-red`);
    await page.waitForFunction(() => (window as unknown as { __gripperLook?: string }).__gripperLook === 'drawn', null, { timeout: 60_000 });
    await expect(page.locator('#view canvas')).toHaveAttribute('data-models', 'modelled');
    expect(errors).toEqual([]);
  });
}
