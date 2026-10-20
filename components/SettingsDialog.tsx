'use client';
import { useState } from 'react';
import Dialog from '@/components/ui/Dialog';
import { updateSettings, useSettings, type Settings } from '@/lib/settings';
import { applyTheme, readTheme, type ThemePreference } from '@/lib/theme';

function Segmented<T extends string | number>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="setting">
      <span className="setting-label" id={`set-${label}`}>{label}</span>
      <div className="segmented" role="radiogroup" aria-labelledby={`set-${label}`}>
        {options.map((o) => (
          <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value}
            className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: {
  label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className="setting">
      <span>
        <span className="setting-label">{label}</span>
        {hint && <span className="setting-hint">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" className="switch" checked={checked}
        onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/** Mounts with the dialog, so it picks up a theme changed from the account menu meanwhile. */
function ThemeSetting() {
  const [theme, setTheme] = useState<ThemePreference>(readTheme);
  return (
    <Segmented label="Theme" value={theme} onChange={(t) => { setTheme(t); applyTheme(t); }}
      options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
  );
}

export default function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSettings();
  const set = <K extends keyof Settings>(key: K) => (value: Settings[K]) => updateSettings({ [key]: value });

  return (
    <Dialog open={open} onClose={onClose} title="Settings" className="settings-dialog">
      <p className="settings-note">Saved on this device.</p>
      <section className="settings-group">
        <h3>Appearance</h3>
        <ThemeSetting />
        <Segmented label="Font size" value={s.fontSize} onChange={set('fontSize')}
          options={[{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }]} />
        <Segmented label="Page width" value={s.width} onChange={set('width')}
          options={[{ value: 'narrow', label: 'Narrow' }, { value: 'normal', label: 'Normal' }, { value: 'wide', label: 'Wide' }, { value: 'full', label: 'Full' }]} />
      </section>
      <section className="settings-group">
        <h3>Code blocks</h3>
        <Segmented label="Color theme" value={s.codeTheme} onChange={set('codeTheme')}
          options={[{ value: 'vscode', label: 'VS Code' }, { value: 'github', label: 'GitHub' }, { value: 'one-dark', label: 'One Dark' }, { value: 'monokai', label: 'Monokai' }]} />
        <Segmented label="Tab size" value={s.tabSize} onChange={set('tabSize')}
          options={[{ value: 2, label: '2 spaces' }, { value: 4, label: '4 spaces' }]} />
        <Toggle label="Line numbers" hint="Default for blocks you haven’t changed" checked={s.lineNumbers} onChange={set('lineNumbers')} />
        <Toggle label="Word wrap" hint="Default for blocks you haven’t changed" checked={s.wordWrap} onChange={set('wordWrap')} />
      </section>
      <section className="settings-group">
        <h3>Editing</h3>
        <Toggle label="Spell check" checked={s.spellcheck} onChange={set('spellcheck')} />
      </section>
    </Dialog>
  );
}
