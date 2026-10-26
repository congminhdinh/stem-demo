import type { Locale } from '../i18n/messages';
import type { Text } from '../i18n/text';
import type { ColorName } from '../../core/hardware/drivers';
import type { RobotRole } from '../../core/hardware/kit';
import { formatNumber } from './format';
import type { ColorCounts, HubMap, HubOwner, HubValues, ModuleView, PinReading } from './pin-map';

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

/**
 * N19 E2: the claw is closed from this angle (degrees) and open below it: nothing attaches to a claw under 6° (plan §4.6 rule 5), so a cube
 * the jaws hold (27° on a 4 cm cube) reads "đóng" and the open claw (0°) "mở".
 */
export const CLAW_CLOSED_FROM_DEG = 6;

/** N19 E2: whether the claw at `deg` is open or closed, in a word. */
export const clawStateText = (t: Text, deg: number): string => t(deg < CLAW_CLOSED_FROM_DEG ? 'robot.pins.claw.open' : 'robot.pins.claw.closed');

/** N19 E2: whether the IR sensor sees an object: "có vật" or "không". */
export const irStateText = (t: Text, detected: boolean): string => t(detected ? 'robot.pins.ir.seen' : 'robot.pins.ir.clear');

/** N19 E2: the level an IR pin is at, in the board's own words. */
export const irLevelText = (level: 'low' | 'high'): string => (level === 'low' ? 'LOW' : 'HIGH');

/** N19 E2: a colour of COLOR_RULES in the learner's language ("đỏ", "không rõ"). */
export const colorNameText = (t: Text, name: ColorName): string => t(`robot.color.${name}`);

/** N19 E2: the raw counts of the colour sensor, `R 8047 G 1676 B 1382 C 9596` (whole numbers, the same in both languages). */
export const colorRawText = (t: Text, counts: ColorCounts): string => t('robot.pins.color.raw', { r: counts.r, g: counts.g, b: counts.b, c: counts.c });

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
    case 'gripper':
      return view.clawDeg === null || view.liftDeg === null
        ? null
        : t('robot.pins.gripper.value', { claw: formatNumber(view.clawDeg, locale), state: clawStateText(t, view.clawDeg), lift: formatNumber(view.liftDeg, locale) });
    case 'ir-obstacle':
      return t('robot.pins.ir.value', { level: irLevelText(view.level), state: irStateText(t, view.detected) });
    case 'color-sensor':
      return view.rgbc === null || view.color === null ? null : t('robot.pins.color.value', { raw: colorRawText(t, view.rgbc), color: colorNameText(t, view.color) });
  }
}

/** The name of a part of the kit, in the learner's language. */
export const roleName = (t: Text, role: RobotRole): string => t(`robot.pins.role.${role}`);

/**
 * What the board's drawing writes beside a pin the kit uses: the part, and for a part that has several pins (a motor's EN, IN1 and IN2,
 * the ultrasonic's TRIG and ECHO) which of them this is, so that two pins of one part are told apart. A part with one pin has no signal.
 */
export function padLabel(t: Text, owner: HubOwner): { part: string; signal: string | null } {
  return { part: roleName(t, owner.role as RobotRole), signal: owner.portPins > 1 ? owner.signal : null };
}

/**
 * N19 E2: how many characters the longest name written under the board's analog header has, part and signal as the drawing writes them
 * (`Cảm biến màu SDA`): the layout gives the labels room for it (board-layout.ts).
 */
export function bottomLabelChars(t: Text, map: HubMap): number {
  let longest = 0;
  for (const [pin, owner] of map.owners) {
    if (!pin.startsWith('A')) continue;
    const { part, signal } = padLabel(t, owner);
    longest = Math.max(longest, part.length + (signal === null ? 0 : 1 + signal.length));
  }
  return longest;
}

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
