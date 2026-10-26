// The colours of the robot lab's 3D view (N18 R4.2), in one place like the circuit canvas's (src/ui/canvas/colors.ts): the scene's
// components name these and never write a colour of their own (colors.test.ts). The arena's own colours (ground, zones) come from the
// scenario. The robot is the lab's own low-poly artwork: no logo, no vendor's colours.

export const robot3dColors = {
  /** Behind the arena: the sky, and the table the arena stands on. */
  background: '#e8edf4',
  table: '#d7dee8',
  /** The black tape of the lines (reflectance 0) and the text of a zone's label painted on the floor. */
  tape: '#15171c',
  /** The text of a zone's name painted on the floor of the 2D map: opaque and dark (N18 R8: it was 42 % slate, 2.2:1 on the pale zones), with a pale halo where a pattern runs under it. */
  zoneLabel: '#334155',
  zoneLabelHalo: 'rgba(255, 255, 255, 0.85)',
  /** Arena bodies. */
  wall: '#b8c4d4',
  wallTop: '#9aa8bb',
  box: '#d9a066',
  cylinder: '#e07a5f',
  object: '#f2c14e',
  /** The robot. */
  chassis: '#f97316',
  chassisTrim: '#c2560c',
  board: '#0f5257',
  chip: '#1f2933',
  pinHeader: '#2b2f36',
  tyre: '#22252b',
  hub: '#d6dbe3',
  spoke: '#f97316',
  caster: '#9aa3ae',
  sensorBoard: '#2563eb',
  sensorEye: '#c9ced6',
  lineSensor: '#1d2026',
  lineSensorDark: '#ef4444',
  lineSensorLight: '#4b5563',
  /** N18 R4.7 fix round 2: a lit line lamp (on the robot's LED board) and its glow. */
  lineLampLit: '#ff2414',
  servoBody: '#3b4252',
  servoArm: '#facc15',
  ledOff: '#7f1d1d',
  ledOn: '#ff3b30',
  buzzer: '#2b2f36',
  buzzerWave: '#38bdf8',
  buttonBase: '#374151',
  buttonCap: '#3b82f6',
  /** N19 E6: the simple robot's gripper (when the modelled parts are not there): aluminium, its fingers' rubber, the claw servo. */
  gripperMetal: '#c2c7ce',
  gripperPad: '#2b2e33',
  gripperServo: '#2a5ed0',
  /** N19 E6: the halo of the colour sensor's white LED, lit while the robot runs. */
  colorLedLit: '#fff4d6',
  /** Lights. */
  sky: '#ffffff',
  ground: '#aab4c3',
  sun: '#fffaf0',
  /** N18 R4.7: the studio's rim light, its fog (the floor's colour where the studio fades it; light since fix round 1) and the mat's edge. */
  rim: '#d6e4ff',
  studioFog: '#bdc2c9',
  matEdge: '#e4e4e0',
  /** N18 R4.7 fix round 1: the zones' tags over the mat (a white tag, dark words, a white number on the zone's colour) and their lines. */
  tagBackground: 'rgba(255, 255, 255, 0.96)',
  tagShadow: 'rgba(15, 23, 42, 0.35)',
  tagText: '#1e293b',
  tagNumber: '#ffffff',
  tagLine: '#334155',
} as const;

export type Robot3dColor = keyof typeof robot3dColors;
