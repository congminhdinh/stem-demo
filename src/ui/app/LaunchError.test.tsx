import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LaunchError } from './LaunchError';

describe('LaunchError (S1, N6a S0)', () => {
  it('lists every template for a legacy launch', () => {
    expect(renderToStaticMarkup(<LaunchError problem="Unknown template &quot;x&quot;." />)).toContain(
      'Supported templates: blink, led-on, button-direct, button-led, empty, ybc-heart, ybc-button-ab, ybc-night-light, ybc-melody, ybc-empty.',
    );
  });

  it('lists only the templates of the lab a lab launch named', () => {
    expect(renderToStaticMarkup(<LaunchError problem="p" lab="yolobit" />)).toContain(
      'Supported templates: ybc-heart, ybc-button-ab, ybc-night-light, ybc-melody, ybc-empty.',
    );
    expect(renderToStaticMarkup(<LaunchError problem="p" lab="blockly" />)).toContain(
      'Supported templates: blink, led-on, button-direct, button-led, empty.',
    );
  });
});
