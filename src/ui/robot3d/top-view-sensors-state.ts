import Konva from 'konva';

// What the sensor overlay drew on the 2D map (N18 R4.3), read from its Konva nodes as top-view-state.ts reads the map's (the unit tests
// and the E2E, which loads this module from the dev server, cannot read a canvas's pixels). Positions are the arena's (cm).

export type TopViewSensorsState = {
  /** The overlay's layer is shown ("Hiện cảm biến" is on). */
  shown: boolean;
  /** How many times the layer has been drawn: a robot at rest draws nothing more. */
  draws: number;
  /** The fan of each ultrasonic sensor: from the sensor (`points[0..1]`) over an arc of the reading's length; hidden before a reading. */
  cones: { role: string; visible: boolean; points: number[] }[];
  /** The distance tags ("23,4 cm") and where they stand on the stage (px). */
  labels: { role: string; visible: boolean; text: string; x: number; y: number }[];
  /** The line sensors' spots on the mat: `dark` is the red disc. */
  spots: { role: string; visible: boolean; dark: boolean; xCm: number; yCm: number; radiusCm: number }[];
  /** The zone of the next unmet goal, as lit now; null when none is. */
  zone: string | null;
};

/** The sensor overlay of the map that is mounted, as it is drawn now; null when none is. */
export function readTopViewSensors(): TopViewSensorsState | null {
  const stage = Konva.stages.find((candidate) => candidate.container().closest('[data-testid=robot-topview]') !== null);
  const layer = stage?.findOne<Konva.Layer>('.topview-sensors');
  if (!stage || !layer) {
    return null;
  }
  const lit = stage.find<Konva.Group>('.topview-goal').find((group) => group.visible());
  return {
    shown: layer.visible(),
    draws: Number(layer.getAttr('draws') ?? 0),
    cones: stage.find<Konva.Line>('.topview-cone').map((node) => ({ role: node.getAttr('role'), visible: node.visible(), points: [...node.points()] })),
    labels: stage.find<Konva.Label>('.topview-sensor-label').map((node) => ({ role: node.getAttr('role'), visible: node.visible(), text: node.getText().text(), x: node.x(), y: node.y() })),
    spots: stage.find<Konva.Circle>('.topview-spot').map((node) => ({ role: node.getAttr('role'), visible: node.visible(), dark: node.getAttr('dark') === true, xCm: node.x(), yCm: node.y(), radiusCm: node.radius() })),
    zone: lit?.getAttr('zoneId') ?? null,
  };
}
