// Program IR (plan §6.3): only the nodes the current blocks need. The IR is
// never persisted, so it can change freely as blocks are added.

export type ProgramIR = {
  onStart: Statement[];
  /** null when the program has no forever block. */
  forever: Statement[] | null;
};

export type Statement =
  | { kind: 'digitalWrite'; pin: string; level: 0 | 1; blockId: string }
  | { kind: 'wait'; ms: number; blockId: string }
  /**
   * One Blockly "if" block: the first branch whose condition holds runs, or
   * `else` when none does. Else-if branches follow the "if" one, in order.
   */
  | { kind: 'if'; branches: { condition: Expression; body: Statement[] }[]; else: Statement[]; blockId: string };

/** A Boolean condition (plan §6.3, M3). */
export type Expression =
  /** True while the pin reads HIGH. */
  | { kind: 'digitalRead'; pin: string; blockId: string }
  | { kind: 'not'; value: Expression; blockId: string };
