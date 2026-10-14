import { describe, expect, it } from 'vitest';
import { createRunConsole } from './console';
import { MAX_CONSOLE_BYTES, MAX_CONSOLE_ENTRIES, MAX_CONSOLE_LINE_CHARS } from './limits';

describe('the run console', () => {
  it('keeps what is written, in order', () => {
    const runConsole = createRunConsole();
    runConsole.write('a');
    runConsole.write('b');
    expect(runConsole.snapshot()).toEqual({ lines: ['a', 'b'], hidden: 0 });
  });

  it('keeps the newest 500 lines and counts the rest as hidden', () => {
    const runConsole = createRunConsole();
    for (let i = 0; i < MAX_CONSOLE_ENTRIES + 7; i++) {
      runConsole.write(String(i));
    }
    const { lines, hidden } = runConsole.snapshot();
    expect(lines).toHaveLength(MAX_CONSOLE_ENTRIES);
    expect(lines[0]).toBe('7');
    expect(lines.at(-1)).toBe(String(MAX_CONSOLE_ENTRIES + 6));
    expect(hidden).toBe(7);
  });

  it('keeps at most 256 KB, the newest lines', () => {
    const runConsole = createRunConsole();
    const line = 'x'.repeat(MAX_CONSOLE_LINE_CHARS); // 1001 bytes with its newline
    for (let i = 0; i < 400; i++) {
      runConsole.write(line);
    }
    const { lines, hidden } = runConsole.snapshot();
    expect(lines.length).toBe(Math.floor(MAX_CONSOLE_BYTES / (MAX_CONSOLE_LINE_CHARS + 1)));
    expect(lines.length * (MAX_CONSOLE_LINE_CHARS + 1)).toBeLessThanOrEqual(MAX_CONSOLE_BYTES);
    expect(lines.length + hidden).toBe(400);
  });

  it('counts bytes in UTF-8, not characters', () => {
    const runConsole = createRunConsole();
    const wide = 'é'.repeat(MAX_CONSOLE_LINE_CHARS); // 2 bytes each
    for (let i = 0; i < 200; i++) {
      runConsole.write(wide);
    }
    expect(runConsole.snapshot().lines.length).toBe(Math.floor(MAX_CONSOLE_BYTES / (2 * MAX_CONSOLE_LINE_CHARS + 1)));
  });

  it('refuses a line longer than a text may be', () => {
    expect(() => createRunConsole().write('a'.repeat(MAX_CONSOLE_LINE_CHARS + 1))).toThrow(RangeError);
  });

  it('hands out a copy: later writes do not change an earlier snapshot', () => {
    const runConsole = createRunConsole();
    runConsole.write('a');
    const before = runConsole.snapshot();
    runConsole.write('b');
    expect(before.lines).toEqual(['a']);
  });

  it('stays bounded under a flood', () => {
    const runConsole = createRunConsole();
    for (let i = 0; i < 20_000; i++) {
      runConsole.write(`line ${i}`);
    }
    const { lines, hidden } = runConsole.snapshot();
    expect(lines).toHaveLength(MAX_CONSOLE_ENTRIES);
    expect(hidden).toBe(20_000 - MAX_CONSOLE_ENTRIES);
  });
});
