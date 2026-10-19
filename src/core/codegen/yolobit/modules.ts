import type { CallStatement, Expr, PinCallStatement, PinReadExpr, ReadExpr, YbcProgramIR, YbcStatement } from '../../program/ybc-ir';

// The modules a generated file imports (contract §2, IM-1…IM-3). `import time` is always there; the lines below
// are the `yolobit` module's: its import and the three preamble lines that follow it (IM-2), exactly as the
// editor writes them. A program gets them only when it uses a construct of that module (plan §13.3 item 2: only
// what is used is imported).
//
// The text is written here, not read from `compat/yolobit-contract.ts`, so the large contract data stays out of
// the app bundle (see target.ts); generate.modules.test.ts keeps the two in step.

export const yolobitModuleLines: readonly string[] = [
  'from yolobit import *',
  'button_a.on_pressed = None',
  'button_b.on_pressed = None',
  'button_a.on_pressed_ab = button_b.on_pressed_ab = -1',
];

/**
 * Which module each hardware operation needs: the onboard parts of YB-3 and the header pins of YB-4 are the `yolobit`
 * module's, the sound is `music`'s (IM-3). Typed by the ops, so an op without an entry does not compile.
 */
export const moduleOfOp: Readonly<Record<CallStatement['op'] | PinCallStatement['op'] | ReadExpr['op'] | PinReadExpr['op'], 'yolobit' | 'music'>> = {
  'display.show': 'yolobit',
  'display.scrollText': 'yolobit',
  'display.scrollNumber': 'yolobit',
  'display.clear': 'yolobit',
  'display.setPixel': 'yolobit',
  'display.clearPixel': 'yolobit',
  'display.setAll': 'yolobit',
  'button.isPressed': 'yolobit',
  'button.getPresses': 'yolobit',
  'light.level': 'yolobit',
  'temperature.read': 'yolobit',
  'motion.acceleration': 'yolobit',
  'motion.isGesture': 'yolobit',
  'digital.write': 'yolobit',
  'digital.read': 'yolobit',
  'analogIn.read': 'yolobit',
  'sound.playNote': 'music',
  'sound.rest': 'music',
};

/**
 * Whether the program uses a construct that needs the `yolobit` module: a capability operation (`call` / `read`) of
 * that module (`moduleOfOp`: the header pins of YB-4, the onboard parts of YB-3; not the sound). An explicit walk, not
 * recursion, so no IR, however deep, can overflow the stack; a node met twice is looked at once.
 */
export function usesYolobitModule(ir: YbcProgramIR): boolean {
  const pending: (YbcStatement | Expr)[] = [];
  const seen = new Set<object>();
  const push = (nodes: readonly (YbcStatement | Expr)[]) => {
    for (const node of nodes) {
      pending.push(node);
    }
  };
  push(ir.onStart);
  push(ir.forever ?? []);
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (seen.has(node)) {
      continue;
    }
    seen.add(node);
    switch (node.kind) {
      case 'call':
      case 'read':
        if (moduleOfOp[node.op] === 'yolobit') {
          return true;
        }
        break;
      case 'set':
        pending.push(node.value);
        break;
      case 'print':
        pending.push(node.value);
        break;
      case 'if':
        for (const branch of node.branches) {
          pending.push(branch.condition);
          push(branch.body);
        }
        push(node.else);
        break;
      case 'repeat':
        pending.push(node.times);
        push(node.body);
        break;
      case 'while':
        pending.push(node.condition);
        push(node.body);
        break;
      case 'countUp':
        pending.push(node.from, node.to);
        push(node.body);
        break;
      case 'waitMs':
        pending.push(node.ms);
        break;
      case 'arith':
      case 'compare':
      case 'logic':
        pending.push(node.left, node.right);
        break;
      case 'not':
        pending.push(node.value);
        break;
      case 'join':
        push(node.parts);
        break;
      default:
        break;
    }
  }
  return false;
}
