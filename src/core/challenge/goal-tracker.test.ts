import { describe, expect, it } from 'vitest';
import type { RunSnapshot } from '../run/run-session';
import type { ComponentState } from '../simulation/simulate-circuit';
import { parseFrame, type Challenge, type Goal } from './challenge';
import { createGoalTracker } from './goal-tracker';

// Each goal kind against hand-written snapshots (N6a S2): the tracker sees what the run store sees.

const board = 'ybc-board-1';
const heart = '01010:11111:11111:01110:00100';
const dark = '00000:00000:00000:00000:00000';

const frameOf = (rows: string) => ({ pixels: [...rows.replaceAll(':', '')].map((digit) => (digit === '1' ? '#FF0000' : null)) });

function snapshot(components: Record<string, ComponentState>, lines?: string[]): RunSnapshot {
  return {
    status: 'running',
    diagnostics: [],
    error: null,
    simulation: { nets: [], components, pinReads: {} },
    ...(lines ? { console: { lines, hidden: 0 } } : {}),
  };
}
const idle: RunSnapshot = { status: 'idle', diagnostics: [], error: null, simulation: null };

const challengeOf = (...goals: Goal[]): Challenge => ({ goals, durationMs: 1000 });
const verdicts = (challenge: Challenge, observed: [RunSnapshot, number][], program: unknown = null, boardId: string | null = board) => {
  const tracker = createGoalTracker(challenge, boardId);
  observed.forEach(([seen, at]) => tracker.observe(seen, at));
  return tracker.result(program);
};

describe('parseFrame', () => {
  it('reads five rows of five digits, row by row', () => {
    expect(parseFrame(heart)?.map((lit) => (lit ? 1 : 0)).join('')).toBe('0101011111111110111000100');
  });

  it.each(['', '01010', '01010:11111:11111:01110', '01010:11111:11111:01110:0010', '01010:11111:11111:01110:00102', '01010;11111;11111;01110;00100'])(
    'refuses %j',
    (frame) => {
      expect(parseFrame(frame)).toBeNull();
    },
  );
});

describe('display-shows', () => {
  const goal: Goal = { id: 'heart', label: 'Heart', kind: 'display-shows', frame: heart };

  it('passes when the display showed the frame at some moment, even if it changed after', () => {
    expect(verdicts(challengeOf(goal), [[snapshot({}), 0], [snapshot({ [`${board}/display`]: { frame: frameOf(heart) } }), 100], [snapshot({ [`${board}/display`]: { frame: frameOf(dark) } }), 200]])).toEqual({
      passed: true,
      goals: [{ id: 'heart', label: 'Heart', passed: true }],
    });
  });

  it('compares lit and dark only, whatever the colour', () => {
    const blue = { pixels: frameOf(heart).pixels.map((pixel) => (pixel ? '#0000FF' : null)) };
    expect(verdicts(challengeOf(goal), [[snapshot({ [`${board}/display`]: { frame: blue } }), 0]]).passed).toBe(true);
  });

  it('fails on another picture, and on another board’s display', () => {
    expect(verdicts(challengeOf(goal), [[snapshot({ [`${board}/display`]: { frame: frameOf(dark) } }), 0]]).passed).toBe(false);
    expect(verdicts(challengeOf(goal), [[snapshot({ 'other-board/display': { frame: frameOf(heart) } }), 0]]).passed).toBe(false);
  });

  it('takes a display that never showed anything as dark', () => {
    const darkGoal: Goal = { id: 'dark', label: 'Dark', kind: 'display-shows', frame: dark };
    expect(verdicts(challengeOf(darkGoal), [[snapshot({}), 0]]).passed).toBe(true);
  });

  it('counts only what is shown at or after fromMs', () => {
    const late: Goal = { ...goal, fromMs: 500 };
    const shown = snapshot({ [`${board}/display`]: { frame: frameOf(heart) } });
    expect(verdicts(challengeOf(late), [[shown, 499]]).passed).toBe(false);
    expect(verdicts(challengeOf(late), [[shown, 500]]).passed).toBe(true);
  });

  it('never passes on a generic run (no board) or with a malformed frame', () => {
    const shown = snapshot({ [`${board}/display`]: { frame: frameOf(heart) } });
    expect(verdicts(challengeOf(goal), [[shown, 0]], null, null).passed).toBe(false);
    expect(verdicts(challengeOf({ ...goal, frame: 'heart' }), [[shown, 0]]).passed).toBe(false);
  });
});

