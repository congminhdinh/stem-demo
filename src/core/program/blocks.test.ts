import { describe, expect, it } from 'vitest';
import { blockTypes, buildBlockDefinitions, createDefaultProgram, toolbox } from './blocks';
import { compileProgram } from './compile-program';

describe('block definitions', () => {
  it('are plain JSON data', () => {
    const definitions = buildBlockDefinitions(['D13', 'D12']);

    expect(JSON.parse(JSON.stringify(definitions))).toEqual(definitions);
  });

  it('build the pin dropdown from the board pins', () => {
    const digitalWrite = buildBlockDefinitions(['D13', 'D12']).find(
      (definition) => definition.type === blockTypes.digitalWrite,
    );

    expect(digitalWrite?.args0).toContainEqual(
      expect.objectContaining({
        name: 'PIN',
        options: [
          ['D13', 'D13'],
          ['D12', 'D12'],
        ],
      }),
    );
  });

  it('are the only block types the toolbox offers', () => {
    const defined = buildBlockDefinitions([]).map((definition) => definition.type);
    const offered = toolbox.contents.flatMap((category) => category.contents.map((item) => item.type));

    expect([...offered].sort()).toEqual([...defined].sort());
  });
});

describe('createDefaultProgram', () => {
  it('compiles to an empty on start and an empty forever', () => {
    expect(compileProgram(createDefaultProgram(), ['D13'])).toEqual({
      ok: true,
      ir: { onStart: [], forever: [] },
      diagnostics: [],
    });
  });
});
