import Konva from 'konva';

/** What Konva actually rendered, in world coordinates (dev/E2E only, plan §11.4). */
export type CanvasTestState = {
  components: { id: string; deviceType: string; x: number; y: number }[];
  wires: { id: string; points: number[] }[];
  ports: { componentId: string; portId: string; x: number; y: number }[];
};

export function readCanvasState(): CanvasTestState | null {
  const stage = Konva.stages.at(-1);
  if (!stage) {
    return null;
  }
  return {
    components: stage.find('.component').map((node) => ({
      id: node.getAttr('componentId'),
      deviceType: node.getAttr('deviceType'),
      x: node.x(),
      y: node.y(),
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
