type Json = Record<string, unknown>;
export const logicOr = (id: string, a: Json, b: Json): Json => ({ type: 'logic_operation', id, fields: { OP: 'OR' }, inputs: { A: { block: a }, B: { block: b } } });
