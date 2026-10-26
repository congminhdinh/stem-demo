import type { Frame, Page } from '@playwright/test';

// N18 P2 fix round 1 (C1): the robot lab's E2E pins the low tier's frame-rate chain off (the dev hooks, src/ui/app/test-hooks.ts):
// under the suite's own load SwiftShader may draw a run slower than 36 fps for 3 s, and the chain would then draw it at 30 fps and change
// what a spec counts. It holds for every lab the page mounts from then on. robot-lab-chain.spec.ts forces the chain's steps instead.

/** Pins the chain off in the page or frame `target` (before or after its lab mounts). */
export async function pinLowTierChainOff(target: Page | Frame): Promise<void> {
  await target.waitForFunction(() => window.__stem?.robot !== undefined);
  await target.evaluate(() => window.__stem!.robot.setLowTierChain('off'));
}
