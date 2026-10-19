import * as Blockly from 'blockly';
import * as viMessages from 'blockly/msg/vi';
import { viBlocklyCorrections } from '../i18n/blocks';
import type { Locale } from '../i18n/messages';
import { setBlockLocale } from './editor-blocks';

/**
 * Puts the block editor in the UI's language (N6a S5): Blockly's own blocks and menus (`blockly/msg/vi`) and
 * the custom blocks (src/ui/i18n/blocks.ts). Called once at startup, before anything registers a block or opens
 * a workspace: Blockly reads its messages when a block is created and keeps a definition once registered.
 */
export function applyEditorLocale(locale: Locale) {
  setBlockLocale(locale);
  if (locale === 'vi') {
    Blockly.setLocale(viMessages as unknown as Record<string, string>);
    // A few of its texts read wrong; ours are set over them (setLocale adds to what is there).
    Blockly.setLocale({ ...viBlocklyCorrections });
  }
}
