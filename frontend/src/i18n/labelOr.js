export const labelOr = (map, key, fallback) => {
  if (!key) return fallback;
  return map?.[key] || fallback || String(key);
};
