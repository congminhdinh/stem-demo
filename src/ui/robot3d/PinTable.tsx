import { useText } from '../i18n/text';
import { rowText, type HubRow } from './pin-text';

// The table of the hub panel (N18 R4.5), the plan's chain written out: role → port → pins → live values, for example
// "Motor trái 50 % → M1 → D5 PWM 128, D7 HIGH, D8 LOW". The same words are the row's title. Before a run the values are left out and what
// remains is how the kit is wired.

export function PinTable({ rows }: { rows: readonly HubRow[] }) {
  const t = useText();
  return (
    <table className="hub-table" aria-label={t('robot.pins.table')} data-testid="hub-table">
      <thead>
        <tr>
          <th scope="col">{t('robot.pins.col.part')}</th>
          <th scope="col">{t('robot.pins.col.port')}</th>
          <th scope="col">{t('robot.pins.col.pins')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.role} data-testid={`hub-row-${row.role}`} title={rowText(row)}>
            <th scope="row" className="hub-table-part">
              <span className="hub-table-name">{row.name}</span>
              {row.value !== null && (
                <span className="hub-table-value" data-testid={`hub-row-value-${row.role}`}>
                  {row.value}
                </span>
              )}
            </th>
            <td className="hub-table-port">
              <span className="hub-port">{row.port}</span>
            </td>
            <td>
              <ul className="hub-chips">
                {row.pins.map((pin) => (
                  <li key={pin.pin} className="hub-chip" data-testid={`hub-chip-${pin.pin}`} data-kind={pin.kind ?? 'idle'} data-input={pin.input}>
                    <span className="hub-chip-pin">{pin.pin}</span>
                    <span className="hub-chip-signal">{pin.signal}</span>
                    {pin.value !== null && <span className="hub-chip-value">{pin.value}</span>}
                  </li>
                ))}
              </ul>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
