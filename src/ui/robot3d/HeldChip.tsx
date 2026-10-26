import { memo } from 'react';
import { useStore } from 'zustand';
import { bodyPalette } from '../../core/world/arena/body-colors';
import type { BodyColorName } from '../../core/world/arena/body-colors';
import { useText } from '../i18n/text';
import { bodyMarks, type BodyMark } from './body-marks';
import { objectColorName, objectName, type NamingScenario } from './check-report';
import { shownRun, type RobotLabState, type RobotRunStore } from './robot-run-store';

// The chip of the object the gripper holds (N19 E1), a row of the HUD: "Đang giữ: khối đỏ" with a swatch of the object's colour and its
// colour-blind mark (red stripes, green a grid, blue dots, as the foam cube's top face has them, E7). The words are the check report's naming of
// the object in the round the view shows (`objectName`), so the HUD, the announcements and the report call it the same. It reads the held id
// and the round alone from the store, so it renders when the gripper takes or lets go of an object and at no other time, and the 3D view never
// renders for it. It is no live region: the lab's announcer says a grip once (lab-announcements.ts `createGripAnnouncer`).

/** The id of the object the shown run's gripper holds; null for none, for a robot with no gripper and before a run. */
export const heldIdOf = (state: RobotLabState): string | null => shownRun(state)?.world?.robot.gripper?.heldId ?? null;

/** The mark of `mark` over a 16 × 16 swatch: light ink on the colour (red 5.0:1, green 4.1:1, blue 4.6:1 against white). */
function MarkShapes({ mark }: { mark: BodyMark }) {
  const ink = { stroke: '#ffffff', strokeOpacity: 0.92, 'data-mark-part': '' } as const;
  switch (mark) {
    case 'stripes':
      return (
        <>
          {[4.5, 8, 11.5].map((y) => (
            <line key={y} x1={2.5} x2={13.5} y1={y} y2={y} strokeWidth={1.6} {...ink} />
          ))}
        </>
      );
    case 'grid':
      return (
        <>
          {[5.5, 10.5].map((at) => (
            <line key={`v${at}`} x1={at} x2={at} y1={2.5} y2={13.5} strokeWidth={1.3} {...ink} />
          ))}
          {[5.5, 10.5].map((at) => (
            <line key={`h${at}`} x1={2.5} x2={13.5} y1={at} y2={at} strokeWidth={1.3} {...ink} />
          ))}
        </>
      );
    case 'dots':
      return (
        <>
          {[
            [5, 5],
            [11, 5],
            [5, 11],
            [11, 11],
          ].map(([cx, cy]) => (
            <circle key={`${cx},${cy}`} cx={cx} cy={cy} r={1.9} fill="#ffffff" fillOpacity={0.92} data-mark-part="" />
          ))}
        </>
      );
  }
}

/** A swatch of a palette colour with its mark; an outline without a fill for an object that has no colour of the palette. */
export function ColorSwatch({ color }: { color: BodyColorName | undefined }) {
  const mark = color === undefined ? null : bodyMarks[color];
  return (
    <svg className="robot-held-swatch" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <rect x={1} y={1} width={14} height={14} rx={3} fill={color === undefined ? 'none' : bodyPalette[color]} stroke="currentColor" strokeWidth={1} />
      {mark !== null && <MarkShapes mark={mark} />}
    </svg>
  );
}

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
      <span className="robot-badge robot-badge-held" data-testid="robot-held" data-color={color ?? 'none'} data-mark={(color === undefined ? null : bodyMarks[color]) ?? 'none'}>
        <ColorSwatch color={color} />
        {t('robot.hud.holding', { object: objectName(t, scenario, heldId, round) })}
      </span>
    </div>
  );
});
