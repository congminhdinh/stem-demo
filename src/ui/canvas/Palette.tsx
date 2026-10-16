import { isMessageKey } from '../i18n/messages';
import { useText } from '../i18n/text';
import type { PaletteItem } from './palette-model';

type PaletteProps = {
  items: PaletteItem[];
  /** True while running: the circuit cannot change (plan §3.4). */
  disabled: boolean;
  onAdd(deviceType: string): void;
};

/** Click-to-add: each device goes to the middle of the canvas. */
export function Palette({ items, disabled, onAdd }: PaletteProps) {
  const t = useText();
  // A device the dictionary does not know keeps the name of its definition.
  const nameOf = (item: PaletteItem) => {
    const key = `device.${item.deviceType}`;
    return isMessageKey(key) ? t(key) : item.name;
  };
  return (
    <div className="palette" role="toolbar" aria-label={t('palette.label')}>
      {items.map((item) => (
        <button
          key={item.deviceType}
          type="button"
          aria-label={t('palette.add', { name: nameOf(item) })}
          disabled={disabled}
          onClick={() => onAdd(item.deviceType)}
        >
          + {nameOf(item)}
        </button>
      ))}
    </div>
  );
}
