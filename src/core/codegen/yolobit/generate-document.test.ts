import { describe, expect, it } from 'vitest';
import { createFixtureEnvironment, fixtureComponents, fixtureDocument, programWithMarker } from '../../profiles/__fixtures__/test-profiles';
import { productionProfiles } from '../../profiles';
import { resolveBoardContext } from '../../profiles/board-context';
import { reportLayers } from '../../profiles/validity';
import { compileYbcProgram } from '../../program/compile-ybc-program';
import { createRunSession } from '../../run/run-session';
import { add, getVar, num, print, program, setVar, text, whileLoop, type Json } from '../../program/__fixtures__/ybc-blocks';
import { packs, registry } from './__fixtures__/compile-case';
import { generateForDocument } from './generate-document';

// L-4 generator-ready (plan §8.6): the document passes the same layers as Run, with the same
// diagnostics, and then the generator has to say ok. The layer that stopped it is reported.
// (L-1, loadable, is decided where a stored project is read; this function starts from a loaded document.)

const document = (blocks: Json, profile = 'ybc-basic') => fixtureDocument(profile, { blocks });
const generate = (project: ReturnType<typeof fixtureDocument>) => generateForDocument(project, registry, productionProfiles, packs);

describe('generateForDocument', () => {
  it('generates for a Basic and an Advanced document, the same way', () => {
    const blocks = program([setVar('x', num(1)), print(add(getVar('x'), num(2)))]);
    const basic = generate(document(blocks));
    expect(basic).toMatchObject({ ok: true });
    expect(basic && basic.ok && basic.source).toContain('x = 1\nprint(x + 2)\n');
    const advanced = generate(document(blocks, 'ybc-advanced'));
    expect(advanced && advanced.ok && advanced.source).toBe(basic && basic.ok && basic.source);
  });

  it('generates for the default program of a new project', () => {
    const generated = generate(fixtureDocument('ybc-basic'));
    expect(generated).toMatchObject({ ok: true });
  });

  it('has no generation for a generic document (no panel, R-F5)', () => {
    expect(generate(fixtureDocument(undefined, { components: [] }))).toBeNull();
  });

  it('stops at L-3 with the diagnostics Run gives, for a missing or second board', () => {
    const session = createRunSession(registry);
    const none = fixtureDocument('ybc-basic', { components: [] });
    expect(generate(none)).toMatchObject({ ok: false, layer: 'L-3', diagnostics: [{ code: 'no-board', severity: 'error' }] });
    expect(session.start(none)).toMatchObject({ ok: false, reason: 'no-board' });

    const two = fixtureDocument('ybc-basic', { components: [fixtureComponents.board, { ...fixtureComponents.board, id: 'second' }] });
    expect(generate(two)).toMatchObject({ ok: false, layer: 'L-3', diagnostics: [{ code: 'multiple-boards' }] });
    expect(session.start(two)).toMatchObject({ ok: false, reason: 'multiple-boards' });
  });

  it('stops at L-2 for a device of another family, naming it', () => {
    const genericBoard = { id: 'old-board', deviceType: 'board', position: { x: 0, y: 0 } };
    const generated = generate(fixtureDocument('ybc-basic', { components: [fixtureComponents.board, genericBoard] }));
    expect(generated).toMatchObject({ ok: false, layer: 'L-2', diagnostics: [{ code: 'incompatible-devices' }] });
    expect(generated && !generated.ok && generated.diagnostics[0]?.message).toContain('old-board');
  });

  it('stops at L-2 for a block the profile does not show, and at L-3 for a program that does not compile', () => {
    const environment = createFixtureEnvironment();
    const lowered = fixtureDocument('test-base', { blocks: programWithMarker() });
    expect(generateForDocument(lowered, environment.registry, environment.profiles, environment.packs, environment.noopBlockTypes)).toMatchObject({
      ok: false,
      layer: 'L-2',
      diagnostics: [{ code: 'not-in-profile', blockId: 'marker-1' }],
    });

    const wrong = text('hi');
    expect(generate(document(program([setVar('x', wrong)])))).toMatchObject({
      ok: false,
      layer: 'L-3',
      diagnostics: [{ code: 'type-mismatch', blockId: wrong.id }],
    });
  });

  it('stops at L-4 for a program that runs in the simulator but has no faithful Python: a lone surrogate', () => {
    const blocks = program([print(text('lone \ud83d surrogate'))]);
    const project = document(blocks);
    const session = createRunSession(registry);
    expect(session.start(project)).toEqual({ ok: true });
    session.stop();

    const generated = generate(project);
    expect(generated).toMatchObject({ ok: false, layer: 'L-4', diagnostics: [{ code: 'invalid-literal' }] });
    expect(generated && 'source' in generated).toBe(false);
  });

  it('keeps L-3 and L-4 apart: the document that fails L-4 still passes L-2 and L-3, and generating never changes what L-3 says', () => {
    const project = document(program([print(text('lone \ud83d surrogate'))]));
    const context = resolveBoardContext(project, registry, productionProfiles);
    // L-2, and the layers L-3 owns (board ready, program compiles), are all clean...
    expect(reportLayers(project, context, packs)).toEqual({ profileCompatible: [], runtimeReady: [] });
    expect(compileYbcProgram(project.program.blocks, packs.typesOf(context.blockPacks)).ok).toBe(true);
    // ...and L-4 alone says no. Generating (twice) changes neither the document nor the lower layers.
    const before = JSON.stringify(project);
    expect(generate(project)).toMatchObject({ ok: false, layer: 'L-4' });
    expect(generate(project)).toMatchObject({ ok: false, layer: 'L-4' });
    expect(JSON.stringify(project)).toBe(before);
    expect(reportLayers(project, context, packs)).toEqual({ profileCompatible: [], runtimeReady: [] });
  });

  it('stops at L-4 for blocks nested deeper than the generated Python can safely be', () => {
    let body: Json = print(text('deep'));
    for (let level = 0; level < 70; level += 1) {
      body = whileLoop({ type: 'logic_boolean', id: `c${level}`, fields: { BOOL: 'FALSE' } }, [body]);
    }
    const generated = generate(document(program([body])));
    expect(generated).toMatchObject({ ok: false, layer: 'L-4', diagnostics: [{ code: 'limit-exceeded' }] });
  });

  it('writes the names of the variables and the lines of the blocks, from the document', () => {
    const set = setVar('x', num(1));
    const generated = generate(document(program([set])));
    expect(generated).toMatchObject({ ok: true, names: { x: 'x', y: 'y', z: 'z' } });
    expect(generated && generated.ok && generated.lineMap).toEqual([{ line: 8, blockId: set.id }]);
  });

  it('does not touch the document or run anything', () => {
    const project = document(program([print(num(1))]));
    const before = JSON.stringify(project);
    generate(project);
    expect(JSON.stringify(project)).toBe(before);
  });
});
