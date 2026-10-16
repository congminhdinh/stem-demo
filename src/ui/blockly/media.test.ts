import { describe, expect, it } from 'vitest';
import { blocklyMediaUrl } from './media';

describe('blocklyMediaUrl (S6)', () => {
  it.each([
    ['/', '/blockly-media/'],
    ['/lab/', '/lab/blockly-media/'],
    ['/lab', '/lab/blockly-media/'],
    ['./', './blockly-media/'],
  ])('serves the media of base %j at %j', (base, url) => {
    expect(blocklyMediaUrl(base)).toBe(url);
  });
});
