import ybcAdvanced from './ybc-advanced.json';
import ybcBasic from './ybc-basic.json';
import { createProfileCatalog } from './profile';

export { createProfileCatalog, type CurriculumProfile, type ProfileCatalog } from './profile';

/** The production profiles. Tests inject their own catalog instead (YB plan §8.7). */
export const productionProfileData: readonly unknown[] = [ybcBasic, ybcAdvanced];

export const productionProfiles = createProfileCatalog(productionProfileData);
