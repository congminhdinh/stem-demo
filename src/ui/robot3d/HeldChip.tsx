import { memo } from 'react';
import { useStore } from 'zustand';
import { useText } from '../i18n/text';
import { ColorSwatch, swatchMark } from './ColorSwatch';
import { objectColorName, objectName, type NamingScenario } from './check-report';
import { shownRun, type RobotLabState, type RobotRunStore } from './robot-run-store';

// The chip of the object the gripper holds (N19 E1), a row of the HUD: "Đang giữ: khối đỏ" with a swatch of the object's colour and its
// colour-blind mark (red stripes, green a grid, blue dots, as the foam cube's top face has them, E7). The words are the check report's naming of
// the object in the round the view shows (`objectName`), so the HUD, the announcements and the report call it the same. It reads the held id
// and the round alone from the store, so it renders when the gripper takes or lets go of an object and at no other time, and the 3D view never
// renders for it. It is no live region: the lab's announcer says a grip once (lab-announcements.ts `createGripAnnouncer`).

/** The id of the object the shown run's gripper holds; null for none, for a robot with no gripper and before a run. */
export const heldIdOf = (state: RobotLabState): string | null => shownRun(state)?.world?.robot.gripper?.heldId ?? null;

type HeldChipProps = { store: RobotRunStore; scenario: NamingScenario };

export const HeldChip = memo(function HeldChip({ store, scenario }: HeldChipProps) {
  const t = useText();
  const heldId = useStore(store, heldIdOf);
  // A check's round the view shows is the colours of that round (the cube is green in round 2); a lab's own run is the first.
  const round = useStore(store, (state) => state.round?.index ?? 0);
  if (heldId === null) return null;
  const color = objectColorName(scenario, heldId, round);
  return (
    <div className="robot-hud-row">
      <span className="robot-badge robot-badge-held" data-testid="robot-held" data-color={color ?? 'none'} data-mark={swatchMark(color)}>
        <ColorSwatch color={color} />
        {t('robot.hud.holding', { object: objectName(t, scenario, heldId, round) })}
      </span>
    </div>
  );
});
