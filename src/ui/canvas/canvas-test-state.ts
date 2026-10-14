import Konva from 'konva';

/** What Konva actually rendered, in world coordinates (dev/E2E only, plan §11.4). */
export type CanvasTestState = {
  /**
   * `lit` and `closed` are read from the LED's light and the push button's
   * cap, as their renderers drew them; `selected` from the selection outline.
   */
  components: {
    id: string;
    deviceType: string;
    x: number;
    y: number;
    lit?: boolean;
    closed?: boolean;
    selected: boolean;
    /** Drawn with the mark for a device that does not belong to the project's family (R-F4). */
    incompatible: boolean;
  }[];
  wires: { id: string; points: number[]; selected: boolean }[];
  ports: { componentId: string; portId: string; x: number; y: number }[];
  /** Ports drawn highlighted: the hovered one and the one a wire is drawn from. */
  highlightedPorts: { componentId: string; portId: string }[];
  /** The wire being drawn, from its port to the pointer; null when none is. */
  wirePreview: number[] | null;
};

export function readCanvasState(): CanvasTestState | null {
  const stage = Konva.stages.at(-1);
  if (!stage) {
    return null;
  }
  const ports = stage.find('.port');
  return {
    components: stage.find<Konva.Group>('.component').map((node) => ({
      id: node.getAttr('componentId'),
      deviceType: node.getAttr('deviceType'),
      x: node.x(),
      y: node.y(),
      lit: node.findOne('.led-light')?.getAttr('lit'),
      closed: node.findOne('.button-cap')?.getAttr('closed'),
      selected: node.findOne('.selection') !== undefined,
      incompatible: node.findOne('.incompatible') !== undefined,
    })),
    wires: stage.find<Konva.Line>('.wire').map((node) => ({
      id: node.getAttr('wireId'),
      points: node.points(),
      selected: node.getAttr('selected') === true,
    })),
    ports: ports.map((node) => ({
      componentId: node.getAttr('componentId'),
      portId: node.getAttr('portId'),
      x: node.x(),
      y: node.y(),
    })),
    highlightedPorts: ports
      .filter((node) => node.getAttr('highlighted') === true)
      .map((node) => ({ componentId: node.getAttr('componentId'), portId: node.getAttr('portId') })),
    wirePreview: stage.findOne<Konva.Line>('.wire-preview')?.points() ?? null,
  };
}
