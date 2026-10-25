import { useEffect, useState } from 'react';
import { createLatestThrottle } from '../blockly/latest-throttle';
import type { RobotSnapshot } from '../../core/world/snapshot';
import { hubValues, type HubMap, type HubValues } from './pin-map';

// What the "Cổng & chân" tab shows follows the run's snapshots (N18 R4.5), but not at the rate they come. The run publishes one
// snapshot per frame, and the hub panel has an SVG board, a dozen cards and a table to draw from it: at most ten times a second is
// plenty to read, and keeps React cheap while the robot runs. It is the same throttle as the running block's highlight (R2.4): the
// first change after a quiet time is shown at once, the rest follow every `HUB_INTERVAL_MS`, and the last one is never left behind.
// A view that is not shown follows nothing, and reads the world afresh when it is shown again.

/** The longest the hub panel waits before it shows the latest snapshot: ten renders a second at most. */
export const HUB_INTERVAL_MS = 100;

/** Where the world comes from: the run store's `subscribe` and `latestWorld()` (robot-run-store.ts). */
export type WorldSource = {
  subscribe(listener: () => void): () => void;
  getState(): { latestWorld(): RobotSnapshot | null };
};

export function useHubValues(source: WorldSource, map: HubMap, active: boolean): HubValues {
  const [values, setValues] = useState<HubValues>(() => hubValues(map, source.getState().latestWorld()));

  useEffect(() => {
    if (!active) {
      return undefined;
    }
    // Snapshots that say the same render nothing: a resting robot's clock changes the snapshot, not what this tab shows.
    let shownText = '';
    const show = (world: RobotSnapshot | null) => {
      const next = hubValues(map, world);
      const text = JSON.stringify(next);
      if (text !== shownText) {
        shownText = text;
        setValues(next);
      }
    };
    const current = source.getState().latestWorld();
    show(current);
    const throttle = createLatestThrottle<RobotSnapshot | null>(show, HUB_INTERVAL_MS, current);
    const stop = source.subscribe(() => throttle.request(source.getState().latestWorld()));
    return () => {
      stop();
      throttle.dispose();
    };
  }, [source, map, active]);

  return values;
}
