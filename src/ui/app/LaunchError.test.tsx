import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TextProvider } from '../i18n/text';
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

  it('says the problem in Vietnamese in a Vietnamese lab, and keeps the parser’s words as the technical detail (N8s)', () => {
    const markup = renderToStaticMarkup(
      <TextProvider locale="vi">
        <LaunchError problem="The template &quot;ybc-heart&quot; does not open in lab=blockly." lab="blockly" />
      </TextProvider>,
    );
    expect(markup).toContain('<p>Mẫu bài &quot;ybc-heart&quot; không mở trong lab=blockly.</p>');
    expect(markup).toContain('<summary>Chi tiết kỹ thuật (cho người tạo đường dẫn)</summary><p lang="en">The template &quot;ybc-heart&quot; does not open in lab=blockly.</p>');
  });

  it('shows no technical detail in English: the problem is already the parser’s words', () => {
    expect(renderToStaticMarkup(<LaunchError problem="template must be given once." />)).not.toContain('<details');
  });
});
