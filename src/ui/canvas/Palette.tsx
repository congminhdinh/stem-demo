import type { PaletteItem } from './palette-model';

type PaletteProps = {
  items: PaletteItem[];
  /** True while running: the circuit cannot change (plan §3.4). */
  disabled: boolean;
  onAdd(deviceType: string): void;
};

/** Click-to-add: each device goes to the middle of the canvas. */
export function Palette({ items, disabled, onAdd }: PaletteProps) {
  return (
    <div className="palette" role="toolbar" aria-label="Add a device">
      {items.map((item) => (
        <button
          key={item.deviceType}
          type="button"
          aria-label={`Add ${item.name}`}
          disabled={disabled}
          onClick={() => onAdd(item.deviceType)}
        >
          + {item.name}
        </button>
      ))}
    </div>
  );
}
