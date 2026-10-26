import type { BoardProfile } from '../../core/hardware/board';
import type { Rgbc } from '../../core/hardware/devices/tcs34725';
import { classifyColor, COLOR_NAMES, type ColorName } from '../../core/hardware/drivers';
import { driverPortSpecs, kitPort, portParam, type DriverId, type Kit, type ModuleKind } from '../../core/hardware/kit';
import type { PinMode, PinState } from '../../core/hardware/virtual-uno';
import type { RobotSnapshot } from '../../core/world/snapshot';
import { buttonPressed, lineSeesDark, toneHzOf } from './robot-model';

// What the robot lab's "Cổng & chân" tab shows (N18 R4.5), worked out without React: the kit's chain role → port → board pins (static,
// from the kit and the board), and what a snapshot of the run says about each pin and each part (live). The 3D view reads the same
// places of the snapshot (robot-model.ts: `sensors` are the kit's sensors in kit order, `pins` are the board's pins in order), and so
// does this: the indices are worked out once, here, and a test holds them equal to the 3D view's.
//
// N19 E2: the gripper car adds three parts. The gripper's two servos are read as the 3D view draws them (the snapshot's `robot.gripper`); the
// IR sensor between its jaws from its pin A3 (what a program's ir.detect reads) and the kit's `activeLow`; the colour sensor on A4 and A5
// from its entry among the `sensors` (B3/B4: `{kind:'color-sensor', rgbc?}`), only when it is there, its colour from the same COLOR_RULES
// as the program's color.is. The IR and colour sensors stand after the line sensors among the snapshot's `sensors`, in kit order.
//
// Everything a function returns is plain JSON (numbers, strings, booleans, null), so a view can tell whether anything changed, and so
// skip a render, by comparing text. No words: the strings of the tab are the UI's (pin-text.ts).

/** One pin of a port: the driver's name for it (`EN`), the board pin it is on (`D5`), its place in the snapshot's `pins`, and who drives it. */
export type HubPin = { name: string; pin: string; index: number; dir: 'out' | 'in' };

/** One part of the kit with the port that holds it. */
export type HubModule = {
  role: string;
  kind: ModuleKind;
  port: string;
  driver: DriverId;
  /** The pins of the port, in the kit's order (`EN`, `IN1`, `IN2`). */
  pins: HubPin[];
  /** The part's place among the snapshot's `sensors` (the kit's ultrasonic, line, IR and colour sensors in kit order); -1 for a part that has none. */
  sensorIndex: number;
  /** N19 E2: whether an IR sensor's output is LOW while it sees something (the port's `activeLow`, or the driver's default); null for any other part. */
  activeLow: boolean | null;
};

/** One pin of the board's header. */
export type HubBoardPin = { id: string; index: number; pwm: boolean; analog: boolean };

/** Who a board pin is wired to in the kit. */
export type HubOwner = {
  role: string;
  port: string;
  signal: string;
  /** How many pins the port has: a part with several (a motor's EN, IN1, IN2) names the signal on each, one with a single pin does not. */
  portPins: number;
};

export type HubMap = {
  /** The board's pins in board order (D0…D13, A0…A5). */
  board: HubBoardPin[];
  /** The kit's parts in kit order. */
  modules: HubModule[];
  /** Board pin id → the part, port and signal on it; the pins no port uses are not here. */
  owners: ReadonlyMap<string, HubOwner>;
  /** The board's top PWM duty (255). */
  pwmMax: number;
};

const sensorKinds: ReadonlySet<ModuleKind> = new Set<ModuleKind>(['ultrasonic', 'line-sensor', 'ir-obstacle', 'color-sensor']);

/** The kit's chain from role to board pin, as data the tab lists (and the same on every run of it). */
export function hubMap(kit: Kit, board: BoardProfile): HubMap {
  const indexOfPin = (id: string) => board.pins.findIndex((spec) => spec.id === id);
  const sensors = kit.modules.filter((module) => sensorKinds.has(module.kind));
  const owners = new Map<string, HubOwner>();
  const modules = kit.modules.map((module): HubModule => {
    const port = kitPort(kit, module.port);
    const spec = port === undefined ? undefined : driverPortSpecs[port.driver];
    const pins = Object.entries(port?.pins ?? {}).map(([name, pin]): HubPin => {
      owners.set(pin, { role: module.role, port: module.port, signal: name, portPins: Object.keys(port?.pins ?? {}).length });
      return { name, pin, index: indexOfPin(pin), dir: spec?.pins[name]?.dir ?? 'out' };
    });
    return {
      role: module.role,
      kind: module.kind,
      port: module.port,
      driver: port?.driver ?? 'led-digital',
      pins,
      sensorIndex: sensors.findIndex((sensor) => sensor === module),
      // The port's `activeLow`, or the driver's default for it: what `ir.detect` reads the level by (drivers/ir-digital.ts).
      activeLow: module.kind === 'ir-obstacle' && port !== undefined ? portParam(port, 'activeLow') !== false : null,
    };
  });
  return {
    board: board.pins.map((pin, index) => ({ id: pin.id, index, pwm: pin.caps.includes('pwm'), analog: pin.caps.includes('analogIn') })),
    modules,
    owners,
    pwmMax: board.pwmMax,
  };
}

