// N19 D4 spike: draft programs of the four lessons (the final ones are in src/samples/robot-solutions.ts).
import { claw, clawAngle, compare, drive, hat, ifBlock, irDetect, lift, liftAngle, lineDark, not, numberBlock, repeat, stop, ultrasonic, wait, whileBlock, workspace, colorIs } from '../../src/samples/robot-solutions';

type Json = Record<string, unknown>;
const P = Number(process.env.P ?? 50);

export const follow = (p: string, speed = 50): readonly (readonly [Json, readonly Json[]])[] => [
  [lineDark(`${p}-c`, 'lineCenter'), [drive(`${p}-f`, 'forward', speed)]],
  [lineDark(`${p}-l`, 'lineLeft'), [drive(`${p}-sl`, 'spinLeft', speed)]],
  [lineDark(`${p}-r`, 'lineRight'), [drive(`${p}-sr`, 'spinRight', speed)]],
];

export const grabHere = (p: string): Json[] => [stop(`${p}-stop`), claw(`${p}-close`, 'CLOSE'), wait(`${p}-cw`, 300), lift(`${p}-up`, 'UP'), wait(`${p}-uw`, 300)];
export const release = (p: string): Json[] => [stop(`${p}-stop`), lift(`${p}-down`, 'DOWN'), wait(`${p}-dw`, 300), claw(`${p}-open`, 'OPEN'), wait(`${p}-ow`, 300)];

export function deliverRef(turnMs = Number(process.env.TURN ?? 900), carryMs = Number(process.env.CARRY ?? 2200)) {
  return workspace(
    hat('stem_on_start', [
      lift('down', 'DOWN'),
      claw('open', 'OPEN'),
      repeat('parcels', 3, [
        whileBlock('to-parcel', not('no-parcel', irDetect('ir')), [ifBlock('follow', follow('line'))]),
        ...grabHere('grab'),
        drive('turn', 'spinLeft', 50),
        wait('turn-time', turnMs),
        drive('carry', 'forward', 50),
        wait('carry-time', carryMs),
        ...release('put'),
        drive('back', 'backward', 50),
        wait('back-time', carryMs),
        drive('find', 'spinRight', 50),
        whileBlock('to-line', not('off-line', lineDark('find-c', 'lineCenter')), []),
      ]),
      stop('done'),
    ]),
  );
}

export function pickRef(fast = Number(process.env.FAST ?? 70), dropCm = Number(process.env.DROP ?? 45)) {
  return workspace(
    hat('stem_on_start', [
      lift('down', 'DOWN'),
      claw('open', 'OPEN'),
      wait('settle', 300),
      drive('go', 'forward', fast),
      whileBlock('to-cube', compare('far', 'GT', ultrasonic('far-cm'), numberBlock('far-15', 15)), []),
      drive('slow', 'forward', 50),
      whileBlock('to-jaws', not('no-cube', irDetect('ir')), []),
      ...grabHere('grab'),
      drive('carry', 'forward', 60),
      whileBlock('to-drop', compare('wall-far', 'GT', ultrasonic('wall-cm'), numberBlock('drop-cm', dropCm)), []),
      ...release('put'),
      drive('back', 'backward', 50),
      wait('back-time', 1000),
      stop('done'),
    ]),
  );
}
export { P, colorIs, liftAngle, compare };

