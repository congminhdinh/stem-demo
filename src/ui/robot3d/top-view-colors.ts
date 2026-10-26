import { robot3dColors } from './colors';

// The colours of the robot lab's 2D top view (N18 R4.6), in one place like the 3D view's (colors.ts), which it shares: the arena's bodies
// and the robot are the same colours in both views. The arena's own colours (ground, zones) come from the scenario. What only the map
// draws (the ultrasonic ray, the scale bar) is defined here.

export const topViewColors = {
  /** A thin frame around the mat, so that its edge reads against the page. */
  slab: robot3dColors.wallTop,
  wall: robot3dColors.wall,
  wallEdge: robot3dColors.wallTop,
  box: robot3dColors.box,
  cylinder: robot3dColors.cylinder,
  object: robot3dColors.object,
  /** The edge of a box, a cylinder or an object. */
  bodyEdge: robot3dColors.chip,
  chassis: robot3dColors.chassis,
  chassisTrim: robot3dColors.chassisTrim,
  tyre: robot3dColors.tyre,
  treadMark: robot3dColors.hub,
  arrow: robot3dColors.chip,
  /** A line sensor's dot: lit while it sees the line (the 3D view's lamp), grey otherwise, with a pale ring so that it reads on the orange. */
  lineDark: robot3dColors.lineSensorDark,
  lineLight: robot3dColors.lineSensorLight,
  dotRing: '#ffffff',
  servoArm: robot3dColors.servoArm,
  servoHub: robot3dColors.servoBody,
  ledOn: robot3dColors.ledOn,
  ledOff: robot3dColors.ledOff,
  /** The ultrasonic ray, and the point where it hits something. */
  ray: '#0284c7',
  rayHit: '#e11d48',
  /** The scale bar and its label. */
  scale: '#334155',
  /** N19 E4: the gripper from above: its aluminium boom and fingers with a dark edge (so they read on the light mat), the carriage, the fingers' rubber. */
  gripperMetal: robot3dColors.gripperMetal,
  gripperEdge: robot3dColors.chip,
  gripperBody: robot3dColors.chip,
  gripperPad: robot3dColors.gripperPad,
  /** N19 E4: the ring round the held object: a violet no zone, object or sensor of the map uses. */
  heldRing: '#6d28d9',
} as const;

export type TopViewColor = keyof typeof topViewColors;