/** What one pin carries: a level, a PWM duty between the two, a tone, or the angle a servo is told. */
export type PinReading =
  | { kind: 'low' }
  | { kind: 'high' }
  | { kind: 'pwm'; duty: number }
  | { kind: 'tone'; hz: number }
  | { kind: 'servo'; deg: number };

export type PinView = { reading: PinReading; /** The pin is an input (INPUT or INPUT_PULLUP): the board reads it, nothing drives it. */ input: boolean };

const isInput = (mode: PinMode) => mode !== 'OUTPUT';

/** One pin of the snapshot as the tab shows it. A servo's command and a tone take precedence over the level the pin has while they run. */
export function pinReading(state: PinState, pwmMax: number): PinView {
  const input = isInput(state.mode);
  if (state.servoDeg !== null) return { reading: { kind: 'servo', deg: state.servoDeg }, input };
  if (state.toneHz !== null) return { reading: { kind: 'tone', hz: state.toneHz }, input };
  if (!input && state.duty > 0 && state.duty < pwmMax) return { reading: { kind: 'pwm', duty: state.duty }, input };
  return { reading: { kind: state.level === 1 ? 'high' : 'low' }, input };
}

/** What a part shows, by what it is. */
export type ModuleView =
  /** `percent` is signed (negative backward), `direction` says it in a word. */
  | { kind: 'dc-motor'; percent: number; direction: 'forward' | 'backward' | 'stopped' }
  /** `deg`: the arm as the 3D view draws it; null when the snapshot has none for the role. */
  | { kind: 'servo'; deg: number | null }
  /** `echo`: the beam met something (400 cm is the reading of none). */
  | { kind: 'ultrasonic'; cm: number; echo: boolean }
  | { kind: 'line-sensor'; dark: boolean }
  | { kind: 'led'; on: boolean }
  | { kind: 'buzzer'; hz: number | null }
  | { kind: 'button'; pressed: boolean }
  /** N19 E2: the claw's and the arm's angles, whole degrees as the 3D view draws them; null when the snapshot has no gripper. */
  | { kind: 'gripper'; clawDeg: number | null; liftDeg: number | null }
  /** N19 E2: the level of the IR sensor's pin and whether that means it sees something (LOW when the kit says activeLow). */
  | { kind: 'ir-obstacle'; level: 'low' | 'high'; detected: boolean }
  /** N19 E2: the counts of the colour sensor's registers and the colour the rules make of them; both null while the world gives no reading. */
  | { kind: 'color-sensor'; rgbc: ColorCounts | null; color: ColorName | null };

/** The raw counts of the TCS34725's channels, in the order the tab writes them: R G B C. */
export type ColorCounts = { r: number; g: number; b: number; c: number };

export type HubValues = {
  /** There is a world to read: a run, or the last frame of a stopped one. False is the static mapping, with no values. */
  live: boolean;
  /** By board pin id. Empty when not live. */
  pins: Readonly<Record<string, PinView>>;
  /** By role. Empty when not live. */
  modules: Readonly<Record<string, ModuleView>>;
};

export const idleHubValues: HubValues = Object.freeze({ live: false, pins: Object.freeze({}), modules: Object.freeze({}) });

/** `Math.round`, with 0 where it would give −0. */
const rounded = (value: number) => Math.round(value) + 0;

/**
 * N19 E2: what the colour sensor's entry among the snapshot's `sensors` holds that the tab reads: the counts of the sensor's registers, when the
 * world gives them. Read through this, and only when the entry is there: a snapshot without the entry (before B3/B4, or a rover's) has none.
 */
type ColorEntry = { readonly kind: 'color-sensor'; readonly rgbc?: Rgbc };

function colorCounts(world: RobotSnapshot, index: number): ColorCounts | null {
  const entry = world.sensors[index] as unknown as ColorEntry | undefined;
  if (entry?.kind !== 'color-sensor' || entry.rgbc === undefined) return null;
  const { r, g, b, c } = entry.rgbc;
  return { r, g, b, c };
}

