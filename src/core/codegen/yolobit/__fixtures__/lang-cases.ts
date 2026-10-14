import {
  add, and, bool, cmp, countUp, getVar, idiv, ifElif, ifThen, join, mod, mul, not, num, or, print, program, repeat,
  setVar, sub, text, wait, whileLoop, type Json,
} from '../../../program/__fixtures__/ybc-blocks';

// The language programs of YB-5A, as Blockly JSON: each is compiled to the IR, run by the
// interpreter AND generated to Python. The golden of a case is `__golden__/<name>.py`.
// `covers` lists the contract rows the case exercises; `parity` marks the cases that
// also run under CPython and print the same lines as the simulator (no `wait`: the
// parity harness stops each program at its first 10 ms pause).

export type LangCase = { name: string; covers: string[]; blocks: Json; parity: boolean };

/** A workspace with the given variables (id, name) instead of x, y and z. */
const withVariables = (blocks: Json, variables: [id: string, name: string][]): Json => ({
  ...blocks,
  variables: variables.map(([id, name]) => ({ id, name })),
});

const nestedAdd = (depth: number): Json => (depth === 0 ? num(1) : add(num(1), nestedAdd(depth - 1)));

const x = () => getVar('x');
const y = () => getVar('y');
const z = () => getVar('z');

