import type { BoardProfile } from '../../core/hardware/board';
import { driverPortSpecs, kitPort, type DriverId, type Kit, type ModuleKind } from '../../core/hardware/kit';
import type { PinMode, PinState } from '../../core/hardware/virtual-uno';
import type { RobotSnapshot } from '../../core/world/snapshot';
import { buttonPressed, lineSeesDark, toneHzOf } from './robot-model';

// What the robot lab's "Cổng & chân" tab shows (N18 R4.5), worked out without React: the kit's chain role → port → board pins (static,
// from the kit and the board), and what a snapshot of the run says about each pin and each part (live). The 3D view reads the same
// places of the snapshot (robot-model.ts: `sensors` are the kit's sensors in kit order, `pins` are the board's pins in order), and so
// does this: the indices are worked out once, here, and a test holds them equal to the 3D view's.
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
  /** The part's place among the snapshot's `sensors` (the kit's ultrasonic and line sensors in kit order); -1 for a part that has none. */
  sensorIndex: number;
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

const sensorKinds: ReadonlySet<ModuleKind> = new Set<ModuleKind>(['ultrasonic', 'line-sensor']);

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
  | { kind: 'button'; pressed: boolean };

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
