const EVENT_IMAGES = [1, 2, 3, 4, 5, 6].map((n) => `/image/event_${n}.webp`);
const AVATAR_IMAGES = {
  male: '/image/male.webp',
  female: '/image/female.webp'
};
const LOGO_IMAGE = '/image/logo.png';

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
  const isFemale = /(f|woman|female|女|小姐|ms|mrs)/i.test(lowered);
  return isFemale ? AVATAR_IMAGES.female : AVATAR_IMAGES.male;
};

export { EVENT_IMAGES, AVATAR_IMAGES, LOGO_IMAGE };
