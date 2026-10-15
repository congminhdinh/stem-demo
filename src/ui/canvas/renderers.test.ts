import { describe, expect, it } from 'vitest';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { GenericRenderer } from './GenericRenderer';
import { LedRenderer } from './LedRenderer';
import { PotentiometerRenderer } from './PotentiometerRenderer';
import { PushButtonRenderer } from './PushButtonRenderer';
import { YbcBoardRenderer } from './YbcBoardRenderer';
import { rendererFor } from './renderers';

const led = createDeviceRegistry(localDeviceDefinitions).get('led');
const withRenderer = (renderer: string) => ({ ...led, renderer });

describe('rendererFor', () => {
  it('returns the registered renderer for a known id', () => {
    expect(rendererFor(withRenderer('led'))).toBe(LedRenderer);
    expect(rendererFor(withRenderer('push-button'))).toBe(PushButtonRenderer);
    expect(rendererFor(withRenderer('ybc-board'))).toBe(YbcBoardRenderer);
    expect(rendererFor(withRenderer('potentiometer'))).toBe(PotentiometerRenderer);
  });

  it.each(['board', 'missing-renderer'])('falls back to the generic renderer for %s', (renderer) => {
    expect(rendererFor(withRenderer(renderer))).toBe(GenericRenderer);
  });

  it.each(['toString', '__proto__', 'constructor', 'hasOwnProperty', 'valueOf'])(
    'falls back to the generic renderer for the Object.prototype name %s',
    (renderer) => {
      expect(rendererFor(withRenderer(renderer))).toBe(GenericRenderer);
    },
  );
});
