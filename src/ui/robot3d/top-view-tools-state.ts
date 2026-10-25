import Konva from 'konva';

// What the view tools drew on the 2D map (N18 R4.8), and where the map shows a point of the arena: for the E2E, which loads this module
// from the dev server (the very Konva instance the lab runs on), as top-view-state.ts is loaded (R4.6). Nothing of the app imports it.

export type TopViewToolsState = {
  /** The ruler's segment as drawn, [x0, y0, x1, y1] in the arena's cm; null without one. */
  ruler: number[] | null;
  /** The ruler's label; null without one. */
  label: string | null;
  /** The move tool's ghost: whether the robot may stand where it is drawn; null without one. */
  ghost: { clear: boolean } | null;
};

const mapStage = () => Konva.stages.find((candidate) => candidate.container().closest('[data-testid=robot-topview]') !== null);

/** The stage point (px from the map's top left corner) where the map draws the arena point (cm), through its world group; null without a map. */
export function topViewStagePoint(xCm: number, yCm: number): { x: number; y: number } | null {
  const world = mapStage()?.findOne<Konva.Group>('.topview-world');
  return world ? world.getAbsoluteTransform().point({ x: xCm, y: yCm }) : null;
}

/** The tools' layer of the map as it is drawn now; null without a map. */
export function readTopViewTools(): TopViewToolsState | null {
  const stage = mapStage();
  if (!stage) return null;
  const ruler = stage.findOne<Konva.Line>('.topview-ruler');
  const label = stage.findOne<Konva.Label>('.topview-ruler-label');
  const ghost = stage.findOne<Konva.Line>('.topview-ghost');
  return {
    ruler: ruler ? ruler.points() : null,
    label: label ? label.getText().text() : null,
    ghost: ghost ? { clear: ghost.getAttr('clear') === true } : null,
  };
}
