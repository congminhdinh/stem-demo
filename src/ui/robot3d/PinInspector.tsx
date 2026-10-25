import { useMemo } from 'react';
import type { BoardProfile } from '../../core/hardware/board';
import type { Kit } from '../../core/hardware/kit';
import { useLocale, useText } from '../i18n/text';
import { BoardDiagram } from './BoardDiagram';
import { boardLayout } from './board-layout';
import { ModuleCards } from './ModuleCards';
import { hubMap } from './pin-map';
import { hubRows } from './pin-text';
import { PinTable } from './PinTable';
import { useHubValues, type WorldSource } from './use-hub-values';
import './PinInspector.css';

// The "Cổng & chân" tab of the robot lab (N18 R4.5): the hub panel, with what OhStem's shows for its robot and what a learner of the plan's
// chain role → port → pin needs. Three parts that read one set of values:
//
//   a. the board: a generic UNO-compatible drawing whose pins D0–D13 and A0–A5 light by live level or PWM duty, the pins the kit uses
//      named after the part on them;
//   b. the cards: the drive motors' dials, the line sensors' eyes, the ultrasonic distance, the servo angle, the LED, the buzzer's tone,
//      the button, in kit order;
//   c. the table: part → port → pins → live values (`Motor trái 50 % → M1 → D5 PWM 128, D7 HIGH, D8 LOW`).
//
// The values are the run store's snapshot (`pins`, `sensors`, `servoDeg`, `leds`), taken at most ten times a second (use-hub-values.ts),
// and only while this tab is shown. Before a run, or after Đặt lại, there are none: the tab shows the static mapping of the kit.

type PinInspectorProps = {
  /** The run store (or anything that gives the world the 3D view draws). */
  store: WorldSource;
  kit: Kit;
  board: BoardProfile;
  /** The tab is the one in sight: the values follow the run only then. */
  active: boolean;
};

export function PinInspector({ store, kit, board, active }: PinInspectorProps) {
  const t = useText();
  const locale = useLocale();
  const map = useMemo(() => hubMap(kit, board), [kit, board]);
  const layout = useMemo(() => boardLayout(map), [map]);
  const values = useHubValues(store, map, active);
  const rows = useMemo(() => hubRows(t, locale, map, values), [t, locale, map, values]);
  return (
    <div className="pin-inspector" data-testid="pin-inspector" data-live={values.live}>
      <p className="hub-idle" data-testid="hub-idle" hidden={values.live}>
        {t('robot.pins.idle')}
      </p>
      <section className="hub-section hub-board-section">
        <BoardDiagram map={map} layout={layout} values={values} />
        <ul className="hub-legend" aria-label={t('robot.pins.legend')}>
          <li data-state="low">{t('robot.pins.legend.low')}</li>
          <li data-state="high">{t('robot.pins.legend.high')}</li>
          <li data-state="pwm">{t('robot.pins.legend.pwm')}</li>
          <li data-state="input">{t('robot.pins.legend.input')}</li>
        </ul>
      </section>
      <section className="hub-section">
        <ModuleCards map={map} values={values} />
      </section>
      <section className="hub-section">
        <PinTable rows={rows} />
      </section>
    </div>
  );
}
