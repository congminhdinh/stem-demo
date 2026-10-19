import { describe, expect, it } from 'vitest';
import type { RunSnapshot } from '../run/run-session';
import { scrollFrame } from '../simulation/peripherals/display';
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

// N17 B6: the goals of the new labs. A goal "at a moment" reads what the run showed at that moment: the last snapshot at or
// before it (a state that was set earlier and stayed counts), never one that came after.
const filled = (colour: string) => snapshot({ [`${board}/display`]: { frame: { pixels: Array.from({ length: 25 }, () => colour) } as never } });
const showing = (rows: string) => snapshot({ [`${board}/display`]: { frame: frameOf(rows) as never } });

describe('display-colours-differ (N17 B6)', () => {
  const goal: Goal = { id: 'rainbow', label: 'Rainbow', kind: 'display-colours-differ', atMs: [700, 1400] };

  it('passes when, at each moment, the whole display is lit in one colour, and the colours differ', () => {
    expect(verdicts(challengeOf(goal), [[filled('#FF0000'), 0], [filled('#00FF00'), 210], [filled('#0000FF'), 910], [filled('#0000FF'), 1600]]).passed).toBe(true);
  });

  it('reads the display as it is at each moment: a state set long before, and nothing after the moment', () => {
    // Green from 200 is still on at 700; blue at 1500 comes after 1400, so at 1400 it is still green.
    expect(verdicts(challengeOf(goal), [[filled('#00FF00'), 200], [filled('#0000FF'), 1500]]).passed).toBe(false);
    expect(verdicts(challengeOf(goal), [[filled('#00FF00'), 200], [filled('#0000FF'), 1400]]).passed).toBe(true);
    // A colour that comes and goes between the moments is not seen.
    expect(verdicts(challengeOf(goal), [[filled('#FF0000'), 0], [filled('#00FF00'), 900], [filled('#FF0000'), 1100], [filled('#FF0000'), 1600]]).passed).toBe(false);
  });

  it('fails when the colour is the same at two moments (a colour that only shows while the button is held)', () => {
    expect(verdicts(challengeOf(goal), [[filled('#FF0000'), 0], [filled('#00FF00'), 200], [filled('#FF0000'), 400], [filled('#00FF00'), 900], [filled('#FF0000'), 1100], [filled('#FF0000'), 1600]]).passed).toBe(false);
  });

  it('fails when the display is not lit all over in one colour at a moment', () => {
    const mixed = filled('#00FF00');
    (mixed.simulation?.components[`${board}/display`]?.frame?.pixels as (string | null)[])[3] = '#FF0000';
    expect(verdicts(challengeOf(goal), [[filled('#FF0000'), 0], [mixed, 900], [mixed, 1600]]).passed).toBe(false);
    expect(verdicts(challengeOf(goal), [[showing(heart), 0], [filled('#00FF00'), 900], [filled('#00FF00'), 1600]]).passed).toBe(false);
    // A display that never showed anything is dark.
    expect(verdicts(challengeOf(goal), [[snapshot({}), 0], [filled('#00FF00'), 900], [filled('#00FF00'), 1600]]).passed).toBe(false);
  });

  it('fails a moment the check never reached, and on a generic run', () => {
    expect(verdicts(challengeOf(goal), [[filled('#FF0000'), 0], [filled('#00FF00'), 900], [filled('#00FF00'), 1300]]).passed).toBe(false);
    expect(verdicts(challengeOf(goal), [[filled('#FF0000'), 0], [filled('#00FF00'), 900], [filled('#00FF00'), 1600]], null, null).passed).toBe(false);
  });
});

