// The theme catalogue, shared by the app and the published docs page.
//
// Each theme is either light or dark, and that decides more than colours: the
// logo has two artworks (an outlined wordmark that reads on dark, a solid one
// that reads on light) and the favicon follows the same split.

export const THEMES = [
  ['b4call-light', 'B4Call Light'],
  ['b4call', 'B4Call Dark'],
  ['light', 'Modern Light'],
  ['solarized', 'Solarized Light'],
  ['slate-dark', 'Slate Dark'],
  ['pure-dark', 'OLED Black'],
  ['nord', 'Nord'],
  ['forest', 'Forest'],
  ['cyberpunk', 'Cyberpunk'],
];

export const DEFAULT_THEME = 'b4call-light';

const LIGHT_THEMES = new Set(['b4call-light', 'light', 'solarized']);

export const LOGO_DARK = '/images/b4call-api.png';
export const LOGO_LIGHT = '/images/b4call-api_light.png';

export function isLightTheme(theme) {
  return LIGHT_THEMES.has(theme);
}

// Stamps the root element so CSS can key off both the exact theme and its
// light/dark scheme, and points the favicon at the matching artwork.
export function applyThemeAttributes(theme) {
  const light = isLightTheme(theme);
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-scheme', light ? 'light' : 'dark');

  const favicon = document.querySelector('link[rel="icon"]');
  if (favicon) favicon.href = light ? LOGO_LIGHT : LOGO_DARK;
}
