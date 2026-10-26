import Konva from 'konva';
import type { ArenaPointCm } from './top-view-state';

// What the 2D map drew of a gripper car and of the pick-and-place lessons (N19 E4), read from its Konva nodes as top-view-state.ts reads the
// rest (the unit tests and the E2E, which loads this module from the dev server, cannot read a canvas's pixels): the boom's reach and the
// jaws, the ring round the held object, each object's fill and mark, the IR beam and the colour sensor's spot with their tag, and the zones'
// names painted on the mat. Positions are the arena's (cm).

export type TopViewGripperState = {
  /** The gripper as drawn, null for a kit without one: the angles it was drawn at, the boom's reach from above, and each jaw (left first). */
  gripper: {
    clawDeg: number;
    liftDeg: number;
    heldId: string | null;
    reachCm: number;
    jaws: { side: 1 | -1; turnDeg: number; hinge: ArenaPointCm; tip: ArenaPointCm }[];
  } | null;
  /** The ring round the held object; `cased`: on its white casing, as large (fix round 1, M3). */
  held: { visible: boolean; id: string | null; xCm: number; yCm: number; radiusCm: number; cased: boolean; casingPx: number } | null;
  /** Each moving body's fill and colour mark (null for none). */
  objects: { id: string; fill: string; mark: string | null }[];
  /**
   * The IR beam between the jaws: whether it is shown, sees something (strong, with its end dot; dashed while it sees nothing), where it runs,
   * and whether its dark casing is under it along the same line and its dot ringed (fix round 1, review I1).
   */
  ir: { visible: boolean; detected: boolean; hitId: string | null; from: ArenaPointCm; to: ArenaPointCm; end: boolean; dashed: boolean; cased: boolean; casingPx: number } | null;
  /**
   * The colour sensor's ray and spot: the colour the spot is tinted for (null before the first window), its tint (null for a ring alone),
   * and whether the ray and the spot are on their white casings (fix round 1, M3).
   */
  color: { rayVisible: boolean; from: ArenaPointCm; to: ArenaPointCm; spotVisible: boolean; color: string | null; tint: string | null; cased: boolean; casingPx: number; haloPx: number } | null;
  /** The tag under the jaws ("IR: có vật", "Màu: đỏ", a line each). */
  label: { visible: boolean; lines: string[] } | null;
  /** The zones' names the mat is painted with, in the paint's order. */
  zoneLabels: string[];
};

