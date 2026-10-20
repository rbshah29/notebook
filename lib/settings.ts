'use client';
import { useSyncExternalStore } from 'react';

export type CodeTheme = 'vscode' | 'github' | 'one-dark' | 'monokai';

/** Per-device editor preferences. Note data never lives here. */
export type Settings = {
  fontSize: 'small' | 'medium' | 'large';
  width: 'narrow' | 'normal' | 'wide' | 'full';
  codeTheme: CodeTheme;
  tabSize: 2 | 4;
  lineNumbers: boolean;
  wordWrap: boolean;
  spellcheck: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  fontSize: 'medium',
  width: 'normal',
  codeTheme: 'vscode',
  tabSize: 4,
  lineNumbers: false,
  wordWrap: false,
  spellcheck: true,
};

const KEY = 'notebook:settings';
const listeners = new Set<() => void>();
let current: Settings | null = null;

function load(): Settings {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** The current settings; safe to call outside React (editor plugins read it at keypress time). */
export function getSettings(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  return current ??= load();
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...getSettings(), ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Storage can be unavailable (private mode, quota); the in-memory value still applies.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Keep other tabs in step.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    current = load();
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings, () => DEFAULT_SETTINGS);
}

const FONT_SIZES = { small: '15px', medium: '16px', large: '18px' };
const WIDTHS = { narrow: '640px', normal: '760px', wide: '960px', full: 'none' };

/** CSS variables and data attributes that apply settings to a subtree. */
export function settingsStyle(s: Settings): React.CSSProperties & Record<`--${string}`, string> {
  return {
    '--editor-font-size': FONT_SIZES[s.fontSize],
    '--editor-width': WIDTHS[s.width],
    '--code-tab-size': String(s.tabSize),
  };
}
