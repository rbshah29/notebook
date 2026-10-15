'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, FileText, PanelLeftOpen, ChevronLeft, Pin, MoreHorizontal, Copy, Trash2, CloudOff,
  RotateCw, Save, Eraser,
} from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import {
  fetchNotes, createNote, deleteNote, toPlainText, SCRATCH_ID, type Note, type NotePatch,
} from '@/lib/notes';
import { usePersistentState } from '@/lib/usePersistentState';
import { isMod, keys } from '@/lib/shortcuts';
import Editor, { type EditorHandle } from '@/components/Editor';
import Sidebar, { type SortKey } from '@/components/Sidebar';
import ShortcutsDialog from '@/components/ShortcutsDialog';
import Menu from '@/components/ui/Menu';
import { useToast } from '@/components/ui/Toast';

/** Delay before a deleted note is actually removed, so "Undo" can bring it back. */
const UNDO_WINDOW = 6000;

const emptyScratch = (): Note => ({ id: SCRATCH_ID, title: '', content: null, updated_at: new Date().toISOString() });

// Plain text is derived from note content; cache per note object so search doesn't re-walk the
// JSON of every note on each render. A note object is replaced whenever it changes.
const textCache = new WeakMap<Note, string>();
function textOf(note: Note) {
  let text = textCache.get(note);
  if (text === undefined) {
    text = toPlainText(note.content);
    textCache.set(note, text);
  }
  return text;
}

function readHash() {
  return typeof window === 'undefined' ? null : decodeURIComponent(window.location.hash.slice(1)) || null;
}

