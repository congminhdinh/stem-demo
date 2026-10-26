import sandbox from '../src/samples/robot-scenarios/rb-sandbox.json';
import { loadScenario, type Scenario } from '../src/core/scenario/scenario';
import { scenarioCatalog } from '../src/samples/robot-scenarios';

// N19 E1-E3, test only (e2e/robot-lab-gripper-ui.html): no gripper lesson ships yet (plan D4), so the sandbox's key opens a test arena on the
// gripper car: an empty floor of 200 × 150 cm, the robot at (60, 75) facing +x, and one red foam cube (4 cm, 15 g, `noun: cube`) 4.5 cm past
// the origin of the carriage when the arm is down (4.5 + 5·cos(−40°) ahead of the robot: the open claw comes down with it between the jaws;
// src/core/run/robot-run-session.teleop-gripper.test.ts holds the same numbers). The catalog is patched before the app is imported (main.tsx
// reads it while it runs), and the arena is validated as the rover's sandbox then given the gripper kit, as the session tests do.

const START = { xCm: 60, yCm: 75, yawDeg: 0 } as const;
const CUBE_X_CM = START.xCm + 4.5 + 5 * Math.cos((-40 * Math.PI) / 180) + 4.5;

// N19 E4/E5 (?arena=pick, opt in: the tests above keep the plain floor): the floor of the pick-and-place lessons, the cube in a named pickup
// area, a warehouse, a red zone and a drop zone (named zones of every kind's tag), and goals that name the cube and a blue cube by the
// warehouse (so that each has a tag: the red one's, at the car's nose, the layout keeps off the car). The red cube is 4 cm on from the
// carriage, its near face at u 2, where the IR between the jaws sees it (B3: up to u 2.3); measured: the lowered arm comes down round it and
// the claw holds it, the IR seeing it (at u 3 or nearer the carriage comes down on the cube and tips it).
const pick = new URLSearchParams(window.location.search).get('arena') === 'pick';
const cubeXCm = pick ? START.xCm + 4.5 + 5 * Math.cos((-40 * Math.PI) / 180) + 4 : CUBE_X_CM;
const zone = (id: string, kind: 'area' | 'target', name: string, [x0, y0, x1, y1]: [number, number, number, number], color: string) => ({ id, kind, name, color, polygonCm: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const zones = pick
  ? [
      zone('pickup', 'area', 'pickup', [66, 62, 86, 88], '#fff2cc'),
      zone('kho', 'target', 'warehouse', [120, 100, 160, 140], '#d9ead3'),
      zone('red-zone', 'target', 'red', [120, 20, 150, 50], '#f4cccc'),
      zone('drop', 'target', 'drop', [165, 60, 195, 90], '#cfe2f3'),
    ]
  : [];

const arena = {
  ...sandbox.arena,
  ...(pick ? { paint: { ...sandbox.arena.paint, zones: [...(sandbox.arena.paint?.zones ?? []), ...zones] } } : {}),
  boxes: [],
  cylinders: [],
  objects: [
    { id: 'cube', shape: 'box', centerCm: [cubeXCm, START.yCm], sizeCm: [4, 4, 4], massG: 15, noun: 'cube', color: '#d32f2f' },
    ...(pick ? [{ id: 'cube-blue', shape: 'box', centerCm: [140, 90], sizeCm: [4, 4, 4], massG: 15, noun: 'cube', color: '#1976d2' }] : []),
  ],
};
const loaded = loadScenario({ ...sandbox, arena, start: START });
// The goal is given after loading, with its defaults, as the kit is: the sandbox's key is a rover key to the loader.
const pickGoals = [
  { id: 'grab-cube', kind: 'object-held', label: { vi: 'Gắp khối', en: 'Grab the cube' }, points: 80, object: 'cube', holdS: 0.5, minLiftCm: 2 },
  { id: 'blue-still', kind: 'object-unmoved', label: { vi: 'Không xê dịch khối xanh', en: 'Leave the blue cube' }, points: 20, object: 'cube-blue', maxMoveCm: 2, maxTiltDeg: 20 },
] as const;
// N19 E4/E5 (ruling 8, &recolour=1 with ?arena=pick): rounds that paint the red cube green, red and blue, so that a plain run (round 1)
// shows the cube in a colour the arena does not give it. The schema refuses a round 1 unlike the arena (objectColors[0] is the arena's);
// this test-only page bypasses the loader on purpose: it is how a run here shows what a later round of the sort lesson shows, the views
// painting the run's world's colours and not the arena's.
const recolour = new URLSearchParams(window.location.search).get('recolour') === '1';
const rounds = recolour ? { variants: { ...loaded.variants, count: 3, objectColors: { cube: ['#388e3c', '#d32f2f', '#1976d2'] } } } : {};
const gripperSandbox: Scenario = { ...loaded, kit: 'ref-uno-gripper', ...(pick ? { goals: [...pickGoals], ...rounds } : {}) };

const original = scenarioCatalog.get.bind(scenarioCatalog);
(scenarioCatalog as { get(key: string): Scenario | undefined }).get = (key) => (key === sandbox.key ? gripperSandbox : original(key));

await import('../src/main');
