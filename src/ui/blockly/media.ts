/**
 * Where Blockly's media (sprites, cursors, the dropdown arrow) is served: `blockly-media/` under the app's base
 * path (`import.meta.env.BASE_URL`), so a build served from a sub-path finds it (S6). vite.config.ts serves and
 * copies the folder there.
 */
export function blocklyMediaUrl(base: string): string {
  return `${base.endsWith('/') ? base : `${base}/`}blockly-media/`;
}