/** What the mounted map drew of the gripper car; null when no map is mounted. */
export function readTopViewGripper(): TopViewGripperState | null {
  const stage = Konva.stages.find((candidate) => candidate.container().closest('[data-testid=robot-topview]') !== null);
  const world = stage?.findOne<Konva.Group>('.topview-world');
  if (!stage || !world) return null;
  const fromStage = world.getAbsoluteTransform().copy().invert();
  const arena = (point: Konva.Vector2d): ArenaPointCm => {
    const { x, y } = fromStage.point(point);
    return { xCm: x, yCm: y };
  };
  const gripper = stage.findOne<Konva.Group>('.topview-gripper');
  const held = stage.findOne<Konva.Circle>('.topview-held');
  const beam = stage.findOne<Konva.Line>('.topview-ir');
  const beamCasing = stage.findOne<Konva.Line>('.topview-ir-casing');
  const heldCasing = stage.findOne<Konva.Circle>('.topview-held-casing');
  const rayCasing = stage.findOne<Konva.Line>('.topview-color-ray-casing');
  const halo = stage.findOne<Konva.Circle>('.topview-color-spot-halo');
  // N19 E4 minor round (review 2, N1): how much of a casing shows beyond its ink on each side, px on the screen (the map's scale).
  const scale = world.scaleX();
  const sidePx = (casing: Konva.Shape | undefined, ink: Konva.Shape) => (casing === undefined ? 0 : ((casing.strokeWidth() - ink.strokeWidth()) / 2) * scale);
  /** A casing under `line`: shown when it is, along the same points and dashes, wider. */
  const casedLine = (line: Konva.Line, casing: Konva.Line | undefined) =>
    casing !== undefined && casing.visible() === line.visible() && JSON.stringify(casing.points()) === JSON.stringify(line.points()) && JSON.stringify(casing.dash() ?? []) === JSON.stringify(line.dash() ?? []) && casing.strokeWidth() > line.strokeWidth();
  const ray = stage.findOne<Konva.Line>('.topview-color-ray');
  const spot = stage.findOne<Konva.Circle>('.topview-color-spot');
  const label = stage.findOne<Konva.Label>('.topview-gripper-label');
  const ends = (line: Konva.Line) => {
    const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = line.points();
    const transform = line.getAbsoluteTransform();
    return { from: arena(transform.point({ x: x0, y: y0 })), to: arena(transform.point({ x: x1, y: y1 })) };
  };
  return {
    gripper: gripper
      ? {
          clawDeg: gripper.getAttr('clawDeg'),
          liftDeg: gripper.getAttr('liftDeg'),
          heldId: gripper.getAttr('heldId') ?? null,
          reachCm: gripper.findOne<Konva.Rect>('.topview-gripper-boom')?.width() ?? 0,
          jaws: gripper.find<Konva.Group>('.topview-jaw').map((jaw) => {
            const length = jaw.findOne<Konva.Rect>('Rect')?.width() ?? 0;
            return { side: jaw.getAttr('side'), turnDeg: jaw.rotation(), hinge: arena(jaw.getAbsolutePosition()), tip: arena(jaw.getAbsoluteTransform().point({ x: length, y: 0 })) };
          }),
        }
      : null,
    held: held
      ? {
          visible: held.visible(),
          id: held.getAttr('heldId') ?? null,
          xCm: held.x(),
          yCm: held.y(),
          radiusCm: held.radius(),
          cased: heldCasing !== undefined && heldCasing.visible() === held.visible() && heldCasing.x() === held.x() && heldCasing.y() === held.y() && heldCasing.radius() === held.radius() && heldCasing.strokeWidth() > held.strokeWidth(),
          casingPx: sidePx(heldCasing, held),
        }
      : null,
    objects: stage.find<Konva.Group>('.topview-object').map((group) => {
      const [shape] = group.getChildren() as Konva.Shape[];
      return { id: group.getAttr('objectId'), fill: String(shape?.fill()), mark: group.findOne<Konva.Shape>('.topview-object-mark')?.getAttr('mark') ?? null };
    }),
    ir: beam
      ? {
          visible: beam.visible(),
          detected: beam.getAttr('detected') === true,
          hitId: beam.getAttr('hitId') ?? null,
          ...ends(beam),
          end: stage.findOne<Konva.Circle>('.topview-ir-end')?.visible() === true,
          dashed: (beam.dash() ?? []).length > 0,
          cased: casedLine(beam, beamCasing) && (stage.findOne<Konva.Circle>('.topview-ir-end')?.strokeWidth() ?? 0) > 0,
          casingPx: sidePx(beamCasing, beam),
        }
      : null,
    color:
      ray && spot
        ? {
            rayVisible: ray.visible(),
            ...ends(ray),
            spotVisible: spot.visible(),
            color: spot.getAttr('color') ?? null,
            tint: spot.fillEnabled() ? String(spot.fill()) : null,
            cased: casedLine(ray, rayCasing) && halo !== undefined && halo.visible() === spot.visible() && halo.x() === spot.x() && halo.y() === spot.y() && halo.radius() > spot.radius(),
            casingPx: sidePx(rayCasing, ray),
            // The white rim beyond the spot's dark ring.
            haloPx: halo === undefined ? 0 : (halo.radius() - spot.radius() - spot.strokeWidth() / 2) * scale,
          }
        : null,
    label: label ? { visible: label.visible(), lines: label.getText().text().split('\n') } : null,
    zoneLabels: stage.findOne<Konva.Group>('.topview-mat')?.getAttr('zoneLabels') ?? [],
  };
}