export function pickBlind(t1 = Number(process.env.T1 ?? 2900), t2 = Number(process.env.T2 ?? 3300)) {
  return workspace(
    hat('stem_on_start', [
      lift('down', 'DOWN'), claw('open', 'OPEN'), wait('settle', 300),
      drive('go', 'forward', 50), wait('go-time', t1),
      ...grabHere('grab'),
      drive('carry', 'forward', 60), wait('carry-time', t2),
      ...release('put'),
      drive('back', 'backward', 50), wait('back-time', 1000), stop('done'),
    ]),
  );
}
/** The reference without lowering the arm. */
export function pickNeverLower(fast = 70, dropCm = 45) {
  return workspace(
    hat('stem_on_start', [
      claw('open', 'OPEN'), wait('settle', 300),
      drive('go', 'forward', fast),
      whileBlock('to-cube', compare('far', 'GT', ultrasonic('far-cm'), numberBlock('far-15', 15)), []),
      drive('slow', 'forward', 50),
      whileBlock('to-jaws', not('no-cube', irDetect('ir')), []),
      ...grabHere('grab'),
      drive('carry', 'forward', 60),
      whileBlock('to-drop', compare('wall-far', 'GT', ultrasonic('wall-cm'), numberBlock('drop-cm', dropCm)), []),
      ...release('put'),
      drive('back', 'backward', 50), wait('back-time', 1000), stop('done'),
    ]),
  );
}
/** Arm down, claw open, push the cube for a time into the drop zone, back off. */
export function pickPushIn(t = Number(process.env.T ?? 6000)) {
  return workspace(
    hat('stem_on_start', [lift('down', 'DOWN'), claw('open', 'OPEN'), wait('settle', 300), drive('push', 'forward', 50), wait('push-time', t), stop('stop'), drive('back', 'backward', 50), wait('back-time', 1000), stop('done')]),
  );
}
/** The reference that never lets the cube go: it carries it into the drop zone and holds it there. */
export function pickHoldInZone(fast = 70, dropCm = 45) {
  return workspace(
    hat('stem_on_start', [
      lift('down', 'DOWN'), claw('open', 'OPEN'), wait('settle', 300),
      drive('go', 'forward', fast),
      whileBlock('to-cube', compare('far', 'GT', ultrasonic('far-cm'), numberBlock('far-15', 15)), []),
      drive('slow', 'forward', 50),
      whileBlock('to-jaws', not('no-cube', irDetect('ir')), []),
      ...grabHere('grab'),
      drive('carry', 'forward', 60),
      whileBlock('to-drop', compare('wall-far', 'GT', ultrasonic('wall-cm'), numberBlock('drop-cm', dropCm)), []),
      stop('hold'), lift('down', 'DOWN'),
    ]),
  );
}

const deliverOne = (p: string, turnMs: number, carryMs: number): Json[] => [
  ...grabHere(`${p}-grab`),
  drive(`${p}-turn`, 'spinLeft', 50), wait(`${p}-turn-time`, turnMs),
  drive(`${p}-carry`, 'forward', 50), wait(`${p}-carry-time`, carryMs),
  ...release(`${p}-put`),
  drive(`${p}-back`, 'backward', 50), wait(`${p}-back-time`, carryMs),
  drive(`${p}-return`, 'spinRight', 50), wait(`${p}-return-time`, turnMs),
];
export function deliverBlind(t1 = Number(process.env.T1 ?? 2800), t2 = Number(process.env.T2 ?? 1900)) {
  return workspace(
    hat('stem_on_start', [
      lift('down', 'DOWN'), claw('open', 'OPEN'), wait('settle', 300),
      drive('leg-1', 'forward', 50), wait('leg-1-time', t1), ...deliverOne('p1', 900, 2200),
      drive('leg-2', 'forward', 50), wait('leg-2-time', t2), ...deliverOne('p2', 900, 2200),
      drive('leg-3', 'forward', 50), wait('leg-3-time', t2), ...deliverOne('p3', 900, 2200),
      stop('done'),
    ]),
  );
}

/** Arm down, claw open, the follower for 8 s: it shoves the parcels north up the line, then backs off. */
export function deliverPushNorth(t = Number(process.env.T ?? 8000)) {
  return workspace(
    hat('stem_on_start', [
      lift('down', 'DOWN'), claw('open', 'OPEN'), wait('settle', 300),
      repeat('shove', Number(process.env.N ?? 60000), [ifBlock('follow', follow('line'))]),
      stop('stop'), drive('back', 'backward', 50), wait('back-time', 1000), stop('done'),
    ]),
  );
}
/**
 * The D2 review's sweep: to each parcel on the line, then with the claw still open spin left and drive on, sweeping it into the warehouse
 * between the open jaws; there close, lift the arm to 14° (the parcel 1 cm up), hold, lower, open, back off and find the line again.
 */
