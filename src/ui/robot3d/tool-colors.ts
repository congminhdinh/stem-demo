// The colours of the robot lab's view tools (N18 R4.8), in the 3D view and on the 2D map: the ruler's line, its points and its label, and
// the move tool's ghost (blue where the robot may stand, red where it cannot). Chosen to read over the light mat, its black tape and its
// zones; the red is the app's danger hue.

export const toolColors = {
  ruler: '#e07b00',
  rulerPoint: '#ffffff',
  rulerEdge: '#8a4b00',
  labelBackground: 'rgba(32, 33, 36, 0.86)',
  labelText: '#ffffff',
  ghostClear: '#2f6fdb',
  ghostBlocked: '#d93025',
} as const;
