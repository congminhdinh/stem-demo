import {
  acceleration, add, and, bool, buttonPressed, buttonPresses, clearDisplay, clearPixel, cmp, colour, countUp, gestureIs, getVar, ifElif, ifThen, images,
  join, lightLevel, mul, num, or, playMelody, playNote, playPitch, print, program, randomInt, rest, runningTime, scrollNumber, scrollNumberIn, scrollText,
  scrollTextIn, setAll, setPixel, setVar, showIcon, showImage, showImageIn, stopSound, sub, temperature, text, wait, type Json,
} from '../../../program/__fixtures__/ybc-blocks';
import { melodyNames } from '../../../constructs/ybc.sound';
import { noteNames, noteTicks } from '../../../constructs/ybc.sound';

// The programs of YB-3 that use the onboard hardware (display, buttons, light, sound), as Blockly JSON. Like the
// language cases of YB-5A (`lang-cases.ts`) each is compiled to the IR, run by the interpreter AND generated to
// Python; the golden of a case is `hardware/__golden__/<name>.py` (a separate folder, so the language goldens of
// YB-5A stay exactly as they were). `covers` lists the contract rows the case exercises.

/** `profiles`: the profiles whose packs have every block of the case; both when absent (N17 B2: the sensors are Advanced only). */
export type HardwareCase = { name: string; covers: string[]; blocks: Json; profiles?: readonly ('ybc-basic' | 'ybc-advanced')[] };

/** Whether a case's blocks are all in the profile's packs. */
export const caseIsIn = (hardwareCase: HardwareCase, profile: 'ybc-basic' | 'ybc-advanced') => (hardwareCase.profiles ?? ['ybc-basic', 'ybc-advanced']).includes(profile);

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
  // N17 B1: built-in pictures. The vendor's names are written `Image.<NAME>` (investigation §5.3); the arrows, which the vendor's
  // editor does not offer, are written as a picture of our own (the C-06 form), so the board shows what the simulator shows.
  {
    name: 'builtin-icons',
    covers: ['C-05', 'C-04', 'C-06'],
    blocks: program([showIcon('HEART'), wait(num(500)), showIcon('ARROW_N'), showIcon('HAPPY')]),
  },
  // N17 B1: the RGB display: fill, one pixel, one pixel off, a coloured picture (the palette digit), a coloured text and number.
  {
    name: 'pixels-and-colours',
    covers: ['C-43', 'C-10', 'C-42', 'C-06', 'C-07', 'C-08'],
    blocks: program([
      setAll(colour('#0000ff')),
      setPixel(num(2), num(3), colour('#00ff00')),
      clearPixel(num(0), num(0)),
      showImageIn(images.CROSS, '#ffa500'),
      scrollTextIn(text('Hi'), colour('#ffff00')),
      scrollNumberIn(num(42), colour('#ffffff')),
    ]),
  },
  // N17 B1: a light that walks along row 2: computed coordinates, each pixel set and then cleared.
  {
    name: 'pixel-walk',
    covers: ['C-10', 'C-42', 'C-39', 'C-04'],
    blocks: program([], [countUp('x', num(0), num(4), 1, [setPixel(getVar('x'), num(2), colour('#ff0000')), wait(num(100)), clearPixel(getVar('x'), num(2))])]),
  },
  // N17 B2: a thermometer. The generator writes int(temperature()) (C-16): the board's temperature() is a float.
  {
    name: 'thermometer',
    covers: ['C-16', 'C-06', 'C-08', 'C-34', 'C-36'],
    profiles: ['ybc-advanced'],
    blocks: program([], [ifThen(cmp('GT', temperature(), num(30)), [showImage(images.FULL)], [scrollNumber(temperature())])]),
  },
  // N17 B2: shake and tilt: the verified gesture "shake" and one more of the seven (UNVERIFIED names).
  {
    name: 'tilt-and-shake',
    covers: ['C-18', 'C-06', 'C-09', 'C-36'],
    profiles: ['ybc-advanced'],
    blocks: program([], [ifElif([[gestureIs('shake'), [showImage(images.FULL)]], [gestureIs('tilt_left'), [showImage(images.CROSS)]]], [clearDisplay()])]),
  },
  // N17 B2: the three axes (get_x is the verified form, get_y and get_z UNVERIFIED), the other gestures, a temperature in a sum.
  {
    name: 'accelerometer-readings',
    covers: ['C-17', 'C-18', 'C-16', 'C-08', 'C-29', 'C-30'],
    profiles: ['ybc-advanced'],
    blocks: program([
      setVar('x', acceleration('x')),
      setVar('y', acceleration('y')),
      setVar('z', acceleration('z')),
      print(add(add(getVar('x'), getVar('y')), getVar('z'))),
      print(gestureIs('tilt_right')),
      print(gestureIs('face_up')),
      print(gestureIs('face_down')),
      print(gestureIs('logo_up')),
      print(gestureIs('logo_down')),
      scrollNumber(sub(temperature(), num(10))),
    ]),
  },
  // N17 B3: a built-in melody in the background while a picture shows (the verified form, investigation §5.3), stop, a tone that
  // does not wait (EVD-06), then a melody that waits until it is done (UNVERIFIED form: wait=True with a melody).
  {
    name: 'melodies-and-tones',
    covers: ['C-20', 'C-21', 'C-22', 'C-05', 'C-04'],
    profiles: ['ybc-advanced'],
    blocks: program([
      playMelody('BIRTHDAY', 'background'),
      showIcon('HEART'),
      wait(num(1000)),
      stopSound(),
      playPitch(num(440), num(500)),
      wait(num(500)),
      playMelody('POWER_UP', 'wait'),
    ]),
  },
  // N17 B3: every melody of the dropdown, each replacing the one before it at once, then stop; and a tone whose pitch is computed,
  // started on every pass while A is held.
  {
    name: 'every-melody',
    covers: ['C-20', 'C-21', 'C-22', 'C-12', 'C-29', 'C-30', 'C-36'],
    profiles: ['ybc-advanced'],
    blocks: program(
      [...melodyNames.map((name) => playMelody(name, 'background')), stopSound()],
      [ifThen(buttonPressed('A'), [playPitch(add(mul(x(), num(10)), num(200)), num(100)), setVar('x', add(x(), num(1)))])],
    ),
  },
  // N17 B4: A+B (the `and` of the two C-12 reads, never the editor's is_pressed_ab()) before A alone, and the running time since the
  // program started, kept at the start and taken from the running time while A+B is held.
  {
    name: 'both-buttons-and-running-time',
    covers: ['C-12', 'C-19', 'C-06', 'C-09', 'C-29', 'C-30', 'C-36'],
    blocks: program(
      [setVar('x', runningTime())],
      [ifElif([[buttonPressed('A+B'), [showImage(images.FULL), print(sub(runningTime(), x()))]], [buttonPressed('A'), [showImage(images.CROSS)]]], [clearDisplay()])],
    ),
  },
  // N17 B4: a dice. Typed-in ends are written low first (6 to 1 is 1 to 6), computed ends that read nothing as min and max; A rolls
  // one from 1 to 6 and shows it. `import random` once, after the other imports.
  {
    name: 'dice',
    covers: ['C-40', 'C-08', 'C-12', 'C-04', 'C-29', 'C-30', 'C-36'],
    blocks: program(
      [setVar('y', randomInt(num(6), num(1))), setVar('z', randomInt(getVar('y'), num(10))), print(getVar('z'))],
      [ifThen(buttonPressed('A'), [scrollNumber(randomInt(num(1), num(6))), wait(num(500))])],
    ),
  },
];
