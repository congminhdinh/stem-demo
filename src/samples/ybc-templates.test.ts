import * as Blockly from 'blockly';
import { describe, expect, it } from 'vitest';
import { generateForDocument } from '../core/codegen/yolobit/generate-document';
import type { ProjectDocument } from '../core/circuit/document';
import { localDeviceDefinitions } from '../core/devices/local-catalog';
import { createDeviceRegistry } from '../core/devices/registry';
import { productionProfiles } from '../core/profiles';
import { createBlockPackCatalog } from '../core/program/block-packs';
import { listBlocks } from '../core/program/block-walk';
import { compileYbcProgram } from '../core/program/compile-ybc-program';
import { canOpenProgram, registerBlocks } from '../ui/blockly/editor-blocks';
import { createTemplateProject } from './templates';
import { ybcSolutionDocument, type YbcLessonKey } from './ybc-solutions';
import { ybcLabProfiles, ybcTemplateBoardId, ybcTemplateKeys } from './ybc-templates';

// The Yolo:Bit templates (N6a S1) are starters: the board and the lesson's program with one loose, disabled
// block. They reach the expectation level of a lesson template (YB plan §8.6, §17.2: L-4, Python generated), and
// so do the finished programs the tests and the E2E use.

const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);
const lessonKeys: YbcLessonKey[] = ['ybc-heart', 'ybc-button-ab', 'ybc-night-light', 'ybc-melody'];

const pythonOf = (document: ProjectDocument) => generateForDocument(document, registry, productionProfiles, packs);
const compile = (document: ProjectDocument) =>
  compileYbcProgram(document.program.blocks, packs.typesOf(productionProfiles.get('ybc-basic')?.blockPacks ?? []));
/** What the editor saves after opening `blocks` untouched (real Blockly, headless). */
function savedByEditor(blocks: unknown) {
  registerBlocks(packs);
  const workspace = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(blocks as Record<string, unknown>, workspace);
    return Blockly.serialization.workspaces.save(workspace);
  } finally {
    workspace.dispose();
  }
}
const topBlocks = (document: ProjectDocument) =>
  (document.program.blocks as { blocks: { blocks: { type: string; disabledReasons?: string[] }[] } }).blocks.blocks;

describe('Yolo:Bit templates (N6a S1)', () => {
  it.each(ybcTemplateKeys)('%s is a Basic project of one Yolo:Bit-compatible board', (key) => {
    const document = createTemplateProject(key);

    expect(document.id).toBe(`template-${key}`);
    expect(document.profile).toBe('ybc-basic');
    expect(document.circuit).toEqual({
      components: [{ id: ybcTemplateBoardId, deviceType: 'ybc-board', position: { x: 300, y: 220 } }],
      wires: [],
    });
  });

  it.each(ybcLabProfiles)('opens with the launch profile %s', (profile) => {
    expect(createTemplateProject('ybc-heart', { profile }).profile).toBe(profile);
  });

  it('ignores a profile for a generic template', () => {
    expect(createTemplateProject('blink', { profile: 'ybc-advanced' })).toEqual(createTemplateProject('blink'));
  });

  it.each(ybcTemplateKeys)('%s reaches L-4: it compiles without a diagnostic and Python is generated', (key) => {
    const document = createTemplateProject(key);

    expect(compile(document)).toMatchObject({ ok: true, diagnostics: [] });
    expect(pythonOf(document)).toMatchObject({ ok: true });
  });

  it.each(ybcTemplateKeys)('%s opens in the editor (real Blockly, every pack)', (key) => {
    expect(canOpenProgram(createTemplateProject(key).program.blocks, packs)).toBe(true);
  });

  // Written as the editor saves it, key order included: opening a lab changes nothing, so it sends no project-changed.
  it.each(ybcTemplateKeys)('%s is saved by the editor exactly as written', (key) => {
    const { blocks } = createTemplateProject(key).program;
    expect(JSON.stringify(savedByEditor(blocks))).toBe(JSON.stringify(blocks));
  });

  it.each(lessonKeys)('the solution of %s is saved by the editor exactly as written', (key) => {
    const { blocks } = ybcSolutionDocument(key).program;
    expect(JSON.stringify(savedByEditor(blocks))).toBe(JSON.stringify(blocks));
  });

  it.each(lessonKeys)('%s leaves exactly one loose block or stack, disabled as Blockly marks an orphan', (key) => {
    const loose = topBlocks(createTemplateProject(key)).filter((block) => block.type !== 'stem_on_start' && block.type !== 'stem_forever');

    expect(loose).toHaveLength(1);
    expect(loose[0]?.disabledReasons).toEqual(['ORPHANED_BLOCK']);
  });

  it('ybc-empty holds only the two hats', () => {
    expect(topBlocks(createTemplateProject('ybc-empty')).map((block) => block.type)).toEqual(['stem_on_start', 'stem_forever']);
  });

  it.each(lessonKeys)('the solution of %s attaches the loose block: same blocks, none disabled, still L-4', (key) => {
    const starter = createTemplateProject(key);
    const solution = ybcSolutionDocument(key);
    const types = (document: ProjectDocument) => listBlocks(document.program.blocks).map((block) => block.type).sort();

    expect(types(solution)).toEqual(types(starter));
    expect(JSON.stringify(solution.program.blocks)).not.toContain('disabledReasons');
    expect(topBlocks(solution).map((block) => block.type)).toEqual(['stem_on_start', 'stem_forever']);
    expect({ ...solution, program: null }).toEqual({ ...starter, program: null });
    expect(compile(solution)).toMatchObject({ ok: true, diagnostics: [] });
    expect(pythonOf(solution)).toMatchObject({ ok: true });
    expect(canOpenProgram(solution.program.blocks, packs)).toBe(true);
  });
});
