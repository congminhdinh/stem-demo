import { useMemo, type ReactNode } from 'react';
import type { RobotRole } from '../../core/hardware/kit';
import { useLocale, useText, type Text } from '../i18n/text';
import type { Locale } from '../i18n/messages';
import { formatNumber } from './format';
import { arcPath, needleAngle, polar } from './gauge';
import { ColorSwatch, swatchMark, type SwatchColor } from './HeldChip';
import { hubCards, type HubCard, type HubMap, type HubModule, type HubValues, type ModuleView } from './pin-map';
import { clawStateText, colorNameText, colorRawText, irLevelText, irStateText, moduleValueText, roleName } from './pin-text';

// The cards of the hub panel (N18 R4.5), one for each part of the kit in kit order, as OhStem's hub shows its drive base and its line
// sensor: a dial with the live percent for each drive motor, the servo's angle on a dial, the ultrasonic distance in cm, the line sensors'
// eyes as dots lit on a dark strip, the LED, the buzzer's tone and the button. Before a run a card shows its part with a dash; every
// value is also written as text, so the picture is never the only thing that says it. N19 E2: the gripper car's three more: the gripper (two
// dials: the claw's angle with mở or đóng, and the arm's angle), the IR sensor between its jaws (its pin level and có vật or không) and the
// colour sensor (a swatch with the colour-blind mark of the colour it names, the name, the raw R G B C, and the pins SDA and SCL).

type CardProps = { card: HubCard; values: HubValues };

const NONE = '—';

/** The dial's drawing: a half circle track, the arc from `from` to the needle, and the needle. */
function Dial({ view, min, max, zero, tone }: { view: number | null; min: number; max: number; zero: number; tone: 'forward' | 'backward' | 'servo' | 'none' }) {
  const [cx, cy, r] = [50, 50, 38];
  const angle = view === null ? null : needleAngle(view, min, max);
  const [nx, ny] = polar(cx, cy, r - 4, angle ?? 90);
  const [tx, ty] = polar(cx, cy, r + 6, zero);
  const [ux, uy] = polar(cx, cy, r - 6, zero);
  return (
    <svg className="hub-dial" viewBox="0 0 100 58" aria-hidden="true" data-tone={tone}>
      <path className="hub-dial-track" d={arcPath(cx, cy, r, 180, 0)} />
      {zero === 90 && <line className="hub-dial-zero" x1={ux} y1={uy} x2={tx} y2={ty} />}
      {angle !== null && <path className="hub-dial-value" d={arcPath(cx, cy, r, zero, angle)} />}
      {angle !== null && <line className="hub-dial-needle" x1={cx} y1={cy} x2={nx} y2={ny} />}
      <circle className="hub-dial-hub" cx={cx} cy={cy} r={3.5} />
    </svg>
  );
}

function MotorBody({ module, view, text, t }: { module: HubModule; view: ModuleView | undefined; text: string | null; t: Text }) {
  const motor = view?.kind === 'dc-motor' ? view : null;
  return (
    <>
      <Dial view={motor?.percent ?? null} min={-100} max={100} zero={90} tone={motor === null ? 'none' : motor.direction === 'backward' ? 'backward' : 'forward'} />
      <span className="hub-card-value" data-testid={`hub-value-${module.role}`}>
        {text ?? NONE}
      </span>
      <span className="hub-card-note" data-testid={`hub-direction-${module.role}`}>
        {motor === null ? ' ' : t(`robot.pins.motor.${motor.direction}`)}
      </span>
    </>
  );
}

function ServoBody({ module, view, text }: { module: HubModule; view: ModuleView | undefined; text: string | null }) {
  return (
    <>
      <Dial view={view?.kind === 'servo' ? view.deg : null} min={0} max={180} zero={180} tone={view?.kind === 'servo' && view.deg !== null ? 'servo' : 'none'} />
      <span className="hub-card-value" data-testid={`hub-value-${module.role}`}>
        {text ?? NONE}
      </span>
    </>
  );
}

