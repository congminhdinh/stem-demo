import type { ComponentType } from 'react';
import type { DeviceDefinition } from '../../core/devices/device-definition';
import { GenericRenderer } from './GenericRenderer';
import { LedRenderer } from './LedRenderer';

/**
 * Renderers draw only the device body, in local coordinates centered on the
 * component position. Port markers are drawn by the canvas from core geometry
 * (plan §5.1 B7), so renderers never compute port positions.
 */
export type DeviceRendererProps = {
  definition: DeviceDefinition;
  /** Runtime state from the run snapshot; nothing provides it before POC-08. */
  runtimeState?: { lit?: boolean };
};

// A Map, not an object literal: ids come from data, and names such as
// "toString" or "__proto__" must not resolve to Object.prototype members.
const renderers = new Map<string, ComponentType<DeviceRendererProps>>([['led', LedRenderer]]);

/** Unknown renderer ids (e.g. the board for now) fall back to the generic body (B6). */
export function rendererFor(definition: DeviceDefinition): ComponentType<DeviceRendererProps> {
  return renderers.get(definition.renderer) ?? GenericRenderer;
}
