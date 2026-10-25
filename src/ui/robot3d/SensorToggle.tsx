import { useStore } from 'zustand';
import { useText } from '../i18n/text';
import type { RobotToolsStore } from './robot-tools-store';
import './SensorOverlay.css';

// The "Hiện cảm biến" switch of the sensor overlays (N18 R4.3): an icon button after the camera's views in the same panel at the top right
// of the 3D view (`camera`), or on a panel of its own in the place of that one over the 2D map, which has no camera views (`panel`). The
// overlays are on until the learner turns them off, in a check too: the switch is the tools store's (`sensors`), read by the 3D overlay
// (parts/SensorOverlay.tsx) and the map's (TopViewSensors.tsx). It has a tooltip, as the view tools do; pressed means shown.

export function SensorToggle({ tools, variant }: { tools: RobotToolsStore; variant: 'camera' | 'panel' }) {
  const t = useText();
  const on = useStore(tools, (state) => state.sensors);
  return (
    <button
      type="button"
      className={`robot-sensors robot-sensors-${variant}`}
      aria-pressed={on}
      aria-label={t('robot.sensors')}
      title={`${t('robot.sensors')}: ${t('robot.sensors.hint')}`}
      data-testid="robot-sensors"
      onClick={() => tools.getState().setSensors(!on)}
    >
      <svg className="robot-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
        {/* A beam from a sensor: its cone, and the echo's dot inside it. */}
        <path d="M2.8 8 14 3.2M2.8 8 14 12.8M14 3.2a9.4 9.4 0 0 1 0 9.6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="2.8" cy="8" r="1.7" fill="currentColor" />
        <circle cx="10" cy="8" r="1.4" fill="currentColor" />
      </svg>
    </button>
  );
}
