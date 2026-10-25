import { z } from 'zod';
import { arduinoCalls, pinCaps, type BoardProfile } from './board';

// Validation of a board profile (N18 R1.1, robot plan §4.1, B6): the shape with Zod, then the rules between fields. Bad data
// is refused with every problem and its path (`pins.5.pwmTimer: …`), so a vendor board file says where it is wrong.

/** One problem of hardware data: where (`ports.0.pins.EN`) and what. */
export type DataIssue = { path: string; message: string };

/** Hardware data (a board profile, a kit) that is not valid. The message lists every issue, one per line. */
export class HardwareDataError extends Error {
  readonly issues: readonly DataIssue[];

  constructor(what: string, issues: readonly DataIssue[]) {
    super(`${what} is not valid:\n${issues.map((issue) => `  ${issue.path || '(root)'}: ${issue.message}`).join('\n')}`);
    this.name = 'HardwareDataError';
    this.issues = issues;
  }
}

export const pathOf = (path: readonly PropertyKey[]): string => path.map(String).join('.');

/** The issues of a failed Zod parse, with their paths. */
export function zodIssues(error: z.ZodError): DataIssue[] {
  return error.issues.map((issue) => ({ path: pathOf(issue.path), message: issue.message }));
}

const positive = z.number().positive();
const positiveInt = z.number().int().positive();

const boardPinSchema = z.strictObject({
  id: z.string().min(1),
  caps: z.array(z.enum(pinCaps)).min(1),
  pwmTimer: z.string().min(1).optional(),
});

export const boardProfileSchema = z.strictObject({
  id: z.string().min(1),
  version: z.string().min(1),
  mcu: z.string().min(1),
  clockHz: positiveInt,
  adcMax: positiveInt,
  pwmMax: positiveInt,
  nonPwmThreshold: positiveInt,
  pins: z.array(boardPinSchema).min(1),
  reserved: z.array(z.strictObject({ pin: z.string(), when: z.literal('serial') })),
  timerClaims: z.record(z.string(), z.string()),
  costsUs: z.strictObject(Object.fromEntries(arduinoCalls.map((call) => [call, positive])) as Record<(typeof arduinoCalls)[number], typeof positive>),
  toneUs: z.array(z.strictObject({ prescaler: positiveInt, fromHz: positive, silentUs: positive, playingUs: positive })).min(1),
  millis: z.strictObject({ overflowUs: positive, fractPerOverflow: positiveInt, fractMax: positiveInt }),
  emulator: z.literal('avr8js').optional(),
});

/** The rules between fields that the shape cannot say. */
function boardRuleIssues(board: z.infer<typeof boardProfileSchema>): DataIssue[] {
  const issues: DataIssue[] = [];
  const seen = new Set<string>();
  board.pins.forEach((pin, index) => {
    if (seen.has(pin.id)) {
      issues.push({ path: `pins.${String(index)}.id`, message: `pin ${pin.id} is listed twice` });
    }
    seen.add(pin.id);
    if (!pin.caps.includes('digital')) {
      issues.push({ path: `pins.${String(index)}.caps`, message: `pin ${pin.id} has no digital capability` });
    }
    if (pin.caps.includes('pwm') && pin.pwmTimer === undefined) {
      issues.push({ path: `pins.${String(index)}.pwmTimer`, message: `pwm pin ${pin.id} names no timer` });
    }
    if (!pin.caps.includes('pwm') && pin.pwmTimer !== undefined) {
      issues.push({ path: `pins.${String(index)}.pwmTimer`, message: `pin ${pin.id} has a timer but no pwm` });
    }
  });
  board.reserved.forEach((entry, index) => {
    if (!seen.has(entry.pin)) {
      issues.push({ path: `reserved.${String(index)}.pin`, message: `pin ${entry.pin} is not on the board` });
    }
  });
  const timers = new Set(board.pins.flatMap((pin) => (pin.pwmTimer === undefined ? [] : [pin.pwmTimer])));
  for (const [claimer, timer] of Object.entries(board.timerClaims)) {
    if (!timers.has(timer)) {
      issues.push({ path: `timerClaims.${claimer}`, message: `no pin of the board has timer ${timer}` });
    }
  }
  board.toneUs.forEach((band, index) => {
    const before = board.toneUs[index - 1];
    if (before && !(band.fromHz > before.fromHz)) {
      issues.push({ path: `toneUs.${String(index)}.fromHz`, message: `tone cost bands go from the lowest frequency up: ${String(band.fromHz)} Hz after ${String(before.fromHz)} Hz` });
    }
  });
  return issues;
}

/** Parses a board profile; throws a HardwareDataError naming the path of every problem. */
export function loadBoard(json: unknown): BoardProfile {
  const parsed = boardProfileSchema.safeParse(json);
  if (!parsed.success) {
    throw new HardwareDataError('Board profile', zodIssues(parsed.error));
  }
  const issues = boardRuleIssues(parsed.data);
  if (issues.length > 0) {
    throw new HardwareDataError(`Board profile "${parsed.data.id}"`, issues);
  }
  return parsed.data;
}
