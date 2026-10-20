'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, FileText } from 'lucide-react';
import Dialog from '@/components/ui/Dialog';
import { formatRelative, type Note } from '@/lib/notes';

export type Command = {
  id: string;
  label: string;
  icon?: React.ReactNode;
  hint?: string;
  keywords?: string;
  run: () => void;
};

type Row = { kind: 'command'; command: Command } | { kind: 'note'; note: Note };

const MAX_NOTES = 8;

function score(hay: string, terms: string[]) {
  const h = hay.toLowerCase();
  if (!terms.every((t) => h.includes(t))) return -1;
  return h.startsWith(terms[0]) ? 0 : 1;
}

/** Ctrl+P: jump to any note or run any action by typing a few letters. */
export default function CommandPalette({ open, onClose, commands, notes, textOf, onOpenNote }: {
  open: boolean;
  onClose: () => void;
  commands: (Command | false)[];
  notes: Note[];
  textOf: (note: Note) => string;
  onOpenNote: (id: string) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Command palette" hideHeader className="palette">
      <PaletteBody onClose={onClose} commands={commands.filter((c): c is Command => !!c)} notes={notes} textOf={textOf} onOpenNote={onOpenNote} />
    </Dialog>
  );
}

function PaletteBody({ onClose, commands, notes, textOf, onOpenNote }: {
  onClose: () => void;
  commands: Command[];
  notes: Note[];
  textOf: (note: Note) => string;
  onOpenNote: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const { matchedCommands, matchedNotes } = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) {
      const recent = [...notes].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, MAX_NOTES);
      return { matchedCommands: commands, matchedNotes: recent };
    }
    const cmds = commands
      .map((c) => ({ c, s: score(`${c.label} ${c.keywords ?? ''}`, terms) }))
      .filter((x) => x.s >= 0).sort((a, b) => a.s - b.s).map((x) => x.c);
    const ns = notes
      .map((n) => {
        const title = score(n.title || 'Untitled', terms);
        // Title matches rank above notes that only match in their text.
        return { n, s: title >= 0 ? title : score(textOf(n), terms) >= 0 ? 2 : -1 };
      })
      .filter((x) => x.s >= 0).sort((a, b) => a.s - b.s).slice(0, MAX_NOTES).map((x) => x.n);
    return { matchedCommands: cmds, matchedNotes: ns };
  }, [query, commands, notes, textOf]);

  // With a query, notes are usually what you're after; without one, actions come first.
  const rows: Row[] = useMemo(() => {
    const c = matchedCommands.map((command): Row => ({ kind: 'command', command }));
    const n = matchedNotes.map((note): Row => ({ kind: 'note', note }));
    return query.trim() ? [...n, ...c] : [...c, ...n];
  }, [matchedCommands, matchedNotes, query]);

  const active = Math.min(index, Math.max(rows.length - 1, 0));

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function run(row: Row) {
    onClose();
    if (row.kind === 'note') onOpenNote(row.note.id);
    else row.command.run();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((active + 1) % Math.max(rows.length, 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((active - 1 + rows.length) % Math.max(rows.length, 1)); }
    else if (e.key === 'Enter' && rows[active]) { e.preventDefault(); run(rows[active]); }
  }

  let lastGroup = '';

  return (
    <div className="palette-inner" onKeyDown={onKeyDown}>
      <div className="palette-search">
        <Search size={16} aria-hidden />
        <input autoFocus value={query} placeholder="Search notes and actions…" aria-label="Search notes and actions"
          role="combobox" aria-expanded="true" aria-controls="palette-list"
          aria-activedescendant={rows[active] ? `palette-${active}` : undefined}
          onChange={(e) => { setQuery(e.target.value); setIndex(0); }} />
        <kbd>Esc</kbd>
      </div>
      <div className="palette-list" id="palette-list" role="listbox" ref={listRef}>
        {!rows.length && <div className="palette-empty">Nothing matches “{query.trim()}”</div>}
        {rows.map((row, i) => {
          const group = row.kind === 'note' ? (query.trim() ? 'Notes' : 'Recent notes') : 'Actions';
          const heading = group !== lastGroup ? group : null;
          lastGroup = group;
          return (
            <div key={row.kind === 'note' ? row.note.id : row.command.id}>
              {heading && <div className="palette-group">{heading}</div>}
              <div id={`palette-${i}`} role="option" aria-selected={i === active}
                className="palette-item" onMouseMove={() => i !== active && setIndex(i)} onClick={() => run(row)}>
                {row.kind === 'note' ? (
                  <>
                    <span className="palette-icon"><FileText size={15} /></span>
                    <span className="palette-label">{row.note.title.trim() || 'Untitled'}</span>
                    <span className="palette-hint">{formatRelative(row.note.updated_at)}</span>
                  </>
                ) : (
                  <>
                    <span className="palette-icon">{row.command.icon}</span>
                    <span className="palette-label">{row.command.label}</span>
                    {row.command.hint && <kbd className="palette-hint">{row.command.hint}</kbd>}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
