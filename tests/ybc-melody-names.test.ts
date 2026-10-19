import * as Blockly from 'blockly';
import { describe, expect, it } from 'vitest';
import { yolobitContract } from '../src/core/compat/yolobit-contract';
import { generateYbcMicroPython } from '../src/core/codegen/yolobit/generate';
import { editorMelodyNames, extraMelodyNames, melodyDefinition, melodyNames, melodyType } from '../src/core/constructs/ybc.sound';
import { boardTargetOf } from '../src/core/devices/board-pins';
import { localDeviceDefinitions } from '../src/core/devices/local-catalog';
import { createDeviceRegistry } from '../src/core/devices/registry';
import { productionProfiles } from '../src/core/profiles';
import { capabilitiesOf } from '../src/core/profiles/board-context';
import { createBlockPackCatalog } from '../src/core/program/block-packs';
import { compileYbcProgram } from '../src/core/program/compile-ybc-program';
import { playMelody, program } from '../src/core/program/__fixtures__/ybc-blocks';
import { canOpenProgram, registerBlocks } from '../src/ui/blockly/editor-blocks';

// N17 B4 (the B3 ruling): the melody dropdown offers only the 14 melodies the vendor's editor shows, which contract §25 marks
// VERIFIED. The 6 micro:bit names it did not show (FUNK, BLUES, FUNERAL, PUNCHLINE, BADDY, BA_DING) leave the dropdown, so a new
// program never writes a melody a board may not have. A program saved with one of them (B3 offered them) still opens with it,
// still runs in the simulator, and its Python still writes it, as an UNVERIFIED form. Real Blockly, with the editor's own
// registration of the blocks.

const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);
registerBlocks(packs);
const advanced = packs.typesOf(productionProfiles.get('ybc-advanced')?.blockPacks ?? []);
const board = registry.get('ybc-board');
const target = boardTargetOf(board, capabilitiesOf(board));

/** The 14 names of the vendor editor's list (contract §14), written out here, not read from the code under test. */
const verified = ['DADADADUM', 'ENTERTAINER', 'PRELUDE', 'ODE', 'NYAN', 'RINGTONE', 'BIRTHDAY', 'WEDDING', 'PYTHON', 'CHASE', 'JUMP_UP', 'JUMP_DOWN', 'POWER_UP', 'POWER_DOWN'];
const extra = ['FUNK', 'BLUES', 'FUNERAL', 'PUNCHLINE', 'BADDY', 'BA_DING'];

const optionValues = (field: Blockly.Field | null) => (field as Blockly.FieldDropdown).getOptions(false).map(([, value]) => value);

/** Loads a saved program into a fresh workspace, as the editor opens a stored project, and saves it again. */
function reload(blocks: Record<string, unknown>) {
  const workspace = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(blocks, workspace);
    return { saved: Blockly.serialization.workspaces.save(workspace), melodies: workspace.getBlocksByType(melodyType, false).map((block) => block.getFieldValue('MELODY') as string) };
  } finally {
    workspace.dispose();
  }
}

describe('the melodies of the melody block', () => {
  it('melody_dropdown_offers_only_verified_names', () => {
    // The definition the core gives Blockly, and the block as the editor registers it, offer exactly the 14 verified names.
    const definitionOptions = (melodyDefinition.args0 as { name: string; options: [string, string][] }[]).find((arg) => arg.name === 'MELODY')?.options;
    expect(definitionOptions?.map(([, value]) => value)).toEqual(verified);
    expect([...editorMelodyNames]).toEqual(verified);
    const workspace = new Blockly.Workspace();
    try {
      expect(optionValues(workspace.newBlock(melodyType).getField('MELODY'))).toEqual(verified);
    } finally {
      workspace.dispose();
    }
    // Each of them is a name the contract's VERIFIED form of C-20 covers: the restriction names the editor's list, and none of the six.
    const c20 = yolobitContract.constructs.find((row) => row.id === 'C-20');
    expect(c20?.python?.form).toBe('music.play(music.<melody>, wait=False)');
    expect(c20?.unverifiedForms?.map((form) => form.form)).toContain('music.play(music.<extra melody>, wait=False)');
    for (const name of extra) {
      expect(verified).not.toContain(name);
    }
  });

  it('keeps all 20 names in the domain: the six are still melodies the compiler, the simulator and the generator know', () => {
    expect([...extraMelodyNames]).toEqual(extra);
    expect(new Set(melodyNames)).toEqual(new Set([...verified, ...extra]));
  });

  it.each(extra)('opens a program saved with %s: the block keeps it, offers it while it is chosen, and drops it once another is chosen', (name) => {
    const saved = program([playMelody(name, 'background')]);
    expect(canOpenProgram(saved, packs)).toBe(true);
    const { saved: again, melodies } = reload(saved);
    expect(melodies).toEqual([name]);
    // Saved again, it is the same program.
    expect(reload(again).melodies).toEqual([name]);

    const workspace = new Blockly.Workspace();
    try {
      Blockly.serialization.workspaces.load(saved, workspace);
      const [block] = workspace.getBlocksByType(melodyType, false);
      const field = block?.getField('MELODY') ?? null;
      expect(field?.getValue()).toBe(name);
      expect(field?.getText()).not.toBe('');
      expect(optionValues(field)).toEqual([...verified, name]);
      block?.setFieldValue('ODE', 'MELODY');
      expect(block?.getFieldValue('MELODY')).toBe('ODE');
      expect(optionValues(field)).toEqual(verified);
    } finally {
      workspace.dispose();
    }
  });

  it('runs and writes a saved micro:bit name: the compiler takes it, and the Python writes it (an UNVERIFIED form)', () => {
    const compiled = compileYbcProgram(program([playMelody('FUNK', 'wait')]), advanced, undefined, target);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }
    const generated = generateYbcMicroPython(compiled.ir);
    expect(generated.ok && generated.source).toContain('music.play(music.FUNK, wait=True)');
  });

  it('still refuses a melody that is none of the 20, on load and in the compiler', () => {
    const { melodies } = reload(program([playMelody('GREENSLEEVES', 'wait')]));
    expect(melodies).toEqual(['DADADADUM']);
    const compiled = compileYbcProgram(program([playMelody('GREENSLEEVES', 'wait')]), advanced, undefined, target);
    expect(compiled.ok).toBe(false);
  });
});
