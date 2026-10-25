/**
 * N18 R2.4: the `blockWarnings` record of BlocklyPanel out of the diagnostics of a compile or a run. Only a diagnostic that names a
 * block counts (`capability-unavailable`, `pin-conflict`, `timer-claimed`, `pin-unavailable`, a run warning with its block); the others
 * stay where they are, in the toolbar's list. A block can have several, and a record holds one text per block, so the texts of one
 * block are joined by line breaks, in the order given and each text once.
 *
 * `textOf` is the caller's: it words one diagnostic in the learner's language (the toolbar's `diagnosticText`), because nothing in a
 * panel or in the core may hold a UI string.
 */
export function blockWarningsOf<Diagnostic extends { blockId?: string }>(
  diagnostics: readonly Diagnostic[],
  textOf: (diagnostic: Diagnostic) => string,
): Record<string, string> {
  const texts = new Map<string, string[]>();
  for (const diagnostic of diagnostics) {
    const { blockId } = diagnostic;
    if (blockId === undefined) {
      continue;
    }
    const text = textOf(diagnostic);
    const known = texts.get(blockId);
    if (known === undefined) {
      texts.set(blockId, [text]);
    } else if (!known.includes(text)) {
      known.push(text);
    }
  }
  // fromEntries defines own properties, so a block id such as "__proto__" is a key like any other.
  return Object.fromEntries([...texts].map(([blockId, lines]) => [blockId, lines.join('\n')]));
}
