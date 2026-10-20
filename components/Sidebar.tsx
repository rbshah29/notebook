'use client';
import { memo, useEffect, useState } from 'react';
import {
  Plus, Search, X, Pin, PinOff, Copy, Trash2, MoreHorizontal, PanelLeftClose, ArrowDownUp,
  LogOut, Keyboard, Sun, Moon, Monitor, SearchX, NotebookPen, Settings, Globe, Lock,
} from 'lucide-react';
import Menu from '@/components/ui/Menu';
import { formatRelative, formatFull, SCRATCH_ID, type Note } from '@/lib/notes';
import { keys } from '@/lib/shortcuts';
import { applyTheme, readTheme, type ThemePreference } from '@/lib/theme';

export type SortKey = 'updated' | 'title';

type Props = {
  name: string;
  loading: boolean;
  totalCount: number;
  pinned: Note[];
  others: Note[];
  activeId: string | null;
  scratchHasContent: boolean;
  onOpenScratch: () => void;
  pinnedIds: ReadonlySet<string>;
  query: string;
  onQueryChange: (q: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  sort: SortKey;
  onSortChange: (s: SortKey) => void;
  textOf: (note: Note) => string;
  creating: boolean;
  onSelect: (id: string, focus?: 'end') => void;
  onNew: () => void;
  onTogglePin: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onCollapse: () => void;
  onShowShortcuts: () => void;
  onShowSettings: () => void;
  onSignOut: () => void;
};

export default function Sidebar({
  name, loading, totalCount, pinned, others, activeId, scratchHasContent, onOpenScratch, pinnedIds, query, onQueryChange, searchRef,
  sort, onSortChange, textOf, creating, onSelect, onNew, onTogglePin, onDuplicate, onDelete,
  onCollapse, onShowShortcuts, onShowSettings, onSignOut,
}: Props) {
  const ordered = [...pinned, ...others];
  const searching = query.trim().length > 0;

  // Re-render relative timestamps once a minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (query) onQueryChange('');
      else e.currentTarget.blur();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
    if (!ordered.length) return;
    e.preventDefault();
    const i = ordered.findIndex((n) => n.id === activeId);
    if (e.key === 'Enter') return onSelect(ordered[Math.max(i, 0)].id, 'end');
    const next = e.key === 'ArrowDown' ? Math.min(i + 1, ordered.length - 1) : Math.max(i - 1, 0);
    onSelect(ordered[next].id);
  }

  function onListKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('.note-row'));
    const i = rows.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    rows[e.key === 'ArrowDown' ? Math.min(i + 1, rows.length - 1) : Math.max(i - 1, 0)]?.focus();
  }

  const rowProps = {
    activeId, now, query, pinnedIds, textOf, onSelect, onTogglePin, onDuplicate, onDelete,
  };

  return (
    <aside className="sidebar" aria-label="Notes">
      <div className="sidebar-head">
        <span className="brand">Notebook</span>
        <button className="icon-btn hide-mobile" onClick={onCollapse}
          aria-label="Hide sidebar" title={`Hide sidebar  ${keys('Mod+\\')}`}>
          <PanelLeftClose size={16} />
        </button>
        <button className="icon-btn" onClick={onNew} disabled={creating}
          aria-label="New note" title={`New note  ${keys('Mod+Alt+N')}`}>
          <Plus size={17} />
        </button>
      </div>

      <div className="search">
        <Search size={15} className="search-icon" aria-hidden />
        <input ref={searchRef} type="search" value={query} placeholder="Search"
          aria-label="Search notes" onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onSearchKeyDown} />
        {query ? (
          <button className="search-clear" aria-label="Clear search" onClick={() => {
            onQueryChange(''); searchRef.current?.focus();
          }}>
            <X size={14} />
          </button>
        ) : (
          <kbd className="search-kbd" aria-hidden>{keys('Mod+K')}</kbd>
        )}
      </div>

      <nav className="note-list" onKeyDown={onListKeyDown}>
        {!searching && (
          <div className={`note-item scratch-item${activeId === SCRATCH_ID ? ' active' : ''}`}>
            <button className="note-row scratch-row" onClick={onOpenScratch}
              aria-current={activeId === SCRATCH_ID ? 'page' : undefined}
              title="A temporary page. Nothing is saved; it clears when you refresh or close the tab.">
              <NotebookPen size={15} className="scratch-icon" aria-hidden />
              <span className="note-row-title">Scratchpad</span>
              <span className="scratch-tag">{scratchHasContent ? 'Unsaved' : 'Temporary'}</span>
            </button>
          </div>
        )}
        {loading ? (
          <ListSkeleton />
        ) : searching && !ordered.length ? (
          <div className="list-empty">
            <SearchX size={20} strokeWidth={1.5} />
            <p>No notes match “{query.trim()}”</p>
          </div>
        ) : !totalCount ? (
          <div className="list-empty">
            <p>No notes yet</p>
          </div>
        ) : (
          <>
            {pinned.length > 0 && (
              <Section label="Pinned">
                {pinned.map((n) => <NoteRow key={n.id} note={n} {...rowProps} />)}
              </Section>
            )}
            <Section
              label={searching ? `${ordered.length} ${ordered.length === 1 ? 'result' : 'results'}` : 'Notes'}
              action={!searching && (
                <Menu label="Sort notes" triggerClassName="section-action" align="end"
                  items={[
                    { heading: 'Sort by' },
                    { label: 'Last edited', checked: sort === 'updated', onSelect: () => onSortChange('updated') },
                    { label: 'Title', checked: sort === 'title', onSelect: () => onSortChange('title') },
                  ]}>
                  <ArrowDownUp size={13} /> {sort === 'updated' ? 'Last edited' : 'Title'}
                </Menu>
              )}>
              {others.map((n) => <NoteRow key={n.id} note={n} {...rowProps} />)}
            </Section>
          </>
        )}
      </nav>

      <AccountMenu name={name} onShowShortcuts={onShowShortcuts} onShowSettings={onShowSettings} onSignOut={onSignOut} />
    </aside>
  );
}