// N17 B1: a goal that names a colour compares the colour of every lit light too; a goal without one still compares lit and dark only.
describe('display-shows with a colour', () => {
  const tinted = (rows: string, colour: string) => ({ pixels: frameOf(rows).pixels.map((pixel) => (pixel ? colour : null)) });
  const shows = (frame: { pixels: (string | null)[] }) => snapshot({ [`${board}/display`]: { frame: frame as never } });
  const green: Goal = { id: 'green-heart', label: 'Green heart', kind: 'display-shows', frame: heart, colour: '#00ff00' };

  it('passes when the frame is shown with every lit light in that colour, whatever the case of the code', () => {
    expect(verdicts(challengeOf(green), [[shows(tinted(heart, '#00FF00')), 0]]).passed).toBe(true);
    expect(verdicts(challengeOf({ ...green, colour: '#00FF00' }), [[shows(tinted(heart, '#00FF00')), 0]]).passed).toBe(true);
  });

  it('fails on the right picture in another colour, and on the right colour in another picture', () => {
    expect(verdicts(challengeOf(green), [[shows(tinted(heart, '#FF0000')), 0]]).passed).toBe(false);
    expect(verdicts(challengeOf(green), [[shows(tinted(dark.replace('0', '1'), '#00FF00')), 0]]).passed).toBe(false);
  });

  it('fails when one lit light of the picture has another colour', () => {
    const mixed = tinted(heart, '#00FF00');
    mixed.pixels[1] = '#0000FF';
    expect(verdicts(challengeOf(green), [[shows(mixed), 0]]).passed).toBe(false);
  });

  it('passes once, at any moment: colours shown before and after do not undo it', () => {
    expect(
      verdicts(challengeOf(green), [[shows(tinted(heart, '#FF0000')), 0], [shows(tinted(heart, '#00FF00')), 100], [shows(tinted(heart, '#0000FF')), 200]]).passed,
    ).toBe(true);
  });

  it('never passes with a colour that is not a #rrggbb code', () => {
    for (const colour of ['green', '#0f0', '', '00ff00']) {
      expect(verdicts(challengeOf({ ...green, colour }), [[shows(tinted(heart, '#00FF00')), 0]]).passed, colour).toBe(false);
    }
  });

  it('keeps a goal without a colour as it was: lit and dark only', () => {
    const plain: Goal = { id: green.id, label: green.label, kind: 'display-shows', frame: heart };
    expect(verdicts(challengeOf(plain), [[shows(tinted(heart, '#4B0082')), 0]]).passed).toBe(true);
  });
});

describe('led-lit', () => {
  const goal: Goal = { id: 'lit', label: 'Lit', kind: 'led-lit', componentId: 'led' };

  it('passes once the LED was lit', () => {
    expect(verdicts(challengeOf(goal), [[snapshot({ led: { lit: false } }), 0], [snapshot({ led: { lit: true } }), 10], [snapshot({ led: { lit: false } }), 20]]).passed).toBe(true);
  });

  it('fails when it never was, or when another component was', () => {
    expect(verdicts(challengeOf(goal), [[snapshot({ led: { lit: false } }), 0]]).passed).toBe(false);
    expect(verdicts(challengeOf(goal), [[snapshot({ 'led-2': { lit: true } }), 0]]).passed).toBe(false);
  });
});

describe('led-blinks', () => {
  const goal: Goal = { id: 'blink', label: 'Blink', kind: 'led-blinks', componentId: 'led', minToggles: 3 };
  const lit = (value: boolean, at: number): [RunSnapshot, number] => [snapshot({ led: { lit: value } }), at];

  it('counts changes from dark, where the LED starts', () => {
    expect(verdicts(challengeOf(goal), [lit(true, 0), lit(false, 1000), lit(true, 2000)]).passed).toBe(true);
    expect(verdicts(challengeOf(goal), [lit(true, 0), lit(false, 1000)]).passed).toBe(false);
  });

  it('does not count a repeated state as a change', () => {
    expect(verdicts(challengeOf(goal), [lit(true, 0), lit(true, 10), lit(true, 20), lit(false, 30)]).passed).toBe(false);
  });

  it('takes an LED without state as dark', () => {
    expect(verdicts(challengeOf(goal), [lit(true, 0), [snapshot({}), 10], lit(true, 20)]).passed).toBe(true);
  });
});

