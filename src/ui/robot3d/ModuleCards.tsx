import { useMemo, type ReactNode } from 'react';
import type { RobotRole } from '../../core/hardware/kit';
import { useLocale, useText, type Text } from '../i18n/text';
import type { Locale } from '../i18n/messages';
import { arcPath, needleAngle, polar } from './gauge';
import { hubCards, type HubCard, type HubMap, type HubModule, type HubValues, type ModuleView } from './pin-map';
import { moduleValueText, roleName } from './pin-text';

// The cards of the hub panel (N18 R4.5), one for each part of the kit in kit order, as OhStem's hub shows its drive base and its line
// sensor: a dial with the live percent for each drive motor, the servo's angle on a dial, the ultrasonic distance in cm, the line sensors'
// eyes as dots lit on a dark strip, the LED, the buzzer's tone and the button. Before a run a card shows its part with a dash; every
// value is also written as text, so the picture is never the only thing that says it.

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

function ValueBody({ module, text, children, lit }: { module: HubModule; text: string | null; children?: ReactNode; lit: boolean | null }) {
  return (
    <>
      <span className="hub-lamp" aria-hidden="true" data-lit={lit === null ? 'unknown' : lit}>
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
