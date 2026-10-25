import { describe, expect, it } from 'vitest';
import { readRules, readUi, robotSheets } from './__fixtures__/css-audit';

// N18 R8: reduced motion. Whatever the lab's style sheets animate or ease must stop for a learner who asked for less motion
// (`prefers-reduced-motion: reduce`): the loading sign's spinner, the robot button's cap. What the 3D view moves by itself (the camera's
// glide between views, its damping, the chase camera's swing, the zone's pulse, the results card's slide of the picture) reads the same
// preference in code (CameraRig, sensor-overlay-math `pulseLevel`, TopViewSensors); the E2E (robot-lab-a11y.spec.ts) watches the camera.

const reduce = '@media (prefers-reduced-motion: reduce)';

describe('the lab’s style sheets under reduced motion (N18 R8)', () => {
  it('stop every animation and every transition they start', () => {
    let moving = 0;
    for (const path of [...robotSheets, 'app/app.css']) {
      const rules = readRules(readUi(path));
      const calm = rules.filter((rule) => rule.within.includes(reduce));
      rules.forEach((rule, index) => {
        if (rule.within.includes(reduce)) return;
        const motion = ['animation', 'animation-name', 'transition', 'transition-property'].filter((property) => rule.props[property] !== undefined && rule.props[property] !== 'none');
        if (motion.length === 0) return;
        moving++;
        // A rule of the reduced-motion block that comes after it, for the same elements, and says none.
        const stops = calm.some((stopper) => {
          const sameElements = stopper.selector.split(',').map((part) => part.trim());
          const mine = rule.selector.split(',').map((part) => part.trim());
          const later = rules.indexOf(stopper) > index;
          const saysNone = motion.every((property) => {
            const family = property.startsWith('animation') ? ['animation', 'animation-name'] : ['transition', 'transition-property'];
            return family.some((name) => stopper.props[name] === 'none');
          });
          return later && saysNone && mine.every((part) => sameElements.includes(part));
        });
        expect(stops, `${path}: ${rule.selector} moves (${motion.join(', ')}) and nothing under ${reduce} stops it`).toBe(true);
      });
    }
    // The audit found the lab's animations (the spinner, the button's cap, the Blockly labs' check bar).
    expect(moving).toBeGreaterThanOrEqual(3);
  });

  it('has no smooth scrolling or scroll-linked easing the preference would not reach', () => {
    for (const path of [...robotSheets, 'app/app.css']) {
      for (const rule of readRules(readUi(path))) {
        if (rule.within.includes(reduce)) continue;
        expect(rule.props['scroll-behavior'] ?? 'auto', `${path}: ${rule.selector}`).not.toBe('smooth');
      }
    }
  });
});
