// Program IR v0 (plan §6.3): only the nodes the current blocks need. The IR
// is never persisted, so it can change freely as blocks are added.

export type ProgramIR = {
  onStart: Statement[];
  /** null when the program has no forever block. */
  forever: Statement[] | null;
};

export type Statement =
  | { kind: 'digitalWrite'; pin: string; level: 0 | 1; blockId: string }
  | { kind: 'wait'; ms: number; blockId: string };
