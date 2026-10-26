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

const arena = {
  ...sandbox.arena,
  boxes: [],
  cylinders: [],
  objects: [{ id: 'cube', shape: 'box', centerCm: [CUBE_X_CM, START.yCm], sizeCm: [4, 4, 4], massG: 15, noun: 'cube', color: '#d32f2f' }],
};
const gripperSandbox: Scenario = { ...loadScenario({ ...sandbox, arena, start: START }), kit: 'ref-uno-gripper' };

const original = scenarioCatalog.get.bind(scenarioCatalog);
(scenarioCatalog as { get(key: string): Scenario | undefined }).get = (key) => (key === sandbox.key ? gripperSandbox : original(key));

await import('../src/main');
