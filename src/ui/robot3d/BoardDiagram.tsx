import type { RobotRole } from '../../core/hardware/kit';
import { useLocale, useText } from '../i18n/text';
import { padLook, type BoardLayout } from './board-layout';
import type { HubMap, HubValues } from './pin-map';
import { pinValueText, roleName } from './pin-text';

// The board of the hub panel (N18 R4.5): a generic UNO-compatible board, our own drawing with no logo and no wordmark. Its pins D0–D13 and
// A0–A5 light with what they carry (a level, a PWM duty, a tone, a servo's command), and each pin the kit uses has the name of the part on
// it written outside the board. Everything the picture says is also in the table under it and in each pad's title, so nothing depends on
// a colour alone.

type BoardDiagramProps = { map: HubMap; layout: BoardLayout; values: HubValues };

/** The static artwork: the board, its headers, the connectors, the chip and the button. Positions follow the layout. */
function BoardArt({ layout }: { layout: BoardLayout }) {
  const { body, pads, padRadius, pitch } = layout;
  const margin = padRadius + 4;
  /** The strip of a header: a bar behind its pads. */
  const strip = (xs: readonly number[], y: number) => ({ x: Math.min(...xs) - margin, y: y - margin, width: Math.max(...xs) - Math.min(...xs) + 2 * margin, height: 2 * margin });
  const top = pads.filter((pad) => pad.side === 'top');
  const bottom = pads.filter((pad) => pad.side === 'bottom');
  const [firstBottom] = bottom;
  // The power header stands left of the analog one: eight pads of no signal, drawn so the board reads as one.
  const power = firstBottom === undefined ? [] : Array.from({ length: 8 }, (_, index) => firstBottom.x - (8 - index) * pitch);
  return (
    <g className="hub-board-art" aria-hidden="true">
      <rect className="hub-board-usb" x={body.x - 10} y={body.y + 26} width={46} height={36} rx={3} />
      <rect className="hub-board-jack" x={body.x - 10} y={body.y + body.height - 34} width={34} height={24} rx={3} />
      <rect className="hub-board-body" x={body.x} y={body.y} width={body.width} height={body.height} rx={10} />
      {top.length > 0 && <rect className="hub-board-strip" {...strip(top.map((pad) => pad.x), top[0]!.y)} rx={3} />}
      {bottom.length > 0 && <rect className="hub-board-strip" {...strip(bottom.map((pad) => pad.x), bottom[0]!.y)} rx={3} />}
      {firstBottom !== undefined && <rect className="hub-board-strip" {...strip(power, firstBottom.y)} rx={3} />}
      {power.map((x) => (
        <circle key={x} className="hub-board-hole" cx={x} cy={firstBottom!.y} r={3} />
      ))}
      <rect className="hub-board-chip" x={body.x + body.width / 2 - 52} y={body.y + 42} width={104} height={20} rx={3} />
      <circle className="hub-board-reset" cx={body.x + 58} cy={body.y + 66} r={8} />
    </g>
  );
}

export function BoardDiagram({ map, layout, values }: BoardDiagramProps) {
  const t = useText();
  const locale = useLocale();
  return (
    <svg
      className="hub-board"
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img"
      aria-label={t('robot.pins.diagram')}
      data-testid="hub-board"
      data-live={values.live}
    >
      <BoardArt layout={layout} />
      {layout.pads.map((pad) => {
        const view = values.pins[pad.id];
        const look = padLook(view, map.pwmMax);
        const owner = map.owners.get(pad.id);
        const value = view === undefined ? '—' : pinValueText(t, locale, view.reading);
        const title = owner
          ? t('robot.pins.pad.owner', { pin: pad.id, value, part: roleName(t, owner.role as RobotRole), signal: owner.signal, port: owner.port })
          : t(view === undefined ? 'robot.pins.pad.free' : 'robot.pins.pad', { pin: pad.id, value });
        return (
          <g key={pad.id} className="hub-pad" data-testid={`hub-pad-${pad.id}`} data-pin={pad.id} data-state={look.state} data-input={look.input} data-used={owner !== undefined}>
            <title>{title}</title>
            <circle className="hub-pad-base" cx={pad.x} cy={pad.y} r={layout.padRadius} />
            <circle className="hub-pad-lit" cx={pad.x} cy={pad.y} r={layout.padRadius - 1.5} style={{ fillOpacity: look.glow }} />
            <text className="hub-pad-name" x={pad.name.x} y={pad.name.y} textAnchor="middle">
              {pad.id}
            </text>
            {owner && (
              <text
                className="hub-pad-part"
                x={pad.label.x}
                y={pad.label.y}
                dy="0.35em"
                transform={`rotate(${pad.label.rotate} ${pad.label.x} ${pad.label.y})`}
                data-testid={`hub-part-${pad.id}`}
              >
                {roleName(t, owner.role as RobotRole)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
