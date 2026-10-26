import { createRoot } from 'react-dom/client';
import { unoR3Board } from '../src/core/hardware/catalog';
import type { RobotRunSession, RobotRunSnapshot } from '../src/core/run/robot-run-session';
import { gripperKit, gripperSnapshot, gripperTestScenario } from '../src/ui/robot3d/__fixtures__/gripper-scene';
import type { CameraMode } from '../src/ui/robot3d/camera';
import type { QualityTier } from '../src/ui/robot3d/quality';
import { robotModel } from '../src/ui/robot3d/robot-model';
import { createRobotRunStore } from '../src/ui/robot3d/robot-run-store';
import Scene from '../src/ui/robot3d/Scene';
import { translate } from '../src/ui/i18n/messages';
import { zoneLabelOf } from '../src/ui/robot3d/zone-label';

// N19 E6/E7: the robot lab's 3D view (Scene.tsx, as the lab mounts it) of the gripper car in the test arena of
// src/ui/robot3d/__fixtures__/gripper-scene.ts, its world a fixture snapshot from the query: ?tier=high|low&claw=0&lift=90&held=cube-red
// &status=running&camera=orbit|follow|top. A session that runs nothing hands the view that snapshot. `window.__gripperLook` is 'drawn' once
// the canvas has drawn its first frame.

declare global {
  interface Window {
    __gripperLook?: 'drawn';
  }
}

const query = new URLSearchParams(window.location.search);
const number = (name: string, fallback: number) => (query.has(name) ? Number(query.get(name)) : fallback);
const tier = (query.get('tier') ?? 'high') as QualityTier;
const camera = (query.get('camera') ?? 'orbit') as CameraMode;
const world = gripperSnapshot({ clawDeg: number('claw', 0), liftDeg: number('lift', 90), heldId: query.get('held') }, (query.get('status') ?? 'running') as RobotRunSnapshot['status']);
const snapshot: RobotRunSnapshot = { status: world.status, diagnostics: [], error: null, console: { lines: [], hidden: 0 }, world, slowerThanRealtime: false };
const nothing = async () => ({ ok: true as const });
const session = {
  start: nothing,
  stop: () => {},
  advance: async () => {},
  runUntil: async () => {},
  resetRobot: nothing,
  pressButton: () => {},
  startTeleop: nothing,
  teleop: () => {},
  stopTeleop: () => {},
  teleopLog: () => [],
  placeRobot: async () => ({ ok: true as const, pose: { ...gripperTestScenario.start } }),
  getSnapshot: () => snapshot,
  subscribe: () => () => {},
  preparePhysics: async () => false,
} as unknown as RobotRunSession;
const store = createRobotRunStore(session);
const model = robotModel(gripperKit, unoR3Board);

createRoot(document.getElementById('view')!).render(
  <Scene
    scenario={gripperTestScenario}
    kit={gripperKit}
    model={model}
    store={store}
    tier={tier}
    cameraMode={camera}
    reducedMotion
    zoneLabel={(zone) => zoneLabelOf((key, params) => translate('vi', key, params), zone)}
    onContextLost={() => {}}
    onContextRestored={() => {}}
    onFirstFrame={() => {
      window.__gripperLook = 'drawn';
    }}
  />,
);
