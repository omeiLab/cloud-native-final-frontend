import { describe, expect, it } from 'vitest';
import { pickAvatarImage, pickEventImage, publicAssetPath, resolvePublicAssetUrl } from '../media';
import { publicRootPath } from '../publicPath';

describe('media helpers', () => {
  it('picks deterministic images from seeds', () => {
    expect(pickEventImage('evt-1')).toMatch(/event_\d\.webp$/);
    expect(pickAvatarImage('alice_female')).toMatch(/female\.webp$/);
    expect(pickAvatarImage('bob')).toMatch(/male\.webp$/);
  });

  it('builds public asset paths', () => {
    expect(publicAssetPath('/image/logo.png')).toBe('/image/logo.png');
    expect(publicRootPath('/image/logo.png')).toBe('/image/logo.png');
    expect(resolvePublicAssetUrl('image/event_1.webp')).toBe('/image/event_1.webp');
    expect(resolvePublicAssetUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');
  });
});