export function deliverSweepLift(turnMs = 900, carryMs = 2200, liftDeg = Number(process.env.LIFT ?? 14)) {
  return workspace(
    hat('stem_on_start', [
      lift('down', 'DOWN'),
      claw('open', 'OPEN'),
      repeat('parcels', 3, [
        whileBlock('to-parcel', not('no-parcel', irDetect('ir')), [ifBlock('follow', follow('line'))]),
        stop('at-parcel'),
        clawAngle('cage', Number(process.env.CAGE ?? 15)),
        drive('turn', 'spinLeft', 50), wait('turn-time', turnMs),
        drive('sweep', 'forward', 50), wait('sweep-time', carryMs),
        stop('in-kho'), claw('close', 'CLOSE'), wait('close-time', 300), liftAngle('lift-1cm', liftDeg), wait('hold-time', 500),
        lift('lower', 'DOWN'), wait('lower-time', 300), claw('let-go', 'OPEN'), wait('open-time', 300),
        drive('back', 'backward', 50), wait('back-time', carryMs),
        drive('find', 'spinRight', 50),
        whileBlock('to-line', not('off-line', lineDark('find-c', 'lineCenter')), []),
      ]),
      stop('done'),
    ]),
  );
}

export function sortRef(turnMs = Number(process.env.TURN ?? 900), carryMs = Number(process.env.CARRY ?? 3000)) {
  return workspace(
    hat('stem_on_start', [
      lift('down', 'DOWN'), claw('open', 'OPEN'), wait('settle', 300),
      drive('go', 'forward', 50),
      whileBlock('to-cube', not('no-cube', irDetect('ir')), []),
      ...grabHere('grab'),
      ifBlock('which-zone', [
        [colorIs('is-red', 'red'), [drive('to-red', 'spinLeft', 50), wait('to-red-time', turnMs)]],
        [colorIs('is-blue', 'blue'), [drive('to-blue', 'spinRight', 50), wait('to-blue-time', turnMs)]],
      ]),
      drive('carry', 'forward', 50), wait('carry-time', carryMs),
      ...release('put'),
      drive('back', 'backward', 50), wait('back-time', 1000), stop('done'),
    ]),
  );
}

import { logicOr } from './extra';
export function stackRef(liftDeg = Number(process.env.LIFT ?? 55)) {
  return workspace(
    hat('stem_on_start', [
      lift('down', 'DOWN'), claw('open', 'OPEN'), wait('settle', 300),
      whileBlock('to-cube', not('no-cube', irDetect('ir')), [ifBlock('follow', follow('line'))]),
      stop('at-cube'), claw('close', 'CLOSE'), wait('close-time', 300), liftAngle('carry-height', liftDeg), wait('lift-time', 300),
      whileBlock('to-end', logicOr('on-line', lineDark('on-l', 'lineLeft'), logicOr('on-line-2', lineDark('on-c', 'lineCenter'), lineDark('on-r', 'lineRight'))), [ifBlock('follow-2', follow('line-2'))]),
      stop('at-end'), wait('settle-2', 300), claw('let-go', 'OPEN'), wait('open-time', 500),
      drive('back', 'backward', 50), wait('back-time', 1000), stop('done'),
    ]),
  );
}

/** Grab, then always the left turn (the red zone's), whatever the colour. */
export function sortAlwaysLeft(turnMs = 900, carryMs = 3000) {
  return workspace(
    hat('stem_on_start', [
      lift('down', 'DOWN'), claw('open', 'OPEN'), wait('settle', 300),
      drive('go', 'forward', 50), whileBlock('to-cube', not('no-cube', irDetect('ir')), []),
      ...grabHere('grab'),
      drive('to-red', 'spinLeft', 50), wait('to-red-time', turnMs),
      drive('carry', 'forward', 50), wait('carry-time', carryMs),
      ...release('put'), drive('back', 'backward', 50), wait('back-time', 1000), stop('done'),
    ]),
  );
}
/** Grab, then left for red and straight for anything else: blue goes to the green zone. */
export function sortOnlyRed(turnMs = 900, carryMs = 3000) {
  return workspace(
    hat('stem_on_start', [
      lift('down', 'DOWN'), claw('open', 'OPEN'), wait('settle', 300),
      drive('go', 'forward', 50), whileBlock('to-cube', not('no-cube', irDetect('ir')), []),
      ...grabHere('grab'),
      ifBlock('if-red', [[colorIs('is-red', 'red'), [drive('to-red', 'spinLeft', 50), wait('to-red-time', turnMs)]]]),
      drive('carry', 'forward', 50), wait('carry-time', carryMs),
      ...release('put'), drive('back', 'backward', 50), wait('back-time', 1000), stop('done'),
    ]),
  );
}

