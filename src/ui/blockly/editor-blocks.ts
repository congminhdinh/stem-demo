import * as Blockly from 'blockly';
import { builtInBlockTypes } from '../../core/program/blocks';
import type { BlockPackCatalog } from '../../core/program/block-packs';

// The editor's blocks, as Blockly knows them: registered once, and used to
// tell whether a stored program can be opened at all.

const registeredTypes = new Set<string>();

/**
 * Registers the blocks of every known pack, whatever profile is active (YB
 * plan §12, L-1): a program that holds a block the active profile does not
 * show must still load, or lowering a profile would lose the document. What
 * the learner sees is the toolbox, which the board context decides. Each type
 * is registered once; a pack that shares a definition (the hats) adds nothing.
 */
export function registerBlocks(packs: BlockPackCatalog) {
  const fresh = packs.definitions().filter((definition) => !registeredTypes.has(definition.type));
  if (fresh.length > 0) {
    Blockly.common.defineBlocksWithJsonArray(fresh);
    fresh.forEach((definition) => registeredTypes.add(definition.type));
  }
}

/**
 * Else-ifs a whole program may have: far more than any program needs, and
 * few enough for Blockly to build at once (a few milliseconds headless).
 */
export const maxElseIfs = 1000;

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
 * holes, and mutator state only on "if", with whole else-if counts that add
 * up to at most `maxElseIfs`.
 */
function isBoundedForBlockly(blocks: object): boolean {
  const seen = new Set<object>([blocks]);
  const pending: object[] = [blocks];
  let elseIfs = 0;
  for (let value = pending.pop(); value !== undefined; value = pending.pop()) {
    const children = Object.values(value);
    if (Array.isArray(value) && children.length !== value.length) {
      return false;
    }
    const { type, extraState } = value as { type?: unknown; extraState?: unknown };
    if (extraState !== undefined) {
      const count: unknown =
        typeof extraState === 'object' && extraState !== null ? (Reflect.get(extraState, 'elseIfCount') ?? 0) : 0;
      if (type !== builtInBlockTypes.if || !isWholeNumber(count)) {
        return false;
      }
      elseIfs += count;
      if (elseIfs > maxElseIfs) {
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
