import type { DeviceDefinition } from '../../core/devices/device-definition';
import { ACCELERATION_LIMIT_MG, GRAVITY_MG } from '../../core/simulation/peripherals/accelerometer';
import { LIGHT_LEVEL_INITIAL, LIGHT_LEVEL_MAX, LIGHT_LEVEL_MIN } from '../../core/simulation/peripherals/light';
import { TEMPERATURE_INITIAL, TEMPERATURE_MAX, TEMPERATURE_MIN } from '../../core/simulation/peripherals/temperature';
import { inputKindOfModel, peripheralComponentId, type ComponentInput } from '../../core/simulation/simulate-circuit';

// Which runtime controls a board shows, decided from data: the onboard parts of the board's definition,
// the profile's list of parts that have a control (YB plan §8.2) and the kind of input each model takes
// (YB-CP, `inputKindOfModel`). Nothing here knows the names of the parts.

/** `unit` is shown after the value (N17 B2: the temperature's °C); the light has none. */
export type SliderRange = { min: number; max: number; initial: number; unit?: string };

/** The range of each model whose control is a slider. A model with a slider input and no range here has no control yet. */
const sliderRanges = new Map<string, SliderRange>([
  ['light-sensor', { min: LIGHT_LEVEL_MIN, max: LIGHT_LEVEL_MAX, initial: LIGHT_LEVEL_INITIAL }],
  // N17 B2: −10..50 °C in steps of 1, 25 °C at the start of a run.
  ['temperature-sensor', { min: TEMPERATURE_MIN, max: TEMPERATURE_MAX, initial: TEMPERATURE_INITIAL, unit: '°C' }],
]);

type ControlBase = {
  /** The part's id in the definition, e.g. 'button-a'. */
  partId: string;
  /** The id the run knows the part by: `<board>/<part>`. */
  componentId: string;
  label: string;
};

export type ControlSpec =
  | (ControlBase & { kind: 'hold' })
  | (ControlBase & { kind: 'slider'; range: SliderRange })
  /** N17 B2: the accelerometer, a tilt pad and a "Lắc" button. */
  | (ControlBase & { kind: 'tilt' })
  /**
   * N17 B4: one button that holds both buttons of the board at once (A+B), since one mouse cannot press two buttons on the drawing.
   * It is no part of the board: `partId` names it after the two, and `componentIds` are theirs.
   */
  | (Omit<ControlBase, 'componentId'> & { kind: 'hold-both'; componentIds: readonly [string, string] });

/** The name of the A+B control after its two buttons: `button-a` and `button-b` make `button-ab`; ids with nothing in common, `a+b`. */
function bothId(first: string, second: string): string {
  let shared = 0;
  while (shared < first.length && first[shared] === second[shared]) {
    shared += 1;
  }
  const prefix = first.slice(0, first.lastIndexOf('-', shared - 1) + 1);
  return prefix === '' ? `${first}+${second}` : `${prefix}${first.slice(prefix.length)}${second.slice(prefix.length)}`;
}

/** The controls of a board, in the order of its onboard parts; with two buttons, A+B right after the second (N17 B4). */
export function controlsOf(boardId: string, definition: DeviceDefinition, profileControls: readonly string[]): ControlSpec[] {
  const specs: ControlSpec[] = [];
  const buttons: { partId: string; componentId: string; label: string }[] = [];
  for (const part of definition.board?.onboard ?? []) {
    if (!profileControls.includes(part.id)) {
      continue;
    }
    // Ids are data: "constructor" must not find a member of Object.prototype.
    const kind = Object.hasOwn(inputKindOfModel, part.model) ? inputKindOfModel[part.model] : undefined;
    const base = { partId: part.id, componentId: peripheralComponentId(boardId, part.id) };
    const range = sliderRanges.get(part.model);
    if (kind === 'hold') {
      specs.push({ ...base, kind, label: `Button ${part.label}` });
      buttons.push({ ...base, label: part.label });
      const [first, second] = buttons;
      if (buttons.length === 2 && first && second) {
        specs.push({
          kind: 'hold-both',
          partId: bothId(first.partId, second.partId),
          componentIds: [first.componentId, second.componentId],
          label: `Button ${first.label}+${second.label}`,
        });
      }
    } else if (kind === 'slider' && range) {
      specs.push({ ...base, kind, label: `${part.label} level`, range });
    } else if (kind === 'tilt') {
      specs.push({ ...base, kind, label: part.label });
    }
  }
  return specs;
}

/** Which row of the panel a control sits in: the buttons share one, the sliders another, the tilt pad has its own. */
export type ControlRowKind = 'buttons' | 'sliders' | 'tilt';
export type ControlRow = { kind: ControlRowKind; specs: ControlSpec[] };

const rowKindOf = (spec: ControlSpec): ControlRowKind => (spec.kind === 'hold' || spec.kind === 'hold-both' ? 'buttons' : spec.kind === 'slider' ? 'sliders' : 'tilt');

