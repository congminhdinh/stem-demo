import type { ComponentType } from 'react';
import type { DeviceDefinition } from '../../core/devices/device-definition';
import type { ComponentState } from '../../core/simulation/simulate-circuit';
import { GenericRenderer } from './GenericRenderer';
import { LedRenderer } from './LedRenderer';
import { PushButtonRenderer } from './PushButtonRenderer';
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
};

// A Map, not an object literal: ids come from data, and names such as
// "toString" or "__proto__" must not resolve to Object.prototype members.
const renderers = new Map<string, ComponentType<DeviceRendererProps>>([
  ['led', LedRenderer],
  ['push-button', PushButtonRenderer],
  ['ybc-board', YbcBoardRenderer],
]);

/** Unknown renderer ids (e.g. the board for now) fall back to the generic body (B6). */
export function rendererFor(definition: DeviceDefinition): ComponentType<DeviceRendererProps> {
  return renderers.get(definition.renderer) ?? GenericRenderer;
}
