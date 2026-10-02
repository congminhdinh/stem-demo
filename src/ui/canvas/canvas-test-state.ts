import Konva from 'konva';

/** What Konva actually rendered, in world coordinates (dev/E2E only, plan §11.4). */
export type CanvasTestState = {
  /** `lit` is read from the LED's light node, as its renderer drew it. */
  components: { id: string; deviceType: string; x: number; y: number; lit?: boolean }[];
  wires: { id: string; points: number[] }[];
  ports: { componentId: string; portId: string; x: number; y: number }[];
};

export function readCanvasState(): CanvasTestState | null {
  const stage = Konva.stages.at(-1);
  if (!stage) {
    return null;
  }
  return {
    components: stage.find<Konva.Group>('.component').map((node) => ({
      id: node.getAttr('componentId'),
      deviceType: node.getAttr('deviceType'),
      x: node.x(),
      y: node.y(),
      lit: node.findOne('.led-light')?.getAttr('lit'),
    })),
    wires: stage.find<Konva.Line>('.wire').map((node) => ({
      id: node.getAttr('wireId'),
      points: node.points(),
    })),
    ports: stage.find('.port').map((node) => ({
      componentId: node.getAttr('componentId'),
      portId: node.getAttr('portId'),
      x: node.x(),
      y: node.y(),
    })),
  };
}