describe('buzzer-played', () => {
  const goal: Goal = { id: 'notes', label: 'Notes', kind: 'buzzer-played', minNotes: 3 };
  const tone = (hz: number | undefined, at: number): [RunSnapshot, number] => [snapshot(hz === undefined ? {} : { [`${board}/buzzer`]: { hz } }), at];

  it('counts a tone that begins and a change of pitch as notes', () => {
    expect(verdicts(challengeOf(goal), [tone(262, 0), tone(330, 250), tone(392, 500)]).passed).toBe(true);
    expect(verdicts(challengeOf(goal), [tone(262, 0), tone(undefined, 250), tone(262, 260), tone(undefined, 500), tone(262, 510)]).passed).toBe(true);
  });

  it('does not count a tone that goes on', () => {
    expect(verdicts(challengeOf(goal), [tone(262, 0), tone(262, 100), tone(262, 200), tone(330, 300)]).passed).toBe(false);
  });

  it('never passes on a generic run', () => {
    expect(verdicts(challengeOf(goal), [tone(262, 0), tone(330, 250), tone(392, 500)], null, null).passed).toBe(false);
  });
});

describe('console-contains', () => {
  const goal: Goal = { id: 'hello', label: 'Hello', kind: 'console-contains', text: 'hello' };

  it('passes when a printed line contains the text', () => {
    expect(verdicts(challengeOf(goal), [[snapshot({}, ['1', 'say hello world']), 0]]).passed).toBe(true);
  });

  it('fails otherwise, and on a run without a console', () => {
    expect(verdicts(challengeOf(goal), [[snapshot({}, ['Hello']), 0]]).passed).toBe(false);
    expect(verdicts(challengeOf(goal), [[snapshot({}), 0]]).passed).toBe(false);
  });
});

describe('uses-block', () => {
  const goal: Goal = { id: 'write', label: 'Write', kind: 'uses-block', blockType: 'stem_digital_write' };
  const program = (body: Record<string, unknown>) => ({ blocks: { languageVersion: 0, blocks: [{ type: 'stem_forever', id: 'f', inputs: { DO: { block: body } } }] } });

  it('passes when the block runs, whatever the run did', () => {
    expect(verdicts(challengeOf(goal), [], program({ type: 'stem_digital_write', id: 'w' })).passed).toBe(true);
  });

  it('fails when the block is disabled or missing', () => {
    expect(verdicts(challengeOf(goal), [], program({ type: 'stem_digital_write', id: 'w', disabledReasons: ['MANUALLY_DISABLED'] })).passed).toBe(false);
    expect(verdicts(challengeOf(goal), [], program({ type: 'stem_wait', id: 'w' })).passed).toBe(false);
  });
});

describe('the result', () => {
  it('passes only when every goal passed, and lists every goal in order', () => {
    const goals: Goal[] = [
      { id: 'lit', label: 'Lit', kind: 'led-lit', componentId: 'led' },
      { id: 'write', label: 'Write', kind: 'uses-block', blockType: 'stem_digital_write' },
    ];
    expect(verdicts(challengeOf(...goals), [[snapshot({ led: { lit: true } }), 0]])).toEqual({
      passed: false,
      goals: [
        { id: 'lit', label: 'Lit', passed: true },
        { id: 'write', label: 'Write', passed: false },
      ],
    });
  });

  it('never passes without goals', () => {
    expect(verdicts(challengeOf(), [])).toEqual({ passed: false, goals: [] });
  });

  it('ignores idle snapshots', () => {
    const blink: Goal = { id: 'blink', label: 'Blink', kind: 'led-blinks', componentId: 'led', minToggles: 2 };
    expect(verdicts(challengeOf(blink), [[snapshot({ led: { lit: true } }), 0], [idle, 10], [snapshot({ led: { lit: true } }), 20]]).passed).toBe(false);
  });
});