export const langCases: LangCase[] = [
  { name: 'empty-program', covers: ['C-01', 'C-02'], parity: true, blocks: program([]) },
  { name: 'on-start-print', covers: ['C-01', 'C-29'], parity: true, blocks: program([print(text('hello')), print(num(42)), print(bool(true))]) },
  { name: 'forever-print', covers: ['C-02', 'C-29'], parity: true, blocks: program([print(text('start'))], [print(text('tick'))]) },
  { name: 'forever-empty', covers: ['C-02'], parity: true, blocks: program([], []) },
  {
    name: 'wait',
    covers: ['C-04'],
    parity: false,
    blocks: program([wait(num(0)), wait(num(1000)), setVar('x', num(250)), wait(x())], [wait(num(60000))]),
  },
  {
    name: 'variables',
    covers: ['C-30'],
    parity: true,
    blocks: program([setVar('x', num(1)), setVar('y', add(x(), num(2))), setVar('x', mul(y(), y())), print(x()), print(y()), print(z())]),
  },
  {
    name: 'arithmetic',
    covers: ['C-31', 'C-32', 'C-33'],
    parity: true,
    blocks: program([
      setVar('x', num(7)),
      setVar('y', num(-3)),
      setVar('z', num(2)),
      print(add(x(), y())),
      print(sub(x(), y())),
      print(mul(x(), y())),
      print(idiv(x(), y())),
      print(mod(x(), y())),
      print(idiv(y(), z())),
      print(mod(y(), z())),
      print(mul(add(x(), y()), z())),
      print(add(x(), mul(y(), z()))),
      print(sub(x(), sub(y(), z()))),
      print(sub(sub(x(), y()), z())),
      print(idiv(x(), add(z(), num(1)))),
      print(mod(x(), sub(num(0), z()))),
      print(mod(idiv(x(), z()), mul(z(), num(2)))),
      print(add(x(), num(-5))),
      print(sub(num(-5), num(-6))),
    ]),
  },
  {
    name: 'comparisons',
    covers: ['C-34'],
    parity: true,
    blocks: program([
      setVar('x', num(3)),
      setVar('y', num(5)),
      print(cmp('EQ', x(), y())),
      print(cmp('NEQ', x(), y())),
      print(cmp('LT', x(), y())),
      print(cmp('LTE', x(), num(3))),
      print(cmp('GT', x(), y())),
      print(cmp('GTE', add(x(), num(2)), y())),
      print(cmp('EQ', text('a'), text('a'))),
      print(cmp('EQ', cmp('LT', x(), y()), cmp('GT', x(), y()))),
      print(cmp('LT', add(x(), mul(y(), num(2))), sub(num(20), x()))),
    ]),
  },
  {
    name: 'logic',
    covers: ['C-35'],
    parity: true,
    blocks: program([
      setVar('x', num(1)),
      setVar('y', num(2)),
      print(and(cmp('LT', x(), y()), cmp('NEQ', y(), num(3)))),
      print(or(bool(false), cmp('EQ', x(), y()))),
      print(not(cmp('EQ', x(), y()))),
      print(not(not(bool(true)))),
      print(and(or(bool(true), bool(false)), not(bool(false)))),
      print(or(and(bool(true), bool(false)), and(bool(true), bool(true)))),
      print(and(bool(true), and(bool(true), bool(false)))),
      print(or(bool(false), or(bool(false), bool(true)))),
    ]),
  },
  {
    name: 'short-circuit',
    covers: ['C-35'],
    parity: true,
    blocks: program([
      setVar('x', num(0)),
      ifThen(and(bool(false), cmp('EQ', idiv(num(1), x()), num(1))), [print(text('no'))], [print(text('and skipped'))]),
      ifThen(or(bool(true), cmp('EQ', idiv(num(1), x()), num(1))), [print(text('or skipped'))]),
    ]),
  },
  {
    name: 'if',
    covers: ['C-36'],
    parity: true,
    blocks: program([setVar('x', num(4)), ifThen(cmp('GT', x(), num(3)), [print(text('big')), setVar('y', num(1))])]),
  },
  {
    name: 'if-else',
    covers: ['C-36'],
    parity: true,
    blocks: program([setVar('x', num(1)), ifThen(cmp('GT', x(), num(3)), [print(text('big'))], [print(text('small'))])]),
  },
  {
    name: 'if-elif-else',
    covers: ['C-36'],
    parity: true,
    blocks: program([
      setVar('x', num(5)),
      ifElif(
        [
          [cmp('LT', x(), num(3)), [print(text('low'))]],
          [cmp('LT', x(), num(7)), [print(text('middle'))]],
          [cmp('LT', x(), num(9)), [print(text('high'))]],
        ],
        [print(text('top'))],
      ),
      ifElif([
        [cmp('EQ', x(), num(1)), [print(text('one'))]],
        [cmp('EQ', x(), num(5)), [print(text('five'))]],
      ]),
    ]),
  },
  {
    name: 'empty-suites',
    covers: ['C-36', 'C-37', 'C-38', 'C-39'],
    parity: true,
    blocks: program(
      [
        ifElif([[bool(true), []], [bool(false), [print(text('x'))]]], []),
        ifThen(bool(false), [print(text('x'))], []),
        ifElif([[bool(false), [print(text('x'))]], [bool(true), []]]),
        repeat(num(2), []),
        whileLoop(bool(false), []),
        countUp('x', num(1), num(2), 1, []),
        print(text('done')),
      ],
      [],
    ),
  },
  {
    name: 'repeat',
    covers: ['C-37'],
    parity: true,
    blocks: program([
      repeat(num(3), [print(text('hi'))]),
      repeat(num(0), [print(text('never'))]),
      repeat(num(-4), [print(text('never'))]),
      setVar('x', num(2)),
      repeat(add(x(), num(1)), [setVar('y', add(y(), x())), setVar('x', num(10))]),
      print(y()),
      repeat(num(2), [repeat(num(2), [print(text('in'))]), print(text('out'))]),
    ]),
  },
  {
    name: 'while',
    covers: ['C-38'],
    parity: true,
    blocks: program([
      setVar('x', num(3)),
      whileLoop(cmp('GT', x(), num(0)), [print(x()), setVar('x', sub(x(), num(1)))]),
      whileLoop(cmp('EQ', x(), num(0)), [setVar('x', num(5)), whileLoop(cmp('LT', x(), num(7)), [setVar('x', add(x(), num(1)))])]),
      print(x()),
    ]),
  },
  {
    name: 'count-up-literal',
    covers: ['C-39'],
    parity: true,
    blocks: program([
      countUp('x', num(1), num(3), 1, [print(x())]),
      print(x()),
      countUp('y', num(0), num(10), 3, [print(y())]),
      countUp('z', num(5), num(5), 2, [print(z())]),
    ]),
  },
  {
    name: 'count-up-expressions',
    covers: ['C-39'],
    parity: true,
    blocks: program([
      setVar('y', num(2)),
      setVar('z', num(3)),
      countUp('x', add(y(), num(1)), mul(z(), num(2)), 1, [print(x())]),
      // The bounds are taken once: the body changes y and z and the loop does not notice.
      countUp('x', y(), z(), 1, [setVar('z', add(z(), num(1))), setVar('y', sub(y(), num(1))), print(x())]),
      // start > end at run time: no iteration, the variable keeps its value.
      setVar('x', num(77)),
      countUp('x', num(9), z(), 1, [print(text('never'))]),
      print(x()),
    ]),
  },
  {
    name: 'count-up-body-changes-variable',
    covers: ['C-39'],
    parity: true,
    blocks: program([
      countUp('x', num(1), num(4), 1, [print(x()), setVar('x', add(x(), num(100)))]),
      print(x()),
      countUp('y', num(0), num(2), 1, [setVar('y', num(99))]),
      print(y()),
    ]),
  },
  {
    name: 'count-up-nested',
    covers: ['C-37', 'C-39'],
    parity: true,
    blocks: program([
      countUp('x', num(1), num(2), 1, [
        repeat(num(2), [
          countUp('y', x(), add(x(), num(1)), 1, [print(join(x(), text(','), y()))]),
        ]),
        countUp('z', num(0), mul(x(), num(2)), 2, [print(z())]),
      ]),
    ]),
  },
  {
    name: 'text-escapes',
    covers: ['C-29', 'C-56'],
    parity: true,
    blocks: program([
      print(text("it's")),
      print(text('say "hi"')),
      print(text('back\\slash')),
      print(text("both ' and \\")),
      print(text('Xin chào, thế giới đẹp quá')),
      print(text('😀 ✓')),
      print(text('')),
      print(text('x'.repeat(1000))),
    ]),
  },
  {
    name: 'join',
    covers: ['C-56'],
    parity: true,
    blocks: program([
      setVar('x', num(-12)),
      print(join(text('x = '), x())),
      print(join(text('ok: '), cmp('LT', x(), num(0)), text('!'))),
      print(join(x(), x())),
      print(join(text('a'), join(text('b'), num(1)), text('c'))),
      print(join(text('sum '), add(x(), num(20)), text(' '), mul(x(), x()))),
      print(join(text('only'))),
      print(join()),
      print(cmp('EQ', join(text('a'), num(1)), text('a1'))),
    ]),
  },
  {
    name: 'names',
    covers: ['C-30'],
    parity: true,
    blocks: withVariables(
      program([
        setVar('v1', num(1)),
        setVar('v2', add(getVar('v1'), num(1))),
        setVar('v3', add(getVar('v2'), num(1))),
        setVar('v4', add(getVar('v3'), num(1))),
        setVar('v5', add(getVar('v4'), num(1))),
        setVar('v6', add(getVar('v5'), num(1))),
        setVar('v7', add(getVar('v6'), num(1))),
        setVar('v8', add(getVar('v7'), num(1))),
        setVar('v9', add(getVar('v8'), num(1))),
        setVar('v10', add(getVar('v9'), num(1))),
        setVar('v11', add(getVar('v10'), num(1))),
        setVar('v12', add(getVar('v11'), num(1))),
        print(getVar('v12')),
      ]),
      [
        ['v1', 'class'],
        ['v2', 'for'],
        ['v3', 'True'],
        ['v4', 'hello-world'],
        ['v5', 'a.b'],
        ['v6', '1name'],
        ['v7', 'tên'],
        ['v8', 'duplicate'],
        ['v9', 'duplicate'],
        ['v10', 'print'],
        ['v11', '_hidden'],
        ['v12', 'my value'],
      ],
    ),
  },
  {
    name: 'expression-deep',
    covers: ['C-31'],
    parity: true,
    blocks: program([print(nestedAdd(80))]),
  },
  {
    name: 'nested-program',
    covers: ['C-01', 'C-02', 'C-29', 'C-30', 'C-31', 'C-33', 'C-34', 'C-35', 'C-36', 'C-37', 'C-38', 'C-39', 'C-56'],
    parity: true,
    blocks: program(
      [
        setVar('z', num(0)),
        countUp('x', num(1), num(4), 1, [
          ifElif(
            [
              [cmp('EQ', mod(x(), num(2)), num(0)), [setVar('z', add(z(), x()))]],
              [and(cmp('GT', x(), num(2)), not(cmp('EQ', x(), num(3)))), [print(text('unreachable'))]],
            ],
            [print(join(text('odd '), x()))],
          ),
        ]),
        setVar('y', num(3)),
        whileLoop(cmp('GT', y(), num(0)), [repeat(y(), [setVar('z', add(z(), num(1)))]), setVar('y', sub(y(), num(1)))]),
        print(join(text('z = '), z())),
      ],
      [print(text('forever')), ifThen(cmp('GT', z(), num(100)), [print(text('big'))])],
    ),
  },
];