const stackEnd = (p: string): Json[] => [
  whileBlock(`${p}-to-end`, logicOr(`${p}-on`, lineDark(`${p}-l`, 'lineLeft'), logicOr(`${p}-on-2`, lineDark(`${p}-c`, 'lineCenter'), lineDark(`${p}-r`, 'lineRight'))), [ifBlock(`${p}-follow`, follow(`${p}-line`))]),
  stop(`${p}-at-end`), wait(`${p}-settle`, 300),
];
const stackGrab = (p: string, liftDeg = 55): Json[] => [
  lift(`${p}-down`, 'DOWN'), claw(`${p}-open`, 'OPEN'), wait(`${p}-settle`, 300),
  whileBlock(`${p}-to-cube`, not(`${p}-no-cube`, irDetect(`${p}-ir`)), [ifBlock(`${p}-follow`, follow(`${p}-line`))]),
  stop(`${p}-at-cube`), claw(`${p}-close`, 'CLOSE'), wait(`${p}-close-time`, 300), liftAngle(`${p}-carry-height`, liftDeg), wait(`${p}-lift-time`, 300),
];
export function stackBlind(t1 = Number(process.env.T1 ?? 3700), t2 = Number(process.env.T2 ?? 4700)) {
  return workspace(
    hat('stem_on_start', [
      lift('down', 'DOWN'), claw('open', 'OPEN'), wait('settle', 300),
      drive('go', 'forward', 50), wait('go-time', t1),
      stop('at-cube'), claw('close', 'CLOSE'), wait('close-time', 300), liftAngle('carry-height', 55), wait('lift-time', 300),
      drive('carry', 'forward', 50), wait('carry-time', t2),
      stop('at-base'), wait('settle-2', 300), claw('let-go', 'OPEN'), wait('open-time', 500),
      drive('back', 'backward', 50), wait('back-time', 1000), stop('done'),
    ]),
  );
}
/** Grab, carry along the line for 3 s, short of the base, and put the cube down on the floor there. */
export function stackBeside(t = Number(process.env.T ?? 3000)) {
  return workspace(
    hat('stem_on_start', [
      ...stackGrab('g'),
      repeat('carry', 1, [drive('carry-go', 'forward', 50), wait('carry-time', t)]),
      ...release('put'), drive('back', 'backward', 50), wait('back-time', 1000), stop('done'),
    ]),
  );
}
/** The reference without letting go: the cube held over the base to the end. */
export function stackHoldOver() {
  return workspace(hat('stem_on_start', [...stackGrab('g'), ...stackEnd('e')]));
}
/** The reference that lowers the arm all the way at the end of the line before letting go. */
export function stackLowerFully() {
  return workspace(
    hat('stem_on_start', [
      ...stackGrab('g'), ...stackEnd('e'),
      lift('lower', 'DOWN'), wait('lower-time', 500), claw('let-go', 'OPEN'), wait('open-time', 500),
      drive('back', 'backward', 50), wait('back-time', 1000), stop('done'),
    ]),
  );
}

/** Grab, but carry with the arm too low (LIFT, 45° or 0°) to the end of the line, then let go. */
export function stackCarryLow(liftDeg = Number(process.env.LIFT ?? 45)) {
  return workspace(
    hat('stem_on_start', [
      ...stackGrab('g', liftDeg), ...stackEnd('e'),
      claw('let-go', 'OPEN'), wait('open-time', 500), drive('back', 'backward', 50), wait('back-time', 1000), stop('done'),
    ]),
  );
}
