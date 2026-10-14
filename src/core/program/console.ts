import { MAX_CONSOLE_BYTES, MAX_CONSOLE_ENTRIES, MAX_CONSOLE_LINE_CHARS } from './limits';

// The console of a run (YB plan §6.7, §11.4): runtime state, never part of the
// document. It keeps the newest lines inside two limits and counts the ones it
// let go, so a program that prints in a loop cannot grow memory. Dropping old
// lines is presentation: what the program printed is not changed.

export type ConsoleSnapshot = {
  lines: string[];
  /** How many older lines were dropped to stay inside the limits. */
  hidden: number;
};

export type RunConsole = {
  /** Appends one line (without its newline). A line longer than a text may be is refused. */
  write(line: string): void;
  snapshot(): ConsoleSnapshot;
};

const encoder = new TextEncoder();
/** A line and its newline, in UTF-8. */
const sizeOf = (line: string) => encoder.encode(line).length + 1;

export function createRunConsole(): RunConsole {
  const lines: { text: string; bytes: number }[] = [];
  let bytes = 0;
  let hidden = 0;
  return {
    write(line) {
      if (line.length > MAX_CONSOLE_LINE_CHARS) {
        throw new RangeError(`A console line is limited to ${MAX_CONSOLE_LINE_CHARS} characters.`);
      }
      const entry = { text: line, bytes: sizeOf(line) };
      lines.push(entry);
      bytes += entry.bytes;
      let dropped = 0;
      while (lines.length - dropped > MAX_CONSOLE_ENTRIES || (bytes > MAX_CONSOLE_BYTES && dropped < lines.length - 1)) {
        bytes -= lines[dropped]?.bytes ?? 0;
        dropped++;
      }
      if (dropped > 0) {
        lines.splice(0, dropped);
        hidden += dropped;
      }
    },
    snapshot: () => ({ lines: lines.map((entry) => entry.text), hidden }),
  };
}
