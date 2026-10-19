import * as Blockly from 'blockly';
import { isExtraMelodyName, melodyType, type MelodyName } from '../../core/constructs/ybc.sound';
import { builtInBlockTypes } from '../../core/program/blocks';
import type { BlockPackCatalog } from '../../core/program/block-packs';
import { MAX_PROGRAM_BLOCKS, MAX_TEXT_JOIN_PARTS } from '../../core/program/limits';
import { localizeBlockDefinitions, melodyLabel } from '../i18n/blocks';
import type { Locale } from '../i18n/messages';

// The editor's blocks, as Blockly knows them: registered once, and used to
// tell whether a stored program can be opened at all.

const registeredTypes = new Set<string>();

/** The language the blocks are registered in; Blockly keeps a definition once registered, so it is set first (N6a S5). */
let blockLocale: Locale = 'en';

/** Chooses the language of the custom blocks. Called once at startup, before any block is registered (src/ui/blockly/locale.ts). */
export function setBlockLocale(locale: Locale) {
  blockLocale = locale;
}

/**
 * Registers the blocks of every known pack, whatever profile is active (YB
 * plan §12, L-1): a program that holds a block the active profile does not
 * show must still load, or lowering a profile would lose the document. What
 * the learner sees is the toolbox, which the board context decides. Each type
 * is registered once; a pack that shares a definition (the hats) adds nothing.
 */
export function registerBlocks(packs: BlockPackCatalog) {
  const fresh = localizeBlockDefinitions(packs.definitions(), blockLocale).filter((definition) => !registeredTypes.has(definition.type));
  if (fresh.length > 0) {
    Blockly.common.defineBlocksWithJsonArray(fresh);
    fresh.forEach((definition) => registeredTypes.add(definition.type));
    if (fresh.some((definition) => definition.type === melodyType)) {
      keepSavedMelodies();
    }
  }
}

/**
 * N17 B4 (the B3 ruling): the melody block offers the 14 melodies of the vendor's editor (its definition's options), but a program
 * saved with one of the six micro:bit names B3 offered (FUNK, BLUES…) must open with it, not with the first melody: Blockly refuses
 * a value its dropdown does not offer. So the dropdown of every melody block offers, besides the 14, the one of the six it holds or
 * is being loaded with, and nothing more: once another melody is chosen, the six are gone from it.
 */
function keepSavedMelodies() {
  const definition = Blockly.Blocks[melodyType] as { init(this: Blockly.Block): void } | undefined;
  if (!definition) {
    return;
  }
  const init = definition.init;
  definition.init = function (this: Blockly.Block) {
    init.call(this);
    const field = this.getField('MELODY');
    if (field instanceof Blockly.FieldDropdown) {
      offerSavedMelody(field);
    }
  };
}

function offerSavedMelody(field: Blockly.FieldDropdown) {
  const offered = field.getOptions(false);
  // The value a saved program is being loaded with: Blockly asks for the options before it takes the value.
  let loading: unknown = null;
  field.setOptions(() => {
    const value = loading ?? field.getValue();
    return isExtraMelodyName(value) ? [...offered, [melodyLabel(value as MelodyName, blockLocale), value as string]] : offered;
  });
  const loadState = field.loadState.bind(field);
  field.loadState = (state: unknown) => {
    loading = state;
    try {
      loadState(state);
    } finally {
      loading = null;
    }
  };
}

/**
 * Blockly's variables flyout: "Create variable…", get and set. It also offers
 * "change by", which the dialect has no construct for (YB-2a), so that is dropped.
 */
export function ybcVariablesFlyout(workspace: Blockly.WorkspaceSvg): Blockly.utils.toolbox.FlyoutItemInfoArray {
  const isChange = (item: Blockly.utils.toolbox.FlyoutItemInfo) => {
    const blockxml = 'blockxml' in item ? item.blockxml : undefined;
    const xmlType = typeof blockxml === 'object' && blockxml instanceof Element ? blockxml.getAttribute('type') : null;
    return ('type' in item && item.type === 'math_change') || xmlType === 'math_change' || (typeof blockxml === 'string' && blockxml.includes('math_change'));
  };
  return Blockly.Variables.flyoutCategory(workspace).filter((item) => !isChange(item));
}

