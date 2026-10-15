export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_KEY = 'notebook:theme';

/**
 * Runs inline in <head> before first paint so the page never flashes the wrong theme.
 * Keep it dependency-free; it is serialized as a string.
 */
export const themeScript = `(function(){try{
var k='${THEME_KEY}',m=window.matchMedia('(prefers-color-scheme: dark)');
function apply(){var p=JSON.parse(localStorage.getItem(k)||'"system"');
var d=p==='dark'||(p==='system'&&m.matches);
document.documentElement.dataset.theme=d?'dark':'light';}
apply();m.addEventListener('change',apply);window.__applyTheme=apply;
}catch(e){}})();`;

export function applyTheme(pref: ThemePreference) {
  try {
    window.localStorage.setItem(THEME_KEY, JSON.stringify(pref));
  } catch {}
  const w = window as Window & { __applyTheme?: () => void };
  if (w.__applyTheme) return w.__applyTheme();
  const dark = pref === 'dark' ||
    (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function readTheme(): ThemePreference {
  try {
    return JSON.parse(window.localStorage.getItem(THEME_KEY) ?? '"system"');
  } catch {
    return 'system';
  }
}