/**
 * The controls in rows (the lab layout fix of N17): each run of controls of one kind is a row, in the order given, so the panel
 * stays compact under the circuit and the order of the controls (and of Tab) is the order of `controlsOf`.
 */
export function controlRowsOf(specs: readonly ControlSpec[]): ControlRow[] {
  const rows: ControlRow[] = [];
  for (const spec of specs) {
    const kind = rowKindOf(spec);
    const last = rows.at(-1);
    if (last && last.kind === kind && kind !== 'tilt') {
      last.specs.push(spec);
    } else {
      rows.push({ kind, specs: [spec] });
    }
  }
  return rows;
}

/** The integer a range input's value says, kept inside the range; null when it is not a number. */
export function sliderValueOf(raw: string, range: SliderRange): number | null {
  const value = Math.round(Number(raw));
  return Number.isFinite(value) ? Math.min(range.max, Math.max(range.min, value)) : null;
}

// --- N17 B2: the tilt pad ------------------------------------------------------------------------------------------

/** How far the pad reaches on x and y, in mg: its edge is the board on its side. */
export const TILT_PAD_MG = GRAVITY_MG;
/** One arrow key moves the dot this far. */
export const TILT_KEY_STEP_MG = 128;
/** A drag moves the dot in steps of this many mg, so a slow drag does not send the run an input for every pixel. */
export const TILT_DRAG_STEP_MG = 32;

/** Where the pad has the board: x and y in mg (each −1024..1024), and whether it is turned face down. */
export type TiltState = { x: number; y: number; faceDown: boolean };
export const flatTilt: TiltState = { x: 0, y: 0, faceDown: false };

const clampPad = (value: number) => Math.min(TILT_PAD_MG, Math.max(-TILT_PAD_MG, value));
/** `+ 0` keeps a rounded −0 out. */
const stepped = (value: number, step: number) => Math.round(clampPad(value) / step) * step + 0;

/**
 * The tilt of a point of the pad, given as fractions of its half width from its centre (right and down are positive, as on the
 * screen). The dot is where the board tips down to: right is tilted right (x > 0), up is the logo edge going down (y > 0).
 */
export function tiltOfPadPoint(right: number, down: number, faceDown: boolean): TiltState {
  return { x: stepped(right * TILT_PAD_MG, TILT_DRAG_STEP_MG), y: stepped(-down * TILT_PAD_MG, TILT_DRAG_STEP_MG), faceDown };
}

/** Where the dot of a tilt is drawn: fractions of the pad's half width from its centre, right and down positive. */
export function padPointOfTilt(tilt: TiltState): { right: number; down: number } {
  return { right: clampPad(tilt.x) / TILT_PAD_MG + 0, down: -clampPad(tilt.y) / TILT_PAD_MG + 0 };
}

/** The tilt after a key: the arrows move the dot 128 mg, Home lays the board flat (face up or down as it is); null for any other key. */
export function tiltAfterKey(tilt: TiltState, key: string): TiltState | null {
  switch (key) {
    case 'ArrowLeft':
      return { ...tilt, x: stepped(tilt.x - TILT_KEY_STEP_MG, 1) };
    case 'ArrowRight':
      return { ...tilt, x: stepped(tilt.x + TILT_KEY_STEP_MG, 1) };
    case 'ArrowUp':
      return { ...tilt, y: stepped(tilt.y + TILT_KEY_STEP_MG, 1) };
    case 'ArrowDown':
      return { ...tilt, y: stepped(tilt.y - TILT_KEY_STEP_MG, 1) };
    case 'Home':
      return { ...tilt, x: 0, y: 0 };
    default:
      return null;
  }
}

/**
 * The input the run is given for a tilt: x and y, and, face down, the z that keeps the board's weight on the other side
 * (face up the run works z out itself).
 */
export function tiltInputOf(tilt: TiltState): ComponentInput {
  if (!tilt.faceDown) {
    return { kind: 'tilt', x: tilt.x, y: tilt.y };
  }
  const rest = GRAVITY_MG * GRAVITY_MG - tilt.x * tilt.x - tilt.y * tilt.y;
  return { kind: 'tilt', x: tilt.x, y: tilt.y, z: rest <= 0 ? 0 : Math.min(ACCELERATION_LIMIT_MG, Math.round(Math.sqrt(rest))) };
}

/** The pad's state for an input the run was given (a check's), flat for anything else. */
export function tiltStateOf(input: ComponentInput | undefined): TiltState {
  return input?.kind === 'tilt' && Number.isFinite(input.x) && Number.isFinite(input.y)
    ? { x: clampPad(Math.round(input.x)), y: clampPad(Math.round(input.y)), faceDown: input.z !== undefined && input.z > 0 }
    : flatTilt;
}
