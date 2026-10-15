import type { DeviceDefinition } from '../../core/devices/device-definition';
import { LIGHT_LEVEL_INITIAL, LIGHT_LEVEL_MAX, LIGHT_LEVEL_MIN } from '../../core/simulation/peripherals/light';
import { inputKindOfModel, peripheralComponentId } from '../../core/simulation/simulate-circuit';

// Which runtime controls a board shows, decided from data: the onboard parts of the board's definition,
// the profile's list of parts that have a control (YB plan §8.2) and the kind of input each model takes
// (YB-CP, `inputKindOfModel`). Nothing here knows the names of the parts.

export type SliderRange = { min: number; max: number; initial: number };

/** The range of each model whose control is a slider. A model with a slider input and no range here has no control yet. */
const sliderRanges = new Map<string, SliderRange>([
  ['light-sensor', { min: LIGHT_LEVEL_MIN, max: LIGHT_LEVEL_MAX, initial: LIGHT_LEVEL_INITIAL }],
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
  | (ControlBase & { kind: 'slider'; range: SliderRange });

/** The controls of a board, in the order of its onboard parts. */
export function controlsOf(boardId: string, definition: DeviceDefinition, profileControls: readonly string[]): ControlSpec[] {
  const specs: ControlSpec[] = [];
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
    } else if (kind === 'slider' && range) {
      specs.push({ ...base, kind, label: `${part.label} level`, range });
    }
  }
  return specs;
}

/** The integer a range input's value says, kept inside the range; null when it is not a number. */
export function sliderValueOf(raw: string, range: SliderRange): number | null {
  const value = Math.round(Number(raw));
  return Number.isFinite(value) ? Math.min(range.max, Math.max(range.min, value)) : null;
}
