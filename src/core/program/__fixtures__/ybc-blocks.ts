// Builders for Blockly serialization JSON of YBC programs (tests only). They write
// the shape Blockly itself saves, which tests/ybc-blockly-conformance.test.ts checks
// against real Blockly.

export type Json = Record<string, unknown>;

let counter = 0;
const id = (type: string) => `${type}-${++counter}`;

export const num = (value: number): Json => ({ type: 'math_number', id: id('num'), fields: { NUM: value } });
export const bool = (value: boolean): Json => ({ type: 'logic_boolean', id: id('bool'), fields: { BOOL: value ? 'TRUE' : 'FALSE' } });
export const text = (value: string): Json => ({ type: 'text', id: id('text'), fields: { TEXT: value } });
export const getVar = (variable: string): Json => ({ type: 'variables_get', id: id('get'), fields: { VAR: { id: variable } } });

const binary = (type: string, fields: Json, a: Json, b: Json, names: [string, string] = ['A', 'B']): Json => ({
  type,
  id: id(type),
  fields,
  inputs: { [names[0]]: { block: a }, [names[1]]: { block: b } },
});

/** Blockly's own arithmetic block (with ÷ and power): foreign to the dialect, used to test that it is refused. */
export const foreignArith = (op: 'ADD' | 'MINUS' | 'MULTIPLY' | 'DIVIDE' | 'POWER', a: Json, b: Json) =>
  binary('math_arithmetic', { OP: op }, a, b);
export const arith = (op: 'ADD' | 'MINUS' | 'MULTIPLY', a: Json, b: Json) => binary('ybc_arith', { OP: op }, a, b);
export const add = (a: Json, b: Json) => arith('ADD', a, b);
export const sub = (a: Json, b: Json) => arith('MINUS', a, b);
export const mul = (a: Json, b: Json) => arith('MULTIPLY', a, b);
export const idiv = (a: Json, b: Json) => binary('ybc_int_divide', {}, a, b);
export const mod = (a: Json, b: Json) => binary('math_modulo', {}, a, b, ['DIVIDEND', 'DIVISOR']);
export const cmp = (op: 'EQ' | 'NEQ' | 'LT' | 'LTE' | 'GT' | 'GTE', a: Json, b: Json) =>
  binary('logic_compare', { OP: op }, a, b);
export const and = (a: Json, b: Json) => binary('logic_operation', { OP: 'AND' }, a, b);
export const or = (a: Json, b: Json) => binary('logic_operation', { OP: 'OR' }, a, b);
export const not = (a: Json): Json => ({ type: 'logic_negate', id: id('not'), inputs: { BOOL: { block: a } } });

export const setVar = (variable: string, value: Json): Json => ({
  type: 'variables_set',
  id: id('set'),
  fields: { VAR: { id: variable } },
  inputs: { VALUE: { block: value } },
});
export const print = (value: Json): Json => ({ type: 'text_print', id: id('print'), inputs: { TEXT: { block: value } } });

export const ifThen = (condition: Json, then: Json[], otherwise?: Json[]): Json => ({
  type: 'controls_if',
  id: id('if'),
  ...(otherwise ? { extraState: { hasElse: true } } : {}),
  inputs: {
    IF0: { block: condition },
    ...(then.length > 0 ? { DO0: { block: chain(then) } } : {}),
    ...(otherwise && otherwise.length > 0 ? { ELSE: { block: chain(otherwise) } } : {}),
  },
});

/** Statements linked by `next`, as Blockly saves a stack. */
export function chain(statements: Json[]): Json {
  const [first, ...rest] = statements;
  if (!first) {
    throw new Error('A chain needs a statement');
  }
  return rest.length > 0 ? { ...first, next: { block: chain(rest) } } : first;
}

/** A workspace with an `on start` (and a `forever` when given) and the variables x, y and z (ids 'x', 'y', 'z'). */
export function program(onStart: Json[], forever?: Json[], variables = ['x', 'y', 'z']): Json {
  const hat = (type: string, body: Json[], hatId: string) => ({
    type,
    id: hatId,
    ...(body.length > 0 ? { inputs: { DO: { block: chain(body) } } } : {}),
  });
  return {
    blocks: {
      languageVersion: 0,
      blocks: [hat('stem_on_start', onStart, 'on-start'), ...(forever ? [hat('stem_forever', forever, 'forever')] : [])],
    },
    variables: variables.map((name) => ({ name, id: name })),
  };
}

// --- YB-2b: loops, wait, join, else-if ---------------------------------------------------------------

const body = (statements: Json[]) => (statements.length > 0 ? { block: chain(statements) } : undefined);

export const repeat = (times: Json, statements: Json[]): Json => ({
  type: 'controls_repeat_ext',
  id: id('repeat'),
  inputs: { TIMES: { block: times }, ...(statements.length > 0 ? { DO: body(statements) } : {}) },
});

export const whileLoop = (condition: Json, statements: Json[]): Json => ({
  type: 'ybc_while',
  id: id('while'),
  inputs: { COND: { block: condition }, ...(statements.length > 0 ? { DO: body(statements) } : {}) },
});

export const countUp = (variable: string, from: Json, to: Json, step: number, statements: Json[]): Json => ({
  type: 'ybc_count_up',
  id: id('count-up'),
  fields: { VAR: { id: variable }, STEP: step },
  inputs: { FROM: { block: from }, TO: { block: to }, ...(statements.length > 0 ? { DO: body(statements) } : {}) },
});

export const wait = (ms: Json): Json => ({ type: 'ybc_wait_ms', id: id('wait'), inputs: { MS: { block: ms } } });

export const join = (...parts: Json[]): Json => ({
  type: 'text_join',
  id: id('join'),
  extraState: { itemCount: parts.length },
  inputs: Object.fromEntries(parts.map((part, index) => [`ADD${index}`, { block: part }])),
});

/** if / else if … / else: `branches` are [condition, statements] pairs, the first being the `if`. */
export const ifElif = (branches: [Json, Json[]][], otherwise?: Json[]): Json => ({
  type: 'controls_if',
  id: id('if'),
  extraState: { ...(branches.length > 1 ? { elseIfCount: branches.length - 1 } : {}), ...(otherwise ? { hasElse: true } : {}) },
  inputs: {
    ...Object.fromEntries(
      branches.flatMap(([condition, statements], index) => [
        [`IF${index}`, { block: condition }],
        ...(statements.length > 0 ? [[`DO${index}`, body(statements)]] : []),
      ]),
    ),
    ...(otherwise && otherwise.length > 0 ? { ELSE: body(otherwise) } : {}),
  },
});
