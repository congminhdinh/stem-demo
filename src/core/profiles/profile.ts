import { z } from 'zod';

// Curriculum profiles are data (YB plan §8.2, B6). A profile only *chooses*
// what a project of its board family exposes, the Yolo:Bit-compatible one or
// (N18 R2.1) the UNO-compatible one of the robot lab; it defines no
// behaviour. Advanced extends Basic by union.

export const curriculumProfileSchema = z.object({
  id: z.string().min(1),
  /** The board family of every project with this profile (R-F1): the board context reads it, never the boards present. */
  family: z.enum(['ybc', 'uno']),
  boardType: z.string(),
  /** The profile this one adds to; the effective profile is the union of the chain. */
  extends: z.string().optional(),
  /** Contract construct ids exposed to learners; each must pass the exposure gate (EG). */
  constructs: z.array(z.string()),
  /** Block packs shown in the toolbox, in order. */
  blockPacks: z.array(z.string()),
  /** Device types the circuit may contain and the palette offers. */
  palette: z.array(z.string()),
  /** Onboard parts whose runtime controls are shown. */
  controls: z.array(z.string()),
  /**
   * What a learner's variable holds: whole numbers, at every level. Data only, read by no code: the dialect has no text variables.
   * The YB plan (§8.2) listed 'str' for Advanced; it was never built, so N17 B6 took it out rather than promise it. A profile that
   * names none takes its parent's.
   */
  variableTypes: z.array(z.literal('int')).default([]),
});

export type CurriculumProfile = z.infer<typeof curriculumProfileSchema>;

/** The list fields a profile accumulates over its `extends` chain. */
export const profileListFields = ['constructs', 'blockPacks', 'palette', 'controls', 'variableTypes'] as const;

export type ProfileCatalog = {
  /** The effective profile (own data united with everything it extends), or undefined for an unknown id. */
  get(id: string): CurriculumProfile | undefined;
  /** Every profile id, in catalog order. */
  ids(): string[];
};

/**
 * Builds the catalog from raw data. Invalid data is a programmer error, so
 * this fails fast: a bad schema, a duplicate id, an unknown or circular
 * `extends`, or a different board type or family than the profile it extends.
 */
export function createProfileCatalog(rawProfiles: readonly unknown[]): ProfileCatalog {
  const own = new Map<string, CurriculumProfile>();
  for (const raw of rawProfiles) {
    const profile = curriculumProfileSchema.parse(raw);
    if (own.has(profile.id)) {
      throw new Error(`Duplicate profile "${profile.id}"`);
    }
    own.set(profile.id, profile);
  }

  const effective = new Map<string, CurriculumProfile>();
  const resolve = (id: string, chain: readonly string[]): CurriculumProfile => {
    const cached = effective.get(id);
    if (cached) {
      return cached;
    }
    const profile = own.get(id);
    if (!profile) {
      throw new Error(`Unknown profile "${id}" in the extends chain ${[...chain, id].join(' → ')}`);
    }
    if (chain.includes(id)) {
      throw new Error(`Circular profile chain ${[...chain, id].join(' → ')}`);
    }
    let merged = profile;
    if (profile.extends !== undefined) {
      const parent = resolve(profile.extends, [...chain, id]);
      if (parent.boardType !== profile.boardType) {
        throw new Error(`Profile "${id}" has another board type than "${parent.id}"`);
      }
      if (parent.family !== profile.family) {
        throw new Error(`Profile "${id}" has another family than "${parent.id}"`);
      }
      merged = { ...profile };
      for (const field of profileListFields) {
        // Parent first, so the order of the base profile is kept.
        (merged[field] as string[]) = [...new Set([...parent[field], ...profile[field]])];
      }
    }
    effective.set(id, merged);
    return merged;
  };
  for (const id of own.keys()) {
    resolve(id, []);
  }

  return {
    get: (id) => effective.get(id),
    ids: () => [...own.keys()],
  };
}
