import type { Locale } from '../i18n/messages';
import type { Text } from '../i18n/text';
import type { RobotRole } from '../../core/hardware/kit';
import { formatNumber } from './format';
import type { HubMap, HubValues, ModuleView, PinReading } from './pin-map';

// The words of the robot lab's "Cổng & chân" tab (N18 R4.5): the values of pin-map.ts said in the learner's language, and the rows of the
// plan's chain role → port → pins → value, for the table, as data a test reads exactly. HIGH, LOW and PWM are the board's own words and are
// the same in both languages.

/** What one pin carries, as the table writes it: `LOW`, `HIGH`, `PWM 128`, `tone 440 Hz`, `servo 90°`. */
export function pinValueText(t: Text, locale: Locale, reading: PinReading): string {
  switch (reading.kind) {
    case 'low':
      return 'LOW';
    case 'high':
      return 'HIGH';
    case 'pwm':
      return `PWM ${reading.duty}`;
    case 'tone':
      return t('robot.pins.value.tone', { hz: formatNumber(reading.hz, locale) });
    case 'servo':
      return t('robot.pins.value.servo', { deg: formatNumber(reading.deg, locale) });
  }
}

/** What a part shows, in a few words: `50 %`, `90°`, `23,4 cm`, `tối`, `bật`, `440 Hz`, `đang nhấn`. Null when the snapshot says nothing. */
export function moduleValueText(t: Text, locale: Locale, view: ModuleView | undefined): string | null {
  switch (view?.kind) {
    case undefined:
      return null;
    case 'dc-motor':
      return t('robot.pins.motor.value', { percent: formatNumber(view.percent, locale) });
    case 'servo':
      return view.deg === null ? null : t('robot.pins.servo.value', { deg: formatNumber(view.deg, locale) });
    case 'ultrasonic':
      return t('robot.pins.ultra.value', { cm: formatNumber(Math.round(view.cm * 10) / 10, locale) });
    case 'line-sensor':
      return t(view.dark ? 'robot.pins.line.dark' : 'robot.pins.line.light');
    case 'led':
      return t(view.on ? 'robot.pins.led.on' : 'robot.pins.led.off');
    case 'buzzer':
      return view.hz === null ? t('robot.pins.buzzer.off') : t('robot.pins.buzzer.hz', { hz: formatNumber(view.hz, locale) });
    case 'button':
      return t(view.pressed ? 'robot.pins.button.down' : 'robot.pins.button.up');
  }
}

/** The name of a part of the kit, in the learner's language. */
export const roleName = (t: Text, role: RobotRole): string => t(`robot.pins.role.${role}`);

export type HubRowPin = {
  pin: string;
  /** The driver's name for the pin: `EN`. */
  signal: string;
  /** What the pin carries now; null before a run. */
  value: string | null;
  kind: PinReading['kind'] | null;
  input: boolean;
};

/** One line of the table: a part, its port, its pins with what they carry, and the part's own value (`50 %`). */
export type HubRow = { role: string; name: string; port: string; value: string | null; pins: HubRowPin[] };

/** The table's rows in kit order. With no values (`values.live` false) every value is null: the static mapping. */
export function hubRows(t: Text, locale: Locale, map: HubMap, values: HubValues): HubRow[] {
  return map.modules.map((module) => ({
    role: module.role,
    name: roleName(t, module.role as RobotRole),
    port: module.port,
    value: moduleValueText(t, locale, values.modules[module.role]),
    pins: module.pins.map((pin) => {
      const view = values.pins[pin.pin];
      return {
        pin: pin.pin,
        signal: pin.name,
        value: view === undefined ? null : pinValueText(t, locale, view.reading),
        kind: view?.reading.kind ?? null,
        input: view?.input ?? false,
      };
    }),
  }));
}

/** A row as one sentence: `Motor trái 50 % → M1 → D5 PWM 128, D7 HIGH, D8 LOW`. */
export function rowText(row: HubRow): string {
  const part = row.value === null ? row.name : `${row.name} ${row.value}`;
  const pins = row.pins.map((pin) => (pin.value === null ? pin.pin : `${pin.pin} ${pin.value}`)).join(', ');
  return `${part} → ${row.port} → ${pins}`;
}