function moduleView(module: HubModule, world: RobotSnapshot, pwmMax: number): ModuleView | undefined {
  const pinOf = (name: string) => {
    const index = module.pins.find((pin) => pin.name === name)?.index ?? -1;
    return index < 0 ? undefined : world.pins[index];
  };
  switch (module.kind) {
    case 'dc-motor': {
      const duty = pinOf('EN')?.duty;
      const in1 = pinOf('IN1')?.level;
      const in2 = pinOf('IN2')?.level;
      if (duty === undefined || in1 === undefined || in2 === undefined) return undefined;
      // An H-bridge turns the motor when its two direction pins differ; IN1 HIGH is forward.
      if (in1 === in2) return { kind: 'dc-motor', percent: 0, direction: 'stopped' };
      const percent = Math.round((duty * 100) / pwmMax);
      return percent === 0 ? { kind: 'dc-motor', percent: 0, direction: 'stopped' } : { kind: 'dc-motor', percent: in1 === 1 ? percent : -percent, direction: in1 === 1 ? 'forward' : 'backward' };
    }
    case 'servo': {
      const deg = world.robot.servoDeg[module.role];
      return { kind: 'servo', deg: deg === undefined ? null : rounded(deg) };
    }
    case 'ultrasonic': {
      const readout = world.sensors[module.sensorIndex];
      return readout?.kind === 'ultrasonic' ? { kind: 'ultrasonic', cm: readout.cm, echo: readout.hitId !== null } : undefined;
    }
    case 'line-sensor':
      return world.sensors[module.sensorIndex]?.kind === 'line-sensor' ? { kind: 'line-sensor', dark: lineSeesDark(world, module.sensorIndex) } : undefined;
    case 'led':
      return { kind: 'led', on: world.leds[module.role] === true };
    case 'buzzer': {
      const index = module.pins[0]?.index ?? -1;
      return { kind: 'buzzer', hz: index < 0 ? null : toneHzOf(world, index) };
    }
    case 'button': {
      const index = module.pins[0]?.index ?? -1;
      return { kind: 'button', pressed: index >= 0 && buttonPressed(world, index) };
    }
    case 'gripper': {
      const { gripper } = world.robot;
      return { kind: 'gripper', clawDeg: gripper === undefined ? null : rounded(gripper.clawDeg), liftDeg: gripper === undefined ? null : rounded(gripper.liftDeg) };
    }
    case 'ir-obstacle': {
      const level = pinOf('PIN')?.level;
      if (level === undefined) return undefined;
      return { kind: 'ir-obstacle', level: level === 1 ? 'high' : 'low', detected: (level === 0) === (module.activeLow !== false) };
    }
    case 'color-sensor': {
      const counts = colorCounts(world, module.sensorIndex);
      return { kind: 'color-sensor', rgbc: counts, color: counts === null ? null : COLOR_NAMES[classifyColor(counts)]! };
    }
  }
}

/** What `world` says about every pin and every part of `map`; the static mapping (`idleHubValues`) when there is no world to read. */
export function hubValues(map: HubMap, world: RobotSnapshot | null): HubValues {
  // The world alone, before a run, has no pins: nothing of the board to say.
  if (world === null || world.pins.length === 0) return idleHubValues;
  const pins: Record<string, PinView> = {};
  for (const pin of map.board) {
    const state = world.pins[pin.index];
    if (state !== undefined) pins[pin.id] = pinReading(state, map.pwmMax);
  }
  const modules: Record<string, ModuleView> = {};
  for (const module of map.modules) {
    const view = moduleView(module, world, map.pwmMax);
    if (view !== undefined) modules[module.role] = view;
  }
  return { live: true, pins, modules };
}

/** One card of the panel: a part, or all the line sensors together (an eye each, as the board's own line-sensor module shows them). */
export type HubCard = { id: string; kind: ModuleKind; modules: HubModule[] };

/** The panel's cards in kit order; the line sensors share one, where the first of them stands. */
export function hubCards(map: HubMap): HubCard[] {
  const cards: HubCard[] = [];
  for (const module of map.modules) {
    if (module.kind === 'line-sensor') {
      const line = cards.find((card) => card.kind === 'line-sensor');
      if (line !== undefined) {
        line.modules.push(module);
        continue;
      }
      cards.push({ id: 'line', kind: module.kind, modules: [module] });
      continue;
    }
    cards.push({ id: module.role, kind: module.kind, modules: [module] });
  }
  return cards;
}
