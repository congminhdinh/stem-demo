import { expect, test, type Page } from '@playwright/test';

// N18 R4.1 (plan §5 performance budget): a lab that is not the robot lab never loads the robot lab's chunk, `three`, the physics
// engine or its .wasm. The E2E runs against the dev server, which serves every module as its own request, so "no chunk" is read
// as "no request" for the module that would hold it. (A production build is checked by splitting the chunk, see the R4.1 report.)

/** The requests that would mean 3D bytes: the robot lab's modules, the world engine, three, react-three, Rapier, any wasm. */
const heavy = /\/src\/ui\/robot3d\/|\/src\/core\/world\/|\/node_modules\/\.vite\/deps\/(three|@react-three|@dimforge)|\/node_modules\/(three|@react-three|@dimforge)\/|rapier|\.wasm(\?|$)/i;

function watchRequests(page: Page) {
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  return {
    all: () => urls,
    heavy: () => urls.filter((url) => heavy.test(new URL(url).pathname + new URL(url).search)),
    robotLab: () => urls.filter((url) => /\/src\/ui\/robot3d\/RobotLab\.tsx/.test(new URL(url).pathname)),
  };
}

test.describe('bundle isolation of the robot lab', () => {
  for (const [name, path, ready] of [
    ['the standalone editor', '/', 'circuit-canvas'],
    ['lab=blockly', '/?embed=1&lab=blockly&template=blink', 'circuit-canvas'],
    ['lab=yolobit', '/?embed=1&lab=yolobit&template=ybc-heart', 'circuit-canvas'],
    ['the legacy lab', '/?embed=1&template=blink', 'circuit-canvas'],
    ['a broken robot launch', '/?embed=1&lab=robot&template=rb-unknown', 'launch-error'],
  ] as const) {
    test(`${name} requests no robot chunk, three, Rapier or wasm`, async ({ page }) => {
      const requests = watchRequests(page);
      await page.goto(path);
      await expect(page.getByTestId(ready)).toBeVisible();
      // Everything the page starts after it is shown (fonts, Blockly media, a late import) has come in as well.
      await page.waitForLoadState('networkidle');
      expect(requests.all().length).toBeGreaterThan(5);
      expect(requests.heavy()).toEqual([]);
    });
  }

  test('lab=robot loads the RobotLab chunk', async ({ page }) => {
    const requests = watchRequests(page);
    await page.goto('/?embed=1&lab=robot&template=rb-drive-to-zone');
    await expect(page.getByTestId('robot-lab')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(requests.robotLab()).toHaveLength(1);
    // The watcher does see a robot module as a heavy one: it is not blind to what the other tests say is absent. Since R4.2 the lab
    // brings its 3D scene (three and react-three-fiber) with it, and the physics engine (the Rapier package and its wasm, which
    // core/world/rapier.ts imports lazily) only with the first Run.
    const heavy = requests.heavy().map((url) => new URL(url).pathname);
    expect(heavy).toEqual(expect.arrayContaining(['/src/ui/robot3d/RobotLab.tsx', '/src/ui/robot3d/RobotLab.css', '/src/ui/robot3d/Scene.tsx']));
    expect(heavy.some((path) => /\/(three|@react-three_fiber)\.js$/.test(path))).toBe(true);
    expect(heavy.filter((path) => /@dimforge|\.wasm$/i.test(path))).toEqual([]);
  });
});
