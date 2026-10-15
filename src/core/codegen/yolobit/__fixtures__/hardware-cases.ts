import {
  add, and, bool, buttonPressed, buttonPresses, clearDisplay, cmp, countUp, getVar, ifElif, ifThen, images, join, lightLevel, mul, num, or,
  playNote, print, program, rest, scrollNumber, scrollText, setVar, showImage, text, wait, type Json,
} from '../../../program/__fixtures__/ybc-blocks';
import { noteNames, noteTicks } from '../../../constructs/ybc.sound';

// The programs of YB-3 that use the onboard hardware (display, buttons, light, sound), as Blockly JSON. Like the
// language cases of YB-5A (`lang-cases.ts`) each is compiled to the IR, run by the interpreter AND generated to
// Python; the golden of a case is `hardware/__golden__/<name>.py` (a separate folder, so the language goldens of
// YB-5A stay exactly as they were). `covers` lists the contract rows the case exercises.

export type HardwareCase = { name: string; covers: string[]; blocks: Json };

const x = () => getVar('x');

export const hardwareCases: HardwareCase[] = [
  // P1: a picture of its own, a pause, then a text.
  {
    name: 'image-then-text',
    covers: ['C-04', 'C-06', 'C-07'],
    blocks: program([showImage(images.RING), wait(num(1000)), scrollText(text('Hi'))]),
  },
  // P3: blink with show and clear.
  {
    name: 'blink-image',
    covers: ['C-04', 'C-06', 'C-09'],
    blocks: program([], [showImage(images.DOT), wait(num(500)), clearDisplay(), wait(num(500))]),
  },
  // P2: A and B change the picture (polling, no A+B).
  {
    name: 'button-images',
    covers: ['C-06', 'C-12', 'C-36'],
    blocks: program([], [ifElif([[buttonPressed('A'), [showImage(images.CROSS)]], [buttonPressed('B'), [showImage(images.RING)]]])]),
  },
  // P6: counting presses; the count is read once per pass and starts again from 0.
  {
    name: 'press-counter',
    covers: ['C-13', 'C-29', 'C-30'],
    blocks: program([setVar('x', num(0))], [setVar('x', add(x(), buttonPresses('A'))), print(x())]),
  },
  // P4: a night light on the light level.
  {
    name: 'night-light',
    covers: ['C-15', 'C-06', 'C-09', 'C-36'],
    blocks: program([], [ifThen(cmp('LT', lightLevel(), num(30)), [showImage(images.FULL)], [clearDisplay()])]),
  },
  // P5: a melody of notes and a rest, only the music module.
  {
    name: 'melody',
    covers: ['C-50', 'C-51'],
    blocks: program([playNote('C4', 4), playNote('E4', 4), playNote('G4', 4), rest(4), playNote('C5', 4)]),
  },
  // Every note of the domain and every length, so the golden pins the whole table.
  {
    name: 'all-notes-and-lengths',
    covers: ['C-50', 'C-51'],
    blocks: program([
      ...noteNames.map((note, index) => playNote(note, noteTicks[index % noteTicks.length] ?? 1)),
      ...noteTicks.map((ticks) => rest(ticks)),
    ]),
  },
  // Numbers and texts scrolled from expressions; a light level printed.
  {
    name: 'scroll-expressions',
    covers: ['C-07', 'C-08', 'C-15', 'C-29', 'C-56'],
    blocks: program([
      setVar('x', num(7)),
      scrollNumber(add(mul(x(), num(2)), num(1))),
      scrollText(join(text('n='), x())),
      scrollNumber(num(-12)),
      print(lightLevel()),
    ]),
  },
  // Both modules at once: the order of the header is fixed (time, yolobit with its preamble, music).
  {
    name: 'alarm-both-modules',
    covers: ['C-06', 'C-09', 'C-12', 'C-50', 'C-51'],
    blocks: program([], [ifThen(buttonPressed('A'), [playNote('A4', 2), showImage(images.FULL), rest(1), clearDisplay()])]),
  },
  // Reads inside and/or: the right side is not evaluated when the left decides (short-circuit), a read with a side effect included.
  {
    name: 'reads-short-circuit',
    covers: ['C-12', 'C-13', 'C-15', 'C-35'],
    blocks: program([
      print(and(bool(false), cmp('GT', buttonPresses('A'), num(0)))),
      print(or(bool(true), buttonPressed('B'))),
      print(and(cmp('GT', lightLevel(), num(10)), buttonPressed('B'))),
      print(or(buttonPressed('A'), cmp('EQ', buttonPresses('B'), num(1)))),
    ]),
  },
  // Contract §3.3 / plan §18.3: the bounds are read once each, start first, so reading the press count twice gives two different numbers.
  {
    name: 'count-up-reads-bounds-once',
    covers: ['C-13', 'C-39', 'C-29'],
    blocks: program([countUp('i', buttonPresses('A'), buttonPresses('A'), 1, [print(getVar('i'))])], undefined, ['x', 'y', 'z', 'i']),
  },
];
