import { describe, expect, it } from 'vitest';
import { CONTEXT_RESTORE_WAIT_MS, fallbackNoteKey, fallbackReason, viewToggleAction, viewToggleText } from './webgl-support';

// N18 R4.6: when the robot lab shows its 2D top view instead of the 3D scene, and why. Three causes: this computer has no WebGL, the
// browser took the WebGL context away and did not give it back within 2 s, or the learner chose the 2D view. The 3D scene is shown in
// every other case, including the first 2 s of a lost context (the scene waits for it to come back).

describe('fallbackReason (N18 R4.6)', () => {
  it('shows the 3D scene while WebGL works and nobody asked for 2D', () => {
    expect(fallbackReason({ webgl: true, context: 'ok', chosen2d: false })).toBeNull();
  });

  it('waits for a lost context for CONTEXT_RESTORE_WAIT_MS before it falls back', () => {
    expect(CONTEXT_RESTORE_WAIT_MS).toBe(2000);
    expect(fallbackReason({ webgl: true, context: 'lost', chosen2d: false })).toBeNull();
    expect(fallbackReason({ webgl: true, context: 'gone', chosen2d: false })).toBe('context-lost');
  });

  it('falls back without WebGL, whatever else is so', () => {
    expect(fallbackReason({ webgl: false, context: 'ok', chosen2d: false })).toBe('no-webgl');
    expect(fallbackReason({ webgl: false, context: 'gone', chosen2d: true })).toBe('no-webgl');
  });

  it('keeps the learner’s own choice as the reason when they chose 2D with the context gone', () => {
    expect(fallbackReason({ webgl: true, context: 'ok', chosen2d: true })).toBe('chosen');
    expect(fallbackReason({ webgl: true, context: 'gone', chosen2d: true })).toBe('chosen');
  });
});

describe('fallbackReason with a canvas that failed (N18 R4.6 fix round 1, ruling a)', () => {
  it('falls back when the 3D canvas threw while it was made or drawn, with its own reason', () => {
    expect(fallbackReason({ webgl: true, context: 'ok', chosen2d: false, canvasFailed: true })).toBe('canvas-failed');
    expect(fallbackReason({ webgl: true, context: 'gone', chosen2d: false, canvasFailed: true })).toBe('canvas-failed');
    expect(fallbackReason({ webgl: true, context: 'ok', chosen2d: false, canvasFailed: false })).toBeNull();
  });

  it('keeps no WebGL and the learner’s own choice as the reasons before it', () => {
    expect(fallbackReason({ webgl: false, context: 'ok', chosen2d: false, canvasFailed: true })).toBe('no-webgl');
    expect(fallbackReason({ webgl: true, context: 'ok', chosen2d: true, canvasFailed: true })).toBe('chosen');
  });
});

describe('fallbackNoteKey (N18 R4.6)', () => {
  it('tells the learner why they see 2D, except when they asked for it themselves', () => {
    expect(fallbackNoteKey['no-webgl']).toBe('robot.topview.noWebgl');
    expect(fallbackNoteKey['context-lost']).toBe('robot.topview.contextLost');
    expect(fallbackNoteKey['canvas-failed']).toBe('robot.topview.canvasFailed');
    expect(fallbackNoteKey.chosen).toBeNull();
  });
});

describe('the view button (N18 R4.6)', () => {
  it('offers 2D over the 3D scene, 3D back over a view the learner chose, and a new look where WebGL is missing or was lost', () => {
    expect(viewToggleAction(null)).toBe('show2d');
    expect(viewToggleAction('chosen')).toBe('show3d');
    expect(viewToggleAction('no-webgl')).toBe('retry3d');
    expect(viewToggleAction('context-lost')).toBe('retry3d');
    expect(viewToggleAction('canvas-failed')).toBe('retry3d');
  });

  it('names each action in the learner’s words', () => {
    expect(viewToggleText).toEqual({
      show2d: { label: 'robot.view.show2d', hint: 'robot.view.hint2d' },
      show3d: { label: 'robot.view.show3d', hint: 'robot.view.hint3d' },
      retry3d: { label: 'robot.view.retry3d', hint: 'robot.view.hintRetry3d' },
    });
  });
});
