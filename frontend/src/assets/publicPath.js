const PUBLIC_ASSET_SEGMENT_PATTERN = /^\/?(backgrounds|image|music)\//;
const ABSOLUTE_URL_PATTERN = /^(https?:|data:|blob:)/i;

const appBasePath = import.meta.env.BASE_URL === '/'
  ? ''
  : import.meta.env.BASE_URL.replace(/\/$/, '');

export const publicAssetPath = (path) => {
  const trimmed = String(path || '').trim();
  if (!trimmed || ABSOLUTE_URL_PATTERN.test(trimmed)) return trimmed;
  if (appBasePath && trimmed.startsWith(`${appBasePath}/`)) return trimmed;
  return `${appBasePath}/${trimmed.replace(/^\/+/, '')}`;
};

export const publicRootPath = (path) => {
  const trimmed = String(path || '').trim();
  if (!trimmed || ABSOLUTE_URL_PATTERN.test(trimmed)) return trimmed;
  if (appBasePath && trimmed.startsWith(`${appBasePath}/`)) {
    return trimmed.slice(appBasePath.length) || '/';
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
};

export const resolvePublicAssetUrl = (path) => {
  const trimmed = String(path || '').trim();
  if (!trimmed || ABSOLUTE_URL_PATTERN.test(trimmed)) return trimmed;
  if (PUBLIC_ASSET_SEGMENT_PATTERN.test(trimmed)) return publicAssetPath(trimmed);
  return trimmed;
};
