const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Renders a shortcut like "Mod+Shift+K" as "⌘⇧K" on macOS and "Ctrl+Shift+K" elsewhere. */
export function keys(combo: string): string {
  if (!isMac) return combo.replaceAll('Mod', 'Ctrl');
  return combo
    .replaceAll('Mod', '⌘').replaceAll('Shift', '⇧').replaceAll('Alt', '⌥').replaceAll('Ctrl', '⌃')
    .replaceAll('+', '');
}

export function isMod(e: KeyboardEvent | React.KeyboardEvent) {
  return isMac ? e.metaKey : e.ctrlKey;
}

export const SHORTCUTS: { group: string; items: [string, string][] }[] = [
  {
    group: 'General',
    items: [
      ['Command palette', 'Mod+P'],
      ['Search notes', 'Mod+K'],
      ['New note', 'Mod+Alt+N'],
      ['Toggle sidebar', 'Mod+\\'],
      ['Save now', 'Mod+S'],
      ['Settings', 'Mod+,'],
      ['Keyboard shortcuts', 'Mod+/'],
    ],
  },
  {
    group: 'Formatting',
    items: [
      ['Bold', 'Mod+B'],
      ['Italic', 'Mod+I'],
      ['Underline', 'Mod+U'],
      ['Strikethrough', 'Mod+Shift+S'],
      ['Inline code', 'Mod+E'],
      ['Highlight', 'Mod+Shift+H'],
      ['Undo / Redo', 'Mod+Z / Mod+Shift+Z'],
    ],
  },
  {
    group: 'Markdown',
    items: [
      ['Heading 1 – 3', '# / ## / ###'],
      ['Bullet list', '-  or  *'],
      ['Numbered list', '1.'],
      ['Checklist', '[ ]'],
      ['Quote', '>'],
      ['Code block', '```'],
      ['Insert any block', '/'],
      ['Divider', '---'],
    ],
  },
  {
    group: 'Code blocks',
    items: [
      ['Insert / toggle code block', 'Mod+` / Mod+Alt+C'],
      ['Indent / outdent', 'Tab / Shift+Tab'],
      ['Select all code in block', 'Mod+A'],
      ['Leave code block', 'Mod+Enter'],
    ],
  },
];
