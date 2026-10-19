import { isTemplateKey, labOfTemplate, type LabKind, type TemplateKey } from '../../samples/templates';
import { isYbcTemplateKey, templateProfileProblem, ybcLabProfiles, type YbcLabProfile } from '../../samples/ybc-templates';

// The launch contract (S1, plan §9.2; N6a S0): how the app is told, by its URL, to run as the standalone
// editor or as an embedded lab. The URL is read once, at startup (main.tsx); nothing past this module knows
// about it. docs/lab-embed-contract.md is the contract as the embedding page (STEMLearning) sees it.
//
//   (no embed, no template, no lab)                     standalone editor
//   ?embed=1&template=<key>                             legacy S1 lab: any key, no host bridge, legacy chrome
//   ?embed=1&lab=blockly&template=<key>[&origin=<o>]    Blockly lab: a generic template
//   ?embed=1&lab=yolobit&template=<key>[&profile=<p>][&origin=<o>]
//                                                       Yolo:Bit lab: a ybc-* template, profile ybc-basic|ybc-advanced, at
//                                                       least the one the template needs (N17 B6: the thermometer, the
//                                                       dice and the servo gate need ybc-advanced)
//
// `origin` is the embedding page's origin, the only one the lab talks to (stem-lab/v1, host-bridge.ts); without
// it the lab works but talks to nobody. Anything else that names embed, template or lab is a broken launch,
// shown as an error: an embedding page must learn about a bad key, not get a standalone project in its place.
// Without `lab` the launch is the S1 one, unchanged: `profile` and `origin` are ignored like any other parameter.

/** What a `lab=` launch adds to the template. */
export type LabLaunch = {
  kind: LabKind;
  /** Yolo:Bit labs only: the board profile of `profile=`; null keeps the template's own. */
  profile: YbcLabProfile | null;
  /** The embedding page's origin (`origin=`), the only target of the lab's messages; null: no host bridge. */
  hostOrigin: string | null;
};

export type Launch =
  | { mode: 'standalone' }
  /** `lab` is absent for the legacy S1 launch. */
  | { mode: 'embed'; template: TemplateKey; lab?: LabLaunch }
  /** `lab`: the lab the broken launch asked for, when it named a known one (the error lists that lab's templates). */
  | { mode: 'invalid'; problem: string; lab?: LabKind };

const labKinds: readonly LabKind[] = ['blockly', 'yolobit'];

/** Reads the launch from a URL query string such as `location.search`. */
export function parseLaunch(search: string): Launch {
  const params = new URLSearchParams(search);
  const embed = params.getAll('embed');
  const template = params.getAll('template');
  const lab = params.getAll('lab');
  if (embed.length === 0 && template.length === 0 && lab.length === 0) {
    return { mode: 'standalone' };
  }
  if (embed.length === 0) {
    return invalid('A template opens only in an embedded lab: add embed=1.');
  }
  if (embed.length > 1 || embed[0] !== '1') {
    return invalid('embed must be given once, as embed=1.');
  }
  if (lab.length > 1) {
    return invalid('lab must be given once.');
  }
  const [labName] = lab;
  if (labName !== undefined && !(labKinds as readonly string[]).includes(labName)) {
    return invalid(`Unknown lab "${labName}": use lab=blockly or lab=yolobit.`);
  }
  const kind = labName as LabKind | undefined;
  const [key] = template;
  if (key === undefined || key === '') {
    return invalid('No template was given: add template=<key>.', kind);
  }
  if (template.length > 1) {
    return invalid('template must be given once.', kind);
  }
  if (!isTemplateKey(key)) {
    return invalid(`Unknown template "${key}".`, kind);
  }
  if (kind === undefined) {
    return { mode: 'embed', template: key };
  }
  if (labOfTemplate(key) !== kind) {
    return invalid(`The template "${key}" does not open in lab=${kind}.`, kind);
  }
  const profile = readProfile(params.getAll('profile'), kind);
  if (typeof profile === 'object' && profile !== null) {
    return profile;
  }
  // N17 B6: a lab whose program uses what only the Advanced board has does not open on the Basic one: it could not run there.
  const tooLow = profile !== null && isYbcTemplateKey(key) ? templateProfileProblem(key, profile) : null;
  if (tooLow !== null) {
    return invalid(tooLow, kind);
  }
  const hostOrigin = readOrigin(params.getAll('origin'), kind);
  if (typeof hostOrigin === 'object' && hostOrigin !== null) {
    return hostOrigin;
  }
  return { mode: 'embed', template: key, lab: { kind, profile, hostOrigin } };
}

function readProfile(values: string[], kind: LabKind): YbcLabProfile | null | Extract<Launch, { mode: 'invalid' }> {
  if (values.length === 0) {
    return null;
  }
  if (values.length > 1) {
    return invalid('profile must be given once.', kind);
  }
  const [value = ''] = values;
  if (kind !== 'yolobit') {
    return invalid('profile is only for lab=yolobit.', kind);
  }
  return (ybcLabProfiles as readonly string[]).includes(value)
    ? (value as YbcLabProfile)
    : invalid(`Unknown profile "${value}": use ${ybcLabProfiles.join(' or ')}.`, kind);
}

/**
 * The embedding page's origin: an http(s) origin written exactly as browsers serialize it (scheme, host and a
 * port other than the default; no path, no trailing slash), because the lab compares it to `event.origin`.
 */
function readOrigin(values: string[], kind: LabKind): string | null | Extract<Launch, { mode: 'invalid' }> {
  if (values.length === 0) {
    return null;
  }
  if (values.length > 1) {
    return invalid('origin must be given once.', kind);
  }
  const [value = ''] = values;
  return isPageOrigin(value) ? value : invalid(`origin "${value}" is not a page origin such as https://school.example.`, kind);
}

export function isPageOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
  } catch {
    // not an absolute URL
    return false;
  }
}

function invalid(problem: string, lab?: LabKind): Extract<Launch, { mode: 'invalid' }> {
  return lab === undefined ? { mode: 'invalid', problem } : { mode: 'invalid', problem, lab };
}