/**
 * Structural bounds on mutator metadata (plan section 8.6, L-1 versus L-3). Anti-abuse limits on what Blockly
 * is asked to build when it opens a stored program; they are NOT language rules, and the compiler's limits
 * (50 join parts, 2 000 blocks) are separate. Two bounds, for two different costs:
 *
 * - `maxMutatorItemsPerBlock`: one join or one if may ask for at most this many parts / else-ifs. Blockly
 *   builds the inputs of a single block in quadratic time (measured: 4 000 parts 22 ms, 8 000 parts 100 ms,
 *   100 000 parts 26 s), so a single hostile block is stopped early. 2 x MAX_PROGRAM_BLOCKS: every part
 *   and every else-if of an executable program is a block of it, so no executable block gets near it.
 * - `maxTotalMutatorItems`: all the mutator items of a whole document, in any blocks. Many small mutator
 *   blocks cost about linear time (2 000 joins of 50 parts: 40-75 ms), so this total is large:
 *   MAX_PROGRAM_BLOCKS x MAX_TEXT_JOIN_PARTS. It must be large, because the editor saves blocks that the
 *   compiler skips (loose blocks outside `on start` / `forever`, disabled blocks): their joins and ifs are
 *   not counted in the 2 000 blocks of the program that runs, and the document must still reopen.
 *
 * A join of more than MAX_TEXT_JOIN_PARTS parts is a program the editor can make: it reopens, and Run
 * refuses it (`limit-exceeded`).
 */
export const maxMutatorItemsPerBlock = 2 * MAX_PROGRAM_BLOCKS;
export const maxTotalMutatorItems = MAX_PROGRAM_BLOCKS * MAX_TEXT_JOIN_PARTS;

/**
 * Whether the editor can open `blocks` (plan §7): they are loaded into a
 * headless workspace with the editor's own blocks, the way the panel will
 * load them, with the blocks of every known pack, not only the active
 * profile's. Blockly is the judge because only it knows every structure it
 * rejects, e.g. an input that the block's mutator state does not create, a
 * block in the wrong kind of input, or a nesting too deep to load. Only what
 * Blockly could not judge in bounded time is refused before it loads.
 */
export function canOpenProgram(blocks: unknown, packs: BlockPackCatalog): boolean {
  // Blockly would open these as an empty workspace, hiding that the program is lost.
  if (typeof blocks !== 'object' || blocks === null || Array.isArray(blocks)) {
    return false;
  }
  if (!isBoundedForBlockly(blocks)) {
    return false;
  }
  registerBlocks(packs);
  const workspace = new Blockly.Workspace();
  Blockly.Events.disable();
  try {
    Blockly.serialization.workspaces.load(blocks as Record<string, unknown>, workspace);
    return true;
  } catch {
    return false;
  } finally {
    workspace.dispose();
    Blockly.Events.enable();
  }
}

/**
 * Whether loading `blocks` costs Blockly no more than their size (plan §7).
 * Blockly builds what the data claims before it checks it, so a few bytes
 * can keep the page busy for minutes, or for ever:
 * - "if" appends two inputs per else-if in `elseIfCount` (a numeric string
 *   or an array counts too, Infinity never ends); Blockly's other mutators
 *   (list and text blocks, procedures), which it loads as well, do the same.
 * - IndexedDB keeps structured clones, not JSON: an object referenced twice
 *   is loaded twice, so a few levels of sharing stand for millions of blocks,
 *   and an array with holes is walked to its length.
 * So the program must be what the editor saves: a tree, arrays without
 * holes, and mutator state only on "if" (a whole else-if count) and on text
 * "join" (a whole part count), each at most `maxMutatorItemsPerBlock`, and all
 * of them together at most `maxTotalMutatorItems`.
 */
function isBoundedForBlockly(blocks: object): boolean {
  const seen = new Set<object>([blocks]);
  const pending: object[] = [blocks];
  let mutatorItems = 0;
  for (let value = pending.pop(); value !== undefined; value = pending.pop()) {
    const children = Object.values(value);
    if (Array.isArray(value) && children.length !== value.length) {
      return false;
    }
    const { type, extraState } = value as { type?: unknown; extraState?: unknown };
    if (extraState !== undefined) {
      const state = typeof extraState === 'object' && extraState !== null ? extraState : {};
      // The if mutator (else-ifs) and the join mutator (`itemCount` parts) each make Blockly build that many inputs.
      const key = type === builtInBlockTypes.if ? 'elseIfCount' : type === 'text_join' ? 'itemCount' : null;
      if (key === null) {
        return false;
      }
      const count: unknown = Reflect.get(state, key) ?? 0;
      if (!isWholeNumber(count) || count > maxMutatorItemsPerBlock) {
        return false;
      }
      mutatorItems += count;
      if (mutatorItems > maxTotalMutatorItems) {
        return false;
      }
    }
    for (const child of children) {
      if (typeof child === 'object' && child !== null) {
        if (seen.has(child)) {
          return false;
        }
        seen.add(child);
        pending.push(child);
      }
    }
  }
  return true;
}

function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
