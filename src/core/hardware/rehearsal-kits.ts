import { createKitCatalog, unoR3Board, type KitCatalog } from './catalog';
import type { Kit, KitRef } from './kit';
import refUnoRoverJson from './kits/ref-uno-rover.kit.json';
import rehearsalRoverJson from './kits/rehearsal.kit.json';

// The kit-swap rehearsal (N18 R8a, docs/kit-swap-rehearsal.md): `rehearsal-rover@0` plays a kit "from another vendor", made as a data
// change only. It is ref-uno-rover@0's robot (the same chassis, modules, mounts and specs, so every scenario stays as fair) wired another
// way: every port on other pins, the line sensors active-low, the left motor's IN1/IN2 the other way round. It is registered as a production
// kit is, by createKitCatalog (validated when this module loads), so a document's `kit` names it and a run session takes it as its kit.
//
// NOT a product kit: it is test data for the rehearsal. The kit schema has no field to say so, so this catalog is apart from
// `productionKits` and nothing the app loads imports this module (tests/kit-rehearsal.test.ts and its fixtures do).

export const rehearsalKitRef: KitRef = { id: 'rehearsal-rover', version: '0' };

/** The reference kit and the rehearsal kit, on the boards of this build. */
export const rehearsalKits: KitCatalog = createKitCatalog([refUnoRoverJson, rehearsalRoverJson], [unoR3Board]);

export const rehearsalKit: Kit = rehearsalKits.get(rehearsalKitRef) as Kit;
