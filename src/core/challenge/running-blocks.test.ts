import { describe, expect, it } from 'vitest';
import { runningBlockTypes } from './running-blocks';

const workspace = (...blocks: unknown[]) => ({ blocks: { languageVersion: 0, blocks } });

describe('runningBlockTypes (N6a S2)', () => {
  it('lists the blocks inside on start and forever: statements, values and next', () => {
    const types = runningBlockTypes(
      workspace(
        { type: 'stem_on_start', id: 's', inputs: { DO: { block: { type: 'ybc_display_clear', id: 'c', next: { block: { type: 'ybc_wait_ms', id: 'w', inputs: { MS: { block: { type: 'math_number', id: 'n' } } } } } } } } },
        { type: 'stem_forever', id: 'f' },
      ),
    );
    expect([...types].sort()).toEqual(['math_number', 'stem_forever', 'stem_on_start', 'ybc_display_clear', 'ybc_wait_ms']);
  });

  it('leaves out loose blocks and disabled blocks with what is inside them, but not what follows them', () => {
    const types = runningBlockTypes(
      workspace(
        {
          type: 'stem_forever',
          id: 'f',
          inputs: {
            DO: {
              block: {
                type: 'controls_if',
                id: 'if',
                disabledReasons: ['MANUALLY_DISABLED'],
                inputs: { DO0: { block: { type: 'ybc_display_clear', id: 'c' } } },
                next: { block: { type: 'ybc_wait_ms', id: 'w' } },
              },
            },
          },
        },
        { type: 'ybc_display_show_image', id: 'loose', disabledReasons: ['ORPHANED_BLOCK'] },
        { type: 'ybc_sound_note', id: 'loose-enabled' },
      ),
    );
    expect([...types].sort()).toEqual(['stem_forever', 'ybc_wait_ms']);
  });

  it('leaves out a disabled hat', () => {
    expect([...runningBlockTypes(workspace({ type: 'stem_forever', id: 'f', disabledReasons: ['x'], inputs: { DO: { block: { type: 'stem_wait', id: 'w' } } } }))]).toEqual([]);
  });

  it.each([null, undefined, 42, 'blocks', [], {}, { blocks: null }, { blocks: { blocks: 'x' } }])('reads nothing from %j without throwing', (value) => {
    expect(runningBlockTypes(value).size).toBe(0);
  });

  it('ends on a self-referencing structure', () => {
    const hat: Record<string, unknown> = { type: 'stem_forever', id: 'f' };
    hat.next = { block: hat };
    expect([...runningBlockTypes(workspace(hat))]).toEqual(['stem_forever']);
  });
});
