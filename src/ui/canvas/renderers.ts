import type { ComponentType } from 'react';
import type { DeviceDefinition } from '../../core/devices/device-definition';
import type { ComponentInput, ComponentState } from '../../core/simulation/simulate-circuit';
import { GenericRenderer } from './GenericRenderer';
import { LedRenderer } from './LedRenderer';
import { PotentiometerRenderer } from './PotentiometerRenderer';
import { PushButtonRenderer } from './PushButtonRenderer';
import { ServoRenderer } from './ServoRenderer';
import { YbcBoardRenderer } from './YbcBoardRenderer';

/**
 * Renderers draw only the device body, in local coordinates centered on the
 * component position. Port markers are drawn by the canvas from core geometry
 * (plan §5.1 B7), so renderers never compute port positions.
 */
export type DeviceRendererProps = {
  definition: DeviceDefinition;
  /** This component's state in the run snapshot; absent while idle. */
  runtimeState?: ComponentState;
  /**
   * A board with onboard parts only: the snapshot's state of each part that has one, by part id
   * (e.g. 'display', 'buzzer'). Absent while idle and for every other component.
   */
  partStates?: Readonly<Record<string, ComponentState>>;
  /**
   * A board with onboard parts only: the input the run is given for a part, by part id (a button held, the light's level, the
   * temperature, the tilt), drawn so the learner sees what the board senses: a lab's check's (N8s) or, since N17 B2, the
   * learner's own. Present while a run is on, also when nothing was given yet (`{}`); absent otherwise.
   */
  partInputs?: Readonly<Record<string, ComponentInput>>;
  /** A board with onboard parts only (N17 B2): how many one-shot events (shakes) a part had in the run, by part id. */
  partEvents?: Readonly<Record<string, number>>;
  /**
   * A board with onboard parts only, while a run takes the learner's presses (N17 B4): a button part of the drawing is pressed or let
   * go by a pointer. Absent, the drawing takes no press.
   */
  onPartPress?(partId: string, pointerId: number, pressed: boolean): void;
};

// A Map, not an object literal: ids come from data, and names such as
// "toString" or "__proto__" must not resolve to Object.prototype members.
const renderers = new Map<string, ComponentType<DeviceRendererProps>>([
  ['led', LedRenderer],
  ['push-button', PushButtonRenderer],
  ['ybc-board', YbcBoardRenderer],
  ['potentiometer', PotentiometerRenderer],
  ['servo', ServoRenderer],
]);

/** Unknown renderer ids (e.g. the board for now) fall back to the generic body (B6). */
export function rendererFor(definition: DeviceDefinition): ComponentType<DeviceRendererProps> {
  return renderers.get(definition.renderer) ?? GenericRenderer;
}
