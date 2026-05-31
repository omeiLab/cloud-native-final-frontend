import { publicAssetPath, publicRootPath, resolvePublicAssetUrl } from './publicPath';

const EVENT_IMAGE_PATHS = [1, 2, 3, 4, 5, 6].map((n) => `/image/event_${n}.webp`);
const EVENT_IMAGES = EVENT_IMAGE_PATHS.map(publicAssetPath);
const AVATAR_IMAGES = {
  male: publicAssetPath('/image/male.webp'),
  female: publicAssetPath('/image/female.webp')
};
const LOGO_IMAGE = publicAssetPath('/image/logo.png');

const hashText = (text = '') => {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = (h << 5) - h + text.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
};

export const pickEventImage = (seed) => {
  const idx = hashText(seed) % EVENT_IMAGES.length;
  return EVENT_IMAGES[idx];
};

export const pickAvatarImage = (seed) => {
  const lowered = String(seed || '').toLowerCase();
  const isFemale = /(f|woman|female|ms|mrs)/i.test(lowered);
  return isFemale ? AVATAR_IMAGES.female : AVATAR_IMAGES.male;
};

export {
  EVENT_IMAGE_PATHS,
  EVENT_IMAGES,
  AVATAR_IMAGES,
  LOGO_IMAGE,
  publicAssetPath,
  publicRootPath,
  resolvePublicAssetUrl
};