export default function Workspace({ userId, name }: { userId: string; name: string }) {
  const toast = useToast();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(readHash);
  const [focusRequest, setFocusRequest] = useState<{ id: string; target: 'title' | 'end' } | null>(null);
  const [mobileView, setMobileView] = useState<'list' | 'note'>(() => (readHash() ? 'note' : 'list'));
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [scratch, setScratch] = useState<Note>(emptyScratch);
  // Bumped on "Clear" so the scratch editor remounts with empty content.
  const [scratchVersion, setScratchVersion] = useState(0);

  // Pins live on this device: the documents table has no column for them and the schema is untouched.
  const [pinnedList, setPinnedList] = usePersistentState<string[]>(`notebook:pinned:${userId}`, []);
  const [sort, setSort] = usePersistentState<SortKey>('notebook:sort', 'updated');
  const [collapsed, setCollapsed] = usePersistentState('notebook:sidebar-collapsed', false);

  const editorRef = useRef<EditorHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const creatingRef = useRef(false);
  const pendingDeletes = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const pinnedIds = useMemo(() => new Set(pinnedList), [pinnedList]);

  useEffect(() => {
    let cancelled = false;
    fetchNotes().then(({ data, error }) => {
      if (cancelled) return;
      if (error) return setLoadError(error.message);
      setNotes(data);
      // Keep the note from the URL if it exists; otherwise open the most recent one.
      setActiveId((cur) => (cur === SCRATCH_ID || (cur && data.some((n) => n.id === cur)) ? cur : data[0]?.id ?? null));
    });
    return () => { cancelled = true; };
  }, [reloadKey]);

  // Reflect the open note in the URL so reloads land on the same note.
  useEffect(() => {
    if (!notes) return;
    const url = activeId && activeId !== SCRATCH_ID ? `#${encodeURIComponent(activeId)}` : window.location.pathname + window.location.search;
    window.history.replaceState(null, '', url);
  }, [activeId, notes]);

  const { pinned, others } = useMemo(() => {
    const list = notes ?? [];
    const t = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matches = t.length
      ? list.filter((n) => {
          const hay = `${n.title}\n${textOf(n)}`.toLowerCase();
          return t.every((term) => hay.includes(term));
        })
      : list;
    const sorted = [...matches].sort(sort === 'title'
      ? (a, b) => (a.title.trim() || 'Untitled').localeCompare(b.title.trim() || 'Untitled', undefined, { sensitivity: 'base' })
      : (a, b) => b.updated_at.localeCompare(a.updated_at));
    return {
      pinned: sorted.filter((n) => pinnedIds.has(n.id)),
      others: sorted.filter((n) => !pinnedIds.has(n.id)),
    };
  }, [notes, query, sort, pinnedIds]);

  const isScratch = activeId === SCRATCH_ID;
  const active = isScratch ? scratch : notes?.find((n) => n.id === activeId) ?? null;

  const select = useCallback((id: string, focus?: 'title' | 'end') => {
    setActiveId(id);
    setMobileView('note');
    setFocusRequest(focus ? { id, target: focus } : null);
  }, []);

  const onNoteChange = useCallback((id: string, patch: NotePatch) => {
    if (id === SCRATCH_ID) return setScratch((n) => ({ ...n, ...patch }));
    setNotes((all) => all?.map((n) => (n.id === id ? { ...n, ...patch } : n)) ?? all);
  }, []);

  // Handlers read the latest values through a ref so they stay stable for the memoized list rows.
  const latest = useRef({ notes, activeId, order: [...pinned, ...others], pinnedIds });
  useEffect(() => {
    latest.current = { notes, activeId, order: [...pinned, ...others], pinnedIds };
  });

  /** The freshest copy of a note: the open editor may hold edits newer than list state. */
  const currentNote = useCallback((id: string): Note | undefined => {
    const note = latest.current.notes?.find((n) => n.id === id);
    if (!note || id !== latest.current.activeId || !editorRef.current) return note;
    return { ...note, ...editorRef.current.snapshot() };
  }, []);

  const newNote = useCallback(async () => {
    if (creatingRef.current) return;
    // Don't pile up blank notes: reuse the open one if nothing has been written in it yet.
    if (latest.current.activeId !== SCRATCH_ID && editorRef.current?.isBlank()) {
      setMobileView('note');
      editorRef.current.focus('title');
      return;
    }
    creatingRef.current = true;
    setCreating(true);
    const { data, error } = await createNote();
    creatingRef.current = false;
    setCreating(false);
    if (error) {
      toast({ tone: 'error', message: `Couldn't create a note. ${error.message}` });
      return;
    }
    setNotes((all) => [data, ...(all ?? [])]);
    setQuery('');
    select(data.id, 'title');
  }, [select, toast]);

  const togglePin = useCallback((id: string) => {
    setPinnedList((list) => (list.includes(id) ? list.filter((x) => x !== id) : [id, ...list]));
  }, [setPinnedList]);

  const duplicate = useCallback(async (id: string) => {
    const source = currentNote(id);
    if (!source) return;
    const title = source.title.trim() ? `${source.title.trim()} (copy)` : '';
    const { data, error } = await createNote({ title, content: source.content });
    if (error) {
      toast({ tone: 'error', message: `Couldn't duplicate the note. ${error.message}` });
      return;
    }
    setNotes((all) => [data, ...(all ?? [])]);
    select(data.id, 'title');
    toast({ tone: 'success', message: 'Note duplicated' });
  }, [currentNote, select, toast]);

  const commitDelete = useCallback(async (note: Note) => {
    pendingDeletes.current.delete(note.id);
    const { error } = await deleteNote(note.id);
    if (error) {
      setNotes((all) => (all ? [note, ...all] : all));
      toast({ tone: 'error', message: `Couldn't delete “${note.title || 'Untitled'}”. ${error.message}` });
    }
  }, [toast]);

  const remove = useCallback((id: string) => {
    const note = currentNote(id);
    if (!note) return;
    const { activeId: openId, order, pinnedIds: pins } = latest.current;

    if (id === openId) {
      // Move to the neighbour in the visible list, the way a mail client does.
      const i = order.findIndex((n) => n.id === id);
      const next = order[i + 1] ?? order[i - 1] ?? null;
      setActiveId(next?.id ?? null);
      if (!next) setMobileView('list');
    }
    // The editor unmounts with the note and flushes any pending save; the delete runs after it.
    setNotes((all) => all?.filter((n) => n.id !== id) ?? all);
    const wasPinned = pins.has(id);
    if (wasPinned) setPinnedList((list) => list.filter((x) => x !== id));

    pendingDeletes.current.set(id, setTimeout(() => commitDelete(note), UNDO_WINDOW));
    toast({
      message: `Deleted “${note.title.trim() || 'Untitled'}”`,
      duration: UNDO_WINDOW,
      action: {
        label: 'Undo',
        onClick: () => {
          clearTimeout(pendingDeletes.current.get(id));
          pendingDeletes.current.delete(id);
          setNotes((all) => (all ? [note, ...all] : all));
          if (wasPinned) setPinnedList((list) => [id, ...list]);
          select(id);
        },
      },
    });
  }, [currentNote, setPinnedList, commitDelete, select, toast]);

  const clearScratch = useCallback(() => {
    setScratch(emptyScratch());
    setScratchVersion((v) => v + 1);
    setFocusRequest({ id: SCRATCH_ID, target: 'end' });
  }, []);

  /** Promotes the scratchpad to a real, saved note and empties the scratchpad. */
  const saveScratch = useCallback(async () => {
    const draft = editorRef.current?.snapshot();
    if (!draft) return;
    const { data, error } = await createNote({ title: draft.title.trim(), content: draft.content });
    if (error) {
      toast({ tone: 'error', message: `Couldn't save the scratchpad. ${error.message}` });
      return;
    }
    setNotes((all) => [data, ...(all ?? [])]);
    setScratch(emptyScratch());
    setScratchVersion((v) => v + 1);
    select(data.id);
    toast({ tone: 'success', message: 'Saved as a note' });
  }, [select, toast]);

  // Deletes still inside their undo window are committed right away when leaving.
  const flushDeletes = useCallback(async () => {
    const ids = [...pendingDeletes.current.keys()];
    ids.forEach((id) => clearTimeout(pendingDeletes.current.get(id)));
    pendingDeletes.current.clear();
    await Promise.all(ids.map((id) => deleteNote(id)));
  }, []);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flushDeletes(); };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [flushDeletes]);

  const signOut = useCallback(async () => {
    // Pending writes must go out while the session is still valid.
    const saved = await editorRef.current?.flush();
    if (saved === false) {
      toast({ tone: 'error', message: 'Your latest changes haven’t saved yet. Check your connection and try again.' });
      return;
    }
    await flushDeletes();
    const { error } = await getSupabase().auth.signOut();
    if (error) toast({ tone: 'error', message: error.message });
  }, [flushDeletes, toast]);

  const focusSearch = useCallback(() => {
    setCollapsed(false);
    setMobileView('list');
    // The sidebar may be mid-transition from collapsed; wait a frame before focusing.
    requestAnimationFrame(() => { searchRef.current?.focus(); searchRef.current?.select(); });
  }, [setCollapsed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isMod(e)) return;
      if (e.code === 'KeyK' && !e.shiftKey && !e.altKey) { e.preventDefault(); focusSearch(); }
      else if (e.code === 'KeyN' && e.altKey) { e.preventDefault(); newNote(); }
      else if (e.code === 'Backslash') { e.preventDefault(); setCollapsed((c) => !c); }
      else if (e.code === 'KeyS' && !e.shiftKey) { e.preventDefault(); editorRef.current?.flush(); }
      else if (e.code === 'Slash') { e.preventDefault(); setShortcutsOpen((o) => !o); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusSearch, newNote, setCollapsed]);

  const loading = notes === null && !loadError;
  const isPinned = active ? pinnedIds.has(active.id) : false;
  const scratchHasContent = !!scratch.title.trim() || !!textOf(scratch);

  const leading = (
    <>
      <button className="icon-btn show-mobile" onClick={() => setMobileView('list')} aria-label="Back to notes">
        <ChevronLeft size={18} />
      </button>
      {collapsed && (
        <button className="icon-btn hide-mobile" onClick={() => setCollapsed(false)}
          aria-label="Show sidebar" title={`Show sidebar  ${keys('Mod+\\')}`}>
          <PanelLeftOpen size={16} />
        </button>
      )}
    </>
  );

  return (
    <div className={`app${collapsed ? ' sidebar-collapsed' : ''}`} data-view={mobileView}>
      <Sidebar
        name={name}
        loading={loading}
        totalCount={notes?.length ?? 0}
        pinned={pinned}
        others={others}
        activeId={activeId}
        scratchHasContent={scratchHasContent}
        onOpenScratch={() => select(SCRATCH_ID, 'end')}
        pinnedIds={pinnedIds}
        query={query}
        onQueryChange={setQuery}
        searchRef={searchRef}
        sort={sort}
        onSortChange={setSort}
        textOf={textOf}
        creating={creating}
        onSelect={select}
        onNew={newNote}
        onTogglePin={togglePin}
        onDuplicate={duplicate}
        onDelete={remove}
        onCollapse={() => setCollapsed(true)}
        onShowShortcuts={() => setShortcutsOpen(true)}
        onSignOut={signOut}
      />

      <main className="main">
        {loadError ? (
          <EmptyState icon={<CloudOff size={28} strokeWidth={1.5} />} title="Couldn’t load your notes"
            body={loadError} leading={leading}>
            <button className="btn" onClick={() => { setLoadError(null); setReloadKey((k) => k + 1); }}>
              <RotateCw size={15} /> Try again
            </button>
          </EmptyState>
        ) : loading ? (
          <div className="note-loading" aria-hidden>
            <span className="skeleton lg" style={{ width: '40%' }} />
            <span className="skeleton" style={{ width: '90%' }} />
            <span className="skeleton" style={{ width: '82%' }} />
            <span className="skeleton" style={{ width: '64%' }} />
          </div>
        ) : active ? (
          <Editor
            key={isScratch ? `${SCRATCH_ID}-${scratchVersion}` : active.id}
            ref={editorRef}
            note={active}
            scratch={isScratch}
            autoFocus={focusRequest?.id === active.id ? focusRequest.target : undefined}
            onChange={onNoteChange}
            leading={leading}
            actions={isScratch ? (
              <>
                <button className="btn btn-sm" onClick={saveScratch} disabled={!scratchHasContent}
                  title="Turn the scratchpad into a saved note">
                  <Save size={14} /> <span className="hide-narrow">Save as note</span>
                </button>
                <Menu label="More actions" items={[
                  { label: 'Clear scratchpad', icon: <Eraser size={15} />, danger: true, onSelect: clearScratch },
                ]}>
                  <MoreHorizontal size={16} />
                </Menu>
              </>
            ) : (
              <>
                <button className={`icon-btn${isPinned ? ' on' : ''}`} onClick={() => togglePin(active.id)}
                  aria-pressed={isPinned} aria-label={isPinned ? 'Unpin note' : 'Pin note'}
                  title={isPinned ? 'Unpin' : 'Pin to top'}>
                  <Pin size={16} />
                </button>
                <Menu label="More actions" items={[
                  { label: 'Duplicate', icon: <Copy size={15} />, onSelect: () => duplicate(active.id) },
                  { separator: true },
                  { label: 'Delete', icon: <Trash2 size={15} />, danger: true, onSelect: () => remove(active.id) },
                ]}>
                  <MoreHorizontal size={16} />
                </Menu>
              </>
            )}
          />
        ) : (
          <EmptyState icon={<FileText size={28} strokeWidth={1.5} />}
            title={notes?.length ? 'No note selected' : 'Your notebook is empty'}
            body={notes?.length
              ? 'Pick a note from the sidebar, or start a new one.'
              : 'Capture your first idea. Notes save automatically as you type.'}
            leading={leading}>
            <button className="btn btn-primary" onClick={newNote} disabled={creating}>
              <Plus size={15} /> New note
            </button>
            <p className="empty-hint">
              <kbd>{keys('Mod+Alt+N')}</kbd> new note · <kbd>{keys('Mod+K')}</kbd> search · <kbd>{keys('Mod+/')}</kbd> shortcuts
            </p>
          </EmptyState>
        )}
      </main>

      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}

function EmptyState({ icon, title, body, leading, children }: {
  icon: React.ReactNode; title: string; body: string; leading: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <div className="note">
      <header className="note-bar"><div className="note-bar-start">{leading}</div></header>
      <div className="empty">
        <div className="empty-icon">{icon}</div>
        <h1>{title}</h1>
        <p>{body}</p>
        {children}
      </div>
    </div>
  );
}
