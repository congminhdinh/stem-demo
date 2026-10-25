// The colours of the sensor overlays (N18 R4.3), in the 3D view and on the 2D map. They read over the light mat, its black tape and its
// zones, and over the studio's walls: the ultrasonic beam is a sky blue (the 2D map's ray since R4.6), the echo a rose, a line sensor's
// spot a red disc where it reads dark (the lamp's red) and a blue ring where it reads bright, the next goal's zone a warm amber that no zone colour of
// the pilots shares. The label is a white tag with the beam's blue, like the zones' tags.

export const sensorColors = {
  /** The ultrasonic beam: its axis ray, the cone's edges and its soft fill. */
  ray: '#0284c7',
  cone: '#38bdf8',
  /** The cone's soft fill on the 2D map (the 3D view's is a material's opacity). */
  coneFill: 'rgba(56, 189, 248, 0.16)',
  /** The point where the nearest echo came from. */
  hit: '#e11d48',
  /** A line sensor's spot on the mat: a red disc where it reads dark, a blue ring where it reads bright. */
  spotDark: '#ef4444',
  spotLight: '#2563eb',
  /** The zone the next unmet goal needs: its soft fill and its outline. */
  goal: '#f59e0b',
  goalEdge: '#d97706',
  /** The distance label: a white tag, the beam's blue round it, dark blue digits. */
  labelBackground: 'rgba(255, 255, 255, 0.96)',
  labelBorder: '#0284c7',
  labelText: '#0c4a6e',
} as const;

export type SensorColor = keyof typeof sensorColors;
