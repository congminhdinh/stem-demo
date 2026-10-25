import type { Toolbox, ToolboxCategory } from '../../core/program/block-packs';

// The robot lab's toolbox (N18 R4.2): a scenario lists the block types its lesson teaches (`scenario.toolbox`), and the learner is
// offered those, inside what the project's profile has. The profile's toolbox (its packs, localized) is the source: the list only takes
// blocks away, so it can never offer a block the profile does not have, and every kept block keeps its place, fields and shadows.

/** The block types that fill Blockly's dynamic variables category. */
const variableBlockTypes = ['variables_get', 'variables_set'];

/**
 * `toolbox` with only the blocks whose type is in `allowed`, and without the categories that leaves empty (a dynamic category such as
 * the variables one stays when the list has one of its blocks). `allowed` undefined (the sandbox): the toolbox as it is.
 */
export function restrictToolbox(toolbox: Toolbox, allowed: readonly string[] | undefined): Toolbox {
  if (allowed === undefined) {
    return toolbox;
  }
  const types = new Set(allowed);
  const contents = toolbox.contents.flatMap((category): ToolboxCategory[] => {
    if (category.custom !== undefined) {
      return category.custom === 'VARIABLE' && variableBlockTypes.some((type) => types.has(type)) ? [category] : [];
    }
    const kept = (category.contents ?? []).filter((entry) => {
      const type = (entry as { type?: unknown }).type;
      return typeof type === 'string' && types.has(type);
    });
    return kept.length === 0 ? [] : [{ ...category, contents: kept }];
  });
  return { ...toolbox, contents };
}
