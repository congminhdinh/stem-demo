import { isTemplateKey, type TemplateKey } from '../../samples/templates';

// The launch contract (S1, plan §9.2): how the app is told, by its URL, to
// run as the standalone editor or as an embedded lab. The URL is read once,
// at startup (main.tsx); nothing past this module knows about it.
//
//   (no embed, no template)      standalone editor
//   ?embed=1&template=<key>      embedded lab opening the template <key>
//
// Anything else that names embed or template is a broken launch, shown as an
// error: an embedding page must learn about a bad key, not get a standalone
// project in its place. Other query parameters are ignored.

export type Launch =
  | { mode: 'standalone' }
  | { mode: 'embed'; template: TemplateKey }
  | { mode: 'invalid'; problem: string };

/** Reads the launch from a URL query string such as `location.search`. */
export function parseLaunch(search: string): Launch {
  const params = new URLSearchParams(search);
  const embed = params.getAll('embed');
  const template = params.getAll('template');
  if (embed.length === 0 && template.length === 0) {
    return { mode: 'standalone' };
  }
  if (embed.length === 0) {
    return invalid('A template opens only in an embedded lab: add embed=1.');
  }
  if (embed.length > 1 || embed[0] !== '1') {
    return invalid('embed must be given once, as embed=1.');
  }
  const [key] = template;
  if (key === undefined || key === '') {
    return invalid('No template was given: add template=<key>.');
  }
  if (template.length > 1) {
    return invalid('template must be given once.');
  }
  return isTemplateKey(key) ? { mode: 'embed', template: key } : invalid(`Unknown template "${key}".`);
}

const invalid = (problem: string): Launch => ({ mode: 'invalid', problem });
