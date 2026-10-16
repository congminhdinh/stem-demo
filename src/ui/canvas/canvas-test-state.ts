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
    /** A Yolo:Bit-compatible board's display: the 25 cells as drawn, row-major, a colour or null for off. */
    display?: (string | null)[];
    /** A Yolo:Bit-compatible board's buzzer: the frequency it is drawn sounding, in Hz; absent when silent. */
    tone?: number;
    /** A potentiometer's knob position in percent, read from its knob node. */
    value?: number;
    selected: boolean;
    /** Drawn with the mark for a device that does not belong to the project's family (R-F4). */
    incompatible: boolean;
    /** Every text drawn on the body (its name, its parts' labels), in drawing order (N8s). */
    texts: string[];
    /** A Yolo:Bit-compatible board's parts drawn pressed by a lab's check (N8s). */
    pressedParts?: string[];
    /** The light level a lab's check gives the board, as drawn beside the sensor (N8s); absent when none. */
    lightLevel?: number;
  }[];
  wires: { id: string; points: number[]; selected: boolean }[];
  ports: { componentId: string; portId: string; x: number; y: number }[];
  /** Ports drawn highlighted: the hovered one and the one a wire is drawn from. */
  highlightedPorts: { componentId: string; portId: string }[];
  /** The wire being drawn, from its port to the pointer; null when none is. */
  wirePreview: number[] | null;
  /** Stage pixels = world units × scale + offset (the identity unless a lab fits its circuit, N8s). */
  viewport: { scale: number; x: number; y: number };
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
      display: node.findOne('.ybc-display')?.getAttr('frame'),
      tone: node.findOne('.ybc-part-buzzer')?.getAttr('hz'),
      value: node.findOne('.knob')?.getAttr('value'),
      selected: node.findOne('.selection') !== undefined,
      incompatible: node.findOne('.incompatible') !== undefined,
      texts: node.find<Konva.Text>('Text').map((text) => text.text()),
      pressedParts: node.findOne('.ybc-display')
        ? node
            .find<Konva.Group>((part: Konva.Node) => part.name().startsWith('ybc-part-') && part.getAttr('pressed') === true)
            .map((part) => part.name().slice('ybc-part-'.length))
        : undefined,
      lightLevel: node.findOne('.ybc-part-light')?.getAttr('level'),
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
    viewport: { scale: stage.scaleX(), x: stage.x(), y: stage.y() },
  };
}
