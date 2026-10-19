import type { DeviceDefinition } from '../../core/devices/device-definition';
import { isMessageKey, translate, type Locale } from './messages';

// The names the canvas draws on a device, in the UI's language (N8s). A definition is core data, in English (B1);
// the canvas draws a copy with the device's name from the UI dictionary (`device.<id>`, as the palette says it) and
// the onboard parts' labels below. Ports keep their labels: pin names (P0, GND, D13) are the same in every language.

/** The labels of onboard parts (ybc-board.json), by the core's English label. A and B stay. */
export const viPartLabels: Readonly<Record<string, string>> = {
  Display: 'Màn hình',
  Light: 'Ánh sáng',
  Buzzer: 'Loa',
  Temp: 'Nhiệt độ',
  Accel: 'Gia tốc',
};

/** `definition` with the text the canvas draws in `locale`: the same object in English. */
export function localizeDeviceDefinition(definition: DeviceDefinition, locale: Locale): DeviceDefinition {
  if (locale === 'en') {
    return definition;
  }
  const key = `device.${definition.id}`;
  const name = isMessageKey(key) ? translate(locale, key) : definition.name;
  const board = definition.board;
  const onboard = board?.onboard;
  return {
    ...definition,
    name,
    ...(board && onboard
      ? {
          board: {
            ...board,
            onboard: onboard.map((part) => {
              const label = Object.hasOwn(viPartLabels, part.label) ? viPartLabels[part.label] : undefined;
              return label === undefined ? part : { ...part, label };
            }),
          },
        }
      : {}),
  };
}
