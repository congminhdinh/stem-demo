import Konva from 'konva';
import type { PaintedZoneName } from './ground-paint';

// What the robot lab's 2D top view drew (N18 R4.6), read from its Konva nodes: the place the tests look at, since they cannot read a
// canvas's pixels (as for the circuit canvas, canvas-test-state.ts). The E2E loads this module from the dev server, which serves the very
// instance the lab runs on (`import('/src/ui/robot3d/top-view-state.ts')`), so that the hooks of `window.__stem` stay as R4.1 fixed them.
// Every position is the arena's (cm, y away from the viewer, yawDeg counter-clockwise), also for the parts that sit on the robot: the
// nodes' own places are worked out through the stage.

export type ArenaPointCm = { xCm: number; yCm: number };

export type TopViewState = {
  /** Why the view is up: "no-webgl", "context-lost" or "chosen". */
  reason: string | null;
  /** The stage's size in px, and the scale: px a cm. */
  stage: { width: number; height: number };
  scale: number;
  /** How many times the moving layer has been drawn: a robot at rest draws nothing more. */
  draws: number;
  robot: (ArenaPointCm & { yawDeg: number }) | null;
  objects: (ArenaPointCm & { id: string; yawDeg: number })[];
  /** A line sensor's dot: `dark` is lit (the sensor sees the line). */
  lineDots: (ArenaPointCm & { role: string; dark: boolean })[];
  /** An ultrasonic ray as drawn, from the sensor to `to`: `lengthCm` is the reading, `echo` false for "no echo"; `hit` is the dot at `to`. */
  rays: { role: string; visible: boolean; lengthCm: number | null; echo: boolean; from: ArenaPointCm; to: ArenaPointCm; hit: boolean }[];
  leds: { role: string; lit: boolean }[];
  /** The servos' arms, degrees from the robot's forward, counter-clockwise. */
  servos: { role: string; armDeg: number }[];
  scaleBar: { cm: number; lengthPx: number } | null;
};

/** The top view that is mounted, as it is drawn now; null when none is. */
export function readTopViewState(): TopViewState | null {
  const stage = Konva.stages.find((candidate) => candidate.container().closest('[data-testid=robot-topview]') !== null);
  const host = stage?.container().closest('[data-testid=robot-topview]');
  const world = stage?.findOne<Konva.Group>('.topview-world');
  if (!stage || !host || !world) {
    return null;
  }
  const fromStage = world.getAbsoluteTransform().copy().invert();
  const arenaPoint = (stagePoint: Konva.Vector2d): ArenaPointCm => {
    const { x, y } = fromStage.point(stagePoint);
    return { xCm: x, yCm: y };
  };
  const at = (node: Konva.Node) => arenaPoint(node.getAbsolutePosition());
  const robot = stage.findOne<Konva.Group>('.topview-robot');
  const bar = stage.findOne<Konva.Group>('.topview-scale');
  const hits = stage.find<Konva.Circle>('.topview-ray-hit');
  return {
    reason: host.getAttribute('data-reason'),
    stage: { width: stage.width(), height: stage.height() },
    scale: world.scaleX(),
    draws: Number(world.getLayer()?.getAttr('draws') ?? 0),
    robot: robot ? { xCm: robot.x(), yCm: robot.y(), yawDeg: robot.rotation() } : null,
    objects: stage.find<Konva.Group>('.topview-object').map((node) => ({ id: node.getAttr('objectId'), xCm: node.x(), yCm: node.y(), yawDeg: node.rotation() })),
    lineDots: stage.find<Konva.Circle>('.topview-line-dot').map((node) => ({ role: node.getAttr('role'), dark: node.getAttr('dark') === true, ...at(node) })),
    rays: stage.find<Konva.Line>('.topview-ray').map((node) => {
      const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = node.points();
      const transform = node.getAbsoluteTransform();
      return {
        role: node.getAttr('role'),
        visible: node.visible(),
        lengthCm: node.getAttr('lengthCm') ?? null,
        echo: node.getAttr('echo') === true,
        from: arenaPoint(transform.point({ x: x0, y: y0 })),
        to: arenaPoint(transform.point({ x: x1, y: y1 })),
        hit: hits.some((hit) => hit.getAttr('role') === node.getAttr('role') && hit.visible()),
      };
    }),
    leds: stage.find<Konva.Circle>('.topview-led').map((node) => ({ role: node.getAttr('role'), lit: node.getAttr('lit') === true })),
    servos: stage.find<Konva.Group>('.topview-servo').map((node) => ({ role: node.getAttr('role'), armDeg: node.findOne<Konva.Group>('.topview-arm')?.rotation() ?? 0 })),
    scaleBar: bar ? { cm: bar.getAttr('cm'), lengthPx: bar.getAttr('lengthPx') } : null,
  };
}

/** N19 E8 fix round 1: a box on the stage, px (y down). */
export type StageBox = { left: number; top: number; right: number; bottom: number };

/**
 * N19 E8 fix round 1: the mat as the map shows it: the arena's origin on the stage (px) and its scale (px a cm), and the named zones' names
 * as it was painted with them (ground-paint.ts), each with its text's box on the stage; null when no map is mounted.
 */
export type TopViewMat = { originX: number; originY: number; scale: number; zoneNames: (Omit<PaintedZoneName, 'box'> & { box: StageBox })[] };

export function readTopViewMat(): TopViewMat | null {
  const stage = Konva.stages.find((candidate) => candidate.container().closest('[data-testid=robot-topview]') !== null);
  const mat = stage?.findOne<Konva.Group>('.topview-mat');
  if (!mat) return null;
  const [originX, originY, scale] = [mat.x(), mat.y(), mat.scaleX()];
  const names = (mat.getAttr('zoneNames') ?? []) as PaintedZoneName[];
  return {
    originX,
    originY,
    scale,
    zoneNames: names.map(({ zoneId, text, place, box }) => ({
      zoneId,
      text,
      place,
      box: { left: originX + box.minX * scale, right: originX + box.maxX * scale, top: originY - box.maxY * scale, bottom: originY - box.minY * scale },
    })),
  };
}
