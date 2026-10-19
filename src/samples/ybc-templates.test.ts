import * as Blockly from 'blockly';
import { describe, expect, it } from 'vitest';
import { generateForDocument } from '../core/codegen/yolobit/generate-document';
import type { ProjectDocument } from '../core/circuit/document';
import { localDeviceDefinitions } from '../core/devices/local-catalog';
import { createDeviceRegistry } from '../core/devices/registry';
import { boardTargetOf } from '../core/devices/board-pins';
import { productionProfiles } from '../core/profiles';
import { capabilitiesOf } from '../core/profiles/board-context';
import { createBlockPackCatalog } from '../core/program/block-packs';
import { listBlocks } from '../core/program/block-walk';
import { compileYbcProgram } from '../core/program/compile-ybc-program';
import { canOpenProgram, registerBlocks } from '../ui/blockly/editor-blocks';
import { createTemplateProject } from './templates';
import { ybcSolutionDocument, type YbcLessonKey } from './ybc-solutions';
import { ybcLabProfiles, ybcTemplateBoardId, ybcTemplateKeys, ybcTemplateProfiles, type YbcTemplateKey } from './ybc-templates';

// The Yolo:Bit templates (N6a S1) are starters: the board and the lesson's program with one loose, disabled
// block. They reach the expectation level of a lesson template (YB plan §8.6, §17.2: L-4, Python generated), and
// so do the finished programs the tests and the E2E use.

const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);
const lessonKeys: YbcLessonKey[] = ['ybc-heart', 'ybc-button-ab', 'ybc-night-light', 'ybc-melody', 'ybc-rainbow', 'ybc-thermometer', 'ybc-dice', 'ybc-servo-gate'];

const pythonOf = (document: ProjectDocument) => generateForDocument(document, registry, productionProfiles, packs);
/** Compiled as Run compiles it: for the ybc-board, with the blocks of the document's own profile (a template's is the one it needs, N17 B6). */
const ybcBoard = registry.get('ybc-board');
const compile = (document: ProjectDocument) =>
  compileYbcProgram(
    document.program.blocks,
    packs.typesOf(productionProfiles.get(document.profile ?? '')?.blockPacks ?? []),
    undefined,
    boardTargetOf(ybcBoard, capabilitiesOf(ybcBoard)),
  );
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
  it.each(ybcTemplateKeys.filter((key) => key !== 'ybc-servo-gate'))('%s is a project of one Yolo:Bit-compatible board, with the profile it needs', (key) => {
    const document = createTemplateProject(key);

    expect(document.id).toBe(`template-${key}`);
    expect(document.profile).toBe(ybcTemplateProfiles[key]);
    expect(document.circuit).toEqual({
      components: [{ id: ybcTemplateBoardId, deviceType: 'ybc-board', position: { x: 300, y: 220 } }],
      wires: [],
    });
  });

  // N17 B6: the labs of the Basic board, and the ones that use what only the Advanced board has (the sensors, the servo).
  it('records the profile each template needs: the four new labs, two on each board', () => {
    expect(ybcTemplateProfiles).toEqual({
      'ybc-heart': 'ybc-basic',
      'ybc-button-ab': 'ybc-basic',
      'ybc-night-light': 'ybc-basic',
      'ybc-melody': 'ybc-basic',
      'ybc-empty': 'ybc-basic',
      'ybc-rainbow': 'ybc-basic',
      'ybc-thermometer': 'ybc-advanced',
      'ybc-dice': 'ybc-advanced',
      'ybc-servo-gate': 'ybc-advanced',
    });
  });

  it('ybc-servo-gate is the board and a servo: signal on P0, powered from 3V3 and GND (Advanced palette)', () => {
    const { circuit, profile } = createTemplateProject('ybc-servo-gate');
    expect(profile).toBe('ybc-advanced');
    expect(circuit.components.map(({ id, deviceType }) => [id, deviceType])).toEqual([
      [ybcTemplateBoardId, 'ybc-board'],
      ['servo-1', 'servo'],
    ]);
    expect(circuit.wires.map(({ from, to }) => [`${from.componentId}.${from.portId}`, `${to.componentId}.${to.portId}`])).toEqual([
      ['servo-1.signal', `${ybcTemplateBoardId}.p0`],
      ['servo-1.vcc', `${ybcTemplateBoardId}.3v3`],
      ['servo-1.gnd', `${ybcTemplateBoardId}.gnd`],
    ]);
  });

  it.each(ybcLabProfiles)('opens with the launch profile %s', (profile) => {
    expect(createTemplateProject('ybc-heart', { profile }).profile).toBe(profile);
    expect(createTemplateProject('ybc-rainbow', { profile }).profile).toBe(profile);
  });

  it.each<YbcTemplateKey>(['ybc-thermometer', 'ybc-dice', 'ybc-servo-gate'])('%s opens with the Advanced profile and refuses the Basic one, which lacks its blocks', (key) => {
    expect(createTemplateProject(key, { profile: 'ybc-advanced' }).profile).toBe('ybc-advanced');
    expect(() => createTemplateProject(key, { profile: 'ybc-basic' })).toThrow(`The template "${key}" needs profile=ybc-advanced`);
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
