import type { QualityTier } from '../quality';

// How each quality tier of the 3D view looks (N18 R4.7), beside quality.ts's renderer settings (R4.2, ADR 0002 §6): the level of
// detail of the modelled parts, the studio light, the soft shadows and what the low tier leaves out. Low keeps the same models, their
// baked ambient occlusion and their colours and textures, so it still reads as 3D; it shades them with Lambert materials (no specular
// light, no environment map: a software renderer pays for every lit pixel, measured 15.9 fps with the standard ones), bakes the plain
// materials into vertex colours so they draw as one mesh, and drops the real-time shadows (a soft blob under the robot and baked
// contact shading under the walls instead), the jumper wires, the LED's light and the mat's fine paper normal map.

export type Detail = 'high' | 'low';

export type TierLook = {
  detail: Detail;
  /** The studio environment's strength (RoomEnvironment through PMREM): reflections and soft ambient light; 0: none is made. */
  environment: number;
  /** The sky and ground fill light's strength (the low tier's ambient light, where there is no environment). */
  fill: number;
  /** The key light's soft shadow radius (three 0.186's PCF with a Vogel disk), in shadow-map texels; 0 without shadows. */
  shadowRadius: number;
  /** The mat's paper fibres as a normal map. */
  matNormal: boolean;
};

export const tierLook: Readonly<Record<QualityTier, Readonly<TierLook>>> = {
  high: { detail: 'high', environment: 0.85, fill: 0.35, shadowRadius: 2.5, matNormal: true },
  low: { detail: 'low', environment: 0, fill: 1.6, shadowRadius: 0, matNormal: false },
};