describe('display-scrolls (N17 B6)', () => {
  const goal: Goal = { id: 'thirty', label: '30', kind: 'display-scrolls', text: '30', fromMs: 300 };
  // The frames of a scrolling text, as the display shows them: step 0 is the first character in full, step 6 the second.
  const scrolled = (text: string, step: number) => snapshot({ [`${board}/display`]: { frame: scrollFrame([...text], step) as never } });
  const scroll = (text: string, from: number): [RunSnapshot, number][] => Array.from({ length: text.length * 6 + 1 }, (_, step) => [scrolled(text, step), from + step * 200]);

  it('passes when the display shows the characters in full, one after the other, as a scroll shows them', () => {
    expect(verdicts(challengeOf(goal), scroll('30', 300)).passed).toBe(true);
    expect(verdicts(challengeOf(goal), scroll('t=30C', 300)).passed).toBe(true);
    // Two still characters, one after the other, show it as well; the colour does not matter.
    const blue = (character: string) => snapshot({ [`${board}/display`]: { frame: scrollFrame([character], 0, '#0000FF') as never } });
    expect(verdicts(challengeOf(goal), [[blue('3'), 400], [blue('0'), 600]]).passed).toBe(true);
  });

  it('fails on another number, on the characters in the other order, and on half of it', () => {
    expect(verdicts(challengeOf(goal), scroll('25', 300)).passed).toBe(false);
    expect(verdicts(challengeOf(goal), scroll('03', 300)).passed).toBe(false);
    expect(verdicts(challengeOf(goal), scroll('3', 300)).passed).toBe(false);
    expect(verdicts(challengeOf(goal), scroll('30', 300).slice(0, 6)).passed).toBe(false);
  });

  it('counts only what is shown at or after fromMs, and a character twice only when it is shown twice', () => {
    expect(verdicts(challengeOf(goal), scroll('30', 0)).passed).toBe(false);
    const double: Goal = { ...goal, text: '00' };
    expect(verdicts(challengeOf(double), [[scrolled('0', 0), 300], [scrolled('0', 0), 500]]).passed).toBe(false);
    expect(verdicts(challengeOf(double), scroll('100', 300)).passed).toBe(true);
  });

  it('never passes with an empty text or on a generic run', () => {
    expect(verdicts(challengeOf({ ...goal, text: '' }), scroll('30', 300)).passed).toBe(false);
    expect(verdicts(challengeOf(goal), scroll('30', 300), null, null).passed).toBe(false);
  });
});

describe('display-lit (N17 B6)', () => {
  const goal: Goal = { id: 'number', label: 'Number', kind: 'display-lit', atMs: 1300 };

  it('passes when a light of the display is on at the moment', () => {
    expect(verdicts(challengeOf(goal), [[snapshot({}), 0], [showing('00100:00000:00000:00000:00000'), 350], [snapshot({}), 1500]]).passed).toBe(true);
  });

  it('fails on a dark display at the moment, whatever it showed before or after', () => {
    expect(verdicts(challengeOf(goal), [[showing(heart), 0], [showing(dark), 400], [showing(heart), 1400]]).passed).toBe(false);
    expect(verdicts(challengeOf(goal), [[snapshot({}), 0], [snapshot({}), 1500]]).passed).toBe(false);
    expect(verdicts(challengeOf(goal), [[showing(heart), 0], [showing(heart), 1500]], null, null).passed).toBe(false);
  });
});

describe('servo-angle (N17 B6)', () => {
  const closed: Goal = { id: 'closed', label: 'Closed', kind: 'servo-angle', componentId: 'servo-1', angle: 0, atMs: 700 };
  const servo = (angle: number, at: number): [RunSnapshot, number] => [snapshot({ 'servo-1': { angle } }), at];

  it('passes when the servo is at the angle at the moment', () => {
    expect(verdicts(challengeOf(closed), [servo(90, 0), servo(0, 310), servo(90, 910)]).passed).toBe(true);
  });

  it('fails on another angle at the moment, on an angle reached only before or after it, and on another component', () => {
    expect(verdicts(challengeOf(closed), [servo(90, 0), servo(45, 310), servo(0, 910)]).passed).toBe(false);
    expect(verdicts(challengeOf(closed), [servo(0, 0), servo(90, 310), servo(0, 910)]).passed).toBe(false);
    expect(verdicts(challengeOf({ ...closed, componentId: 'servo-2' }), [servo(0, 0), servo(0, 910)]).passed).toBe(false);
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