function LineBody({ card, values, t }: { card: HubCard; values: HubValues; t: Text }) {
  return (
    <ul className="hub-eyes" data-testid="hub-eyes">
      {card.modules.map((module) => {
        const view = values.modules[module.role];
        const dark = view?.kind === 'line-sensor' ? view.dark : null;
        return (
          <li key={module.role} className="hub-eye" data-testid={`hub-eye-${module.role}`} data-dark={dark === null ? 'unknown' : dark}>
            <span className="hub-eye-dot" aria-hidden="true" />
            <span className="hub-eye-name">{roleName(t, module.role as RobotRole)}</span>
            <span className="visually-hidden">{dark === null ? NONE : t(dark ? 'robot.pins.line.dark' : 'robot.pins.line.light')}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** N19 E2: the gripper's two servos, each on a dial of 0..90°: the claw (with whether it is open or closed) and the lift arm. */
function GripperBody({ module, view, t, locale }: { module: HubModule; view: ModuleView | undefined; t: Text; locale: Locale }) {
  const gripper = view?.kind === 'gripper' ? view : null;
  const part = (id: 'claw' | 'lift', deg: number | null, note: string) => (
    <div className="hub-gripper-part" data-testid={`hub-gripper-${module.role}-${id}`}>
      <span className="hub-card-label" data-testid={`hub-label-${module.role}-${id}`}>
        {t(`robot.pins.gripper.${id}`)}
      </span>
      <Dial view={deg} min={0} max={90} zero={180} tone={deg === null ? 'none' : 'servo'} />
      <span className="hub-card-value" data-testid={`hub-value-${module.role}-${id}`}>
        {deg === null ? NONE : t('robot.pins.servo.value', { deg: formatNumber(deg, locale) })}
      </span>
      <span className="hub-card-note" data-testid={`hub-note-${module.role}-${id}`}>
        {note}
      </span>
    </div>
  );
  const claw = gripper?.clawDeg ?? null;
  return (
    <div className="hub-gripper">
      {part('claw', claw, claw === null ? ' ' : clawStateText(t, claw))}
      {part('lift', gripper?.liftDeg ?? null, ' ')}
    </div>
  );
}

/** N19 E2: the colour sensor: a swatch of the colour it names (with its mark), the name, the raw counts, and the pins it is on. */
function ColorBody({ module, view, t }: { module: HubModule; view: ModuleView | undefined; t: Text }) {
  const sensor = view?.kind === 'color-sensor' ? view : null;
  const swatch: SwatchColor | undefined = sensor?.color === 'white' || sensor?.color === 'black' || sensor?.color === 'red' || sensor?.color === 'green' || sensor?.color === 'blue' || sensor?.color === 'yellow' ? sensor.color : undefined;
  const pin = (name: string) => module.pins.find((candidate) => candidate.name === name)?.pin ?? NONE;
  return (
    <>
      <span className="hub-color-reading">
        <span className="hub-color-swatch" data-testid={`hub-swatch-${module.role}`} data-color={sensor?.color ?? 'none'} data-mark={swatchMark(swatch)}>
          <ColorSwatch color={swatch} size={26} />
        </span>
        <span className="hub-card-value" data-testid={`hub-value-${module.role}`}>
          {sensor?.color == null ? NONE : colorNameText(t, sensor.color)}
        </span>
      </span>
      <span className="hub-card-note" data-testid={`hub-raw-${module.role}`}>
        {sensor === null ? ' ' : sensor.rgbc === null ? t('robot.pins.color.noReading') : colorRawText(t, sensor.rgbc)}
      </span>
      <span className="hub-card-note" data-testid={`hub-wires-${module.role}`}>
        {t('robot.pins.color.wires', { sda: pin('SDA'), scl: pin('SCL') })}
      </span>
    </>
  );
}

function ValueBody({ module, text, children, lit }: { module: HubModule; text: string | null; children?: ReactNode; lit: boolean | null }) {
  return (
    <>
      <span className="hub-lamp" aria-hidden="true" data-testid={`hub-lamp-${module.role}`} data-lit={lit === null ? 'unknown' : lit}>
        {children}
      </span>
      <span className="hub-card-value" data-testid={`hub-value-${module.role}`}>
        {text ?? NONE}
      </span>
    </>
  );
}

function Card({ card, values, t, locale, ports }: CardProps & { t: Text; locale: Locale; ports: string }) {
  const [module] = card.modules;
  if (module === undefined) return null;
  const view = values.modules[module.role];
  const text = moduleValueText(t, locale, view);
  const title = card.kind === 'line-sensor' ? t('robot.pins.group.line') : roleName(t, module.role as RobotRole);
  let body;
  switch (card.kind) {
    case 'dc-motor':
      body = <MotorBody module={module} view={view} text={text} t={t} />;
      break;
    case 'servo':
      body = <ServoBody module={module} view={view} text={text} />;
      break;
    case 'line-sensor':
      body = <LineBody card={card} values={values} t={t} />;
      break;
    case 'ultrasonic':
      body = (
        <>
          <span className="hub-card-value" data-testid={`hub-value-${module.role}`}>
            {text ?? NONE}
          </span>
          <span className="hub-card-note" data-testid={`hub-note-${module.role}`}>
            {view?.kind === 'ultrasonic' && !view.echo ? t('robot.pins.ultra.noEcho') : ' '}
          </span>
        </>
      );
      break;
    case 'led':
      body = <ValueBody module={module} text={text} lit={view?.kind === 'led' ? view.on : null} />;
      break;
    case 'buzzer':
      body = <ValueBody module={module} text={text} lit={view?.kind === 'buzzer' ? view.hz !== null : null} />;
      break;
    case 'button':
      body = <ValueBody module={module} text={text} lit={view?.kind === 'button' ? view.pressed : null} />;
      break;
    case 'gripper':
      body = <GripperBody module={module} view={view} t={t} locale={locale} />;
      break;
    case 'ir-obstacle': {
      const ir = view?.kind === 'ir-obstacle' ? view : null;
      body = (
        <>
          <ValueBody module={module} text={ir === null ? null : irLevelText(ir.level)} lit={ir === null ? null : ir.detected} />
          <span className="hub-card-note" data-testid={`hub-note-${module.role}`}>
            {ir === null ? ' ' : irStateText(t, ir.detected)}
          </span>
        </>
      );
      break;
    }
    case 'color-sensor':
      body = <ColorBody module={module} view={view} t={t} />;
      break;
  }
  return (
    <li className="hub-card" data-testid={`hub-card-${card.id}`} data-kind={card.kind} data-live={view !== undefined}>
      <div className="hub-card-head">
        <span className="hub-card-title">{title}</span>
        <span className="hub-card-port">{ports}</span>
      </div>
      <div className="hub-card-body">{body}</div>
    </li>
  );
}

export function ModuleCards({ map, values }: { map: HubMap; values: HubValues }) {
  const t = useText();
  const locale = useLocale();
  const cards = useMemo(() => hubCards(map), [map]);
  return (
    <ul className="hub-cards" aria-label={t('robot.pins.parts')} data-testid="hub-cards">
      {cards.map((card) => (
        <Card key={card.id} card={card} values={values} t={t} locale={locale} ports={card.modules.map((module) => module.port).join(' ')} />
      ))}
    </ul>
  );
}