function Section({ label, action, children }: {
  label: string; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="list-section">
      <div className="section-head">
        <h2 className="section-label">{label}</h2>
        {action}
      </div>
      <ul role="list">{children}</ul>
    </section>
  );
}

type RowProps = {
  note: Note;
  activeId: string | null;
  now: number;
  query: string;
  pinnedIds: ReadonlySet<string>;
  textOf: (note: Note) => string;
  onSelect: (id: string) => void;
  onTogglePin: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
};

const NoteRow = memo(function NoteRow({
  note, activeId, now, query, pinnedIds, textOf, onSelect, onTogglePin, onDuplicate, onDelete,
}: RowProps) {
  const active = note.id === activeId;
  const pinned = pinnedIds.has(note.id);
  const text = textOf(note);
  const preview = note.is_locked ? 'Locked' : excerpt(text, query) || 'No additional text';

  return (
    <li className={`note-item${active ? ' active' : ''}`}>
      <button className="note-row" onClick={() => onSelect(note.id)}
        aria-current={active ? 'page' : undefined}>
        <span className="note-row-title">
          {note.is_locked && <Lock size={12} className="locked-icon" aria-label="Locked" />}
          {note.share_token && <Globe size={12} className="shared-icon" aria-label="Shared publicly" />}
          <Highlight text={note.title.trim() || 'Untitled'} query={query} />
        </span>
        <span className="note-row-sub">
          <time dateTime={note.updated_at} title={formatFull(note.updated_at)}>
            {formatRelative(note.updated_at, now)}
          </time>
          <span className="note-row-preview"><Highlight text={preview} query={query} /></span>
        </span>
      </button>
      <div className="note-row-actions">
        <Menu label="Note actions" triggerClassName="icon-btn sm"
          items={[
            { label: pinned ? 'Unpin' : 'Pin to top', icon: pinned ? <PinOff size={15} /> : <Pin size={15} />, onSelect: () => onTogglePin(note.id) },
            ...(note.is_locked ? [] : [{ label: 'Duplicate', icon: <Copy size={15} />, onSelect: () => onDuplicate(note.id) }]),
            { separator: true },
            { label: note.is_locked ? 'Delete…' : 'Delete', icon: <Trash2 size={15} />, danger: true, onSelect: () => onDelete(note.id) },
          ]}>
          <MoreHorizontal size={15} />
        </Menu>
      </div>
    </li>
  );
});

function terms(query: string) {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** A one-line preview; when searching, centred on the first match so you can see why it matched. */
function excerpt(text: string, query: string) {
  const flat = text.replace(/\s+/g, ' ').trim();
  const [first] = terms(query);
  const at = first ? flat.toLowerCase().indexOf(first) : -1;
  if (at <= 24) return flat.slice(0, 140);
  return '…' + flat.slice(at - 20, at + 120);
}

function Highlight({ text, query }: { text: string; query: string }) {
  const t = terms(query);
  if (!t.length) return <>{text}</>;
  const re = new RegExp(`(${t.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return <>{text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))}</>;
}

function ListSkeleton() {
  return (
    <div className="list-skeleton" aria-busy="true" aria-label="Loading notes">
      {[72, 54, 64, 46, 58].map((w, i) => (
        <div key={i} className="skeleton-row">
          <span className="skeleton" style={{ width: `${w}%` }} />
          <span className="skeleton sm" style={{ width: `${w + 20}%` }} />
        </div>
      ))}
    </div>
  );
}

function AccountMenu({ name, onShowShortcuts, onShowSettings, onSignOut }: {
  name: string; onShowShortcuts: () => void; onShowSettings: () => void; onSignOut: () => void;
}) {
  const [theme, setTheme] = useState<ThemePreference>(readTheme);
  const choose = (t: ThemePreference) => { setTheme(t); applyTheme(t); };

  return (
    <div className="sidebar-foot">
      <Menu label="Account and settings" triggerClassName="account" align="start" side="top"
        items={[
          { heading: 'Appearance' },
          { label: 'System', icon: <Monitor size={15} />, checked: theme === 'system', onSelect: () => choose('system') },
          { label: 'Light', icon: <Sun size={15} />, checked: theme === 'light', onSelect: () => choose('light') },
          { label: 'Dark', icon: <Moon size={15} />, checked: theme === 'dark', onSelect: () => choose('dark') },
          { separator: true },
          { label: 'Settings', icon: <Settings size={15} />, hint: keys('Mod+,'), onSelect: onShowSettings },
          { label: 'Keyboard shortcuts', icon: <Keyboard size={15} />, hint: keys('Mod+/'), onSelect: onShowShortcuts },
          { label: 'Sign out', icon: <LogOut size={15} />, onSelect: onSignOut },
        ]}>
        <span className="avatar" aria-hidden>{(name[0] ?? '?').toUpperCase()}</span>
        <span className="account-email">{name}</span>
      </Menu>
    </div>
  );
}
