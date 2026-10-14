// YBC IR (YB plan §9.0, §9.1): the program dialect of Yolo:Bit-compatible
// projects. It is a separate type from the legacy `ProgramIR` in `ir.ts`,
// which stays exactly as it is; neither dialect is converted to the other.
//
// YB-1 only creates the skeleton: the two hats and a statement that does
// nothing. The typed values, expressions, variables and the capability ops
// arrive with the language in YB-2 and the hardware phases. The IR is never
// persisted.

export type YbcProgramIR = {
  onStart: YbcStatement[];
  /** null when the program has no forever block. */
  forever: YbcStatement[] | null;
};

/** A block the profile exposes that has no behaviour yet; the only statement of the skeleton. */
export type YbcStatement = { kind: 'noop'; blockId: string };
