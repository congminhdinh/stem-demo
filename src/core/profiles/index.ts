import unoAdvanced from './uno-advanced.json';
import unoBasic from './uno-basic.json';
import ybcAdvanced from './ybc-advanced.json';
import ybcBasic from './ybc-basic.json';
import { createProfileCatalog } from './profile';

export { createProfileCatalog, type CurriculumProfile, type ProfileCatalog } from './profile';

/**
 * The production profiles. Tests inject their own catalog instead (YB plan §8.7). N18 R2.1: the UNO-compatible ones of the robot
 * lab after the Yolo:Bit-compatible ones; their block packs arrive with R2.2.
 */
export const productionProfileData: readonly unknown[] = [ybcBasic, ybcAdvanced, unoBasic, unoAdvanced];

export const productionProfiles = createProfileCatalog(productionProfileData);
