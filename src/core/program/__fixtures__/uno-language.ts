import { productionProfiles } from '../../profiles';
import { compileYbcProgram, type YbcCompileResult } from '../compile-ybc-program';

// Compiles a program for the uno-basic profile (tests only). R2.2 gives the uno profiles their block packs; until then a test
// exposes just the language blocks it needs, and the family comes from the profile, as RobotRunSession will take it.

/** The language core of the UNO contract (U-03…U-18) as the dialect's blocks: variables, if, loops, count up, wait, print, + − × // %. */
export const unoLanguageBlockTypes: ReadonlySet<string> = new Set([
  'variables_get',
  'variables_set',
  'math_number',
  'ybc_arith',
  'ybc_int_divide',
  'math_modulo',
  'logic_compare',
  'logic_operation',
  'logic_negate',
  'logic_boolean',
  'controls_if',
  'controls_repeat_ext',
  'ybc_while',
  'ybc_count_up',
  'ybc_wait_ms',
  'text_print',
  'text',
  'text_join',
]);

export function compileUno(blocks: unknown, exposed: ReadonlySet<string> = unoLanguageBlockTypes): YbcCompileResult {
  const profile = productionProfiles.get('uno-basic');
  if (profile?.family !== 'uno') {
    throw new Error('uno-basic is not a profile of the uno family');
  }
  return compileYbcProgram(blocks, exposed, undefined, undefined, profile.family);
}
