'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, FileText, PanelLeftOpen, ChevronLeft, Pin, MoreHorizontal, Copy, Trash2, CloudOff,
  RotateCw, Save, Eraser, Share2, FileDown, ClipboardCopy, Printer, Settings as SettingsIcon, Keyboard,
  PanelLeft, Sun, Moon, LogOut, NotebookPen, Search, PinOff, Lock, LockOpen,
} from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import {
  fetchNotes, createNote, deleteNote, updateNote, toPlainText, SCRATCH_ID, type Note, type NotePatch,
} from '@/lib/notes';
import {
  lockNote, unlockNote, saveLockedNote, removeNoteLock, deleteLockedNote, lockErrorMessage,
} from '@/lib/locks';
import { usePersistentState } from '@/lib/usePersistentState';
import { isMod, keys } from '@/lib/shortcuts';
import Editor, { type EditorHandle, type SaveFn } from '@/components/Editor';
import { LockScreen, PinDialog } from '@/components/Lock';
import Sidebar, { type SortKey } from '@/components/Sidebar';
import ShortcutsDialog from '@/components/ShortcutsDialog';
import SettingsDialog from '@/components/SettingsDialog';
import ShareDialog from '@/components/ShareDialog';
import CommandPalette, { type Command } from '@/components/CommandPalette';
import { useSettings, settingsStyle } from '@/lib/settings';
import { toMarkdown, downloadFile, fileName } from '@/lib/markdown';
import { applyTheme } from '@/lib/theme';
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // The one locked note currently open with its PIN. It locks again as soon as you leave it.
  const [unlocked, setUnlocked] = useState<{ id: string; pin: string; content: Note['content'] } | null>(null);
  const [pinPrompt, setPinPrompt] = useState<{ kind: 'lock' | 'remove' | 'delete'; id: string } | null>(null);
  const settings = useSettings();
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

  const searchTerms = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query]);

  const isScratch = activeId === SCRATCH_ID;
  const active = isScratch ? scratch : notes?.find((n) => n.id === activeId) ?? null;

  const select = useCallback((id: string, focus?: 'title' | 'end') => {
    setActiveId(id);
    setUnlocked((u) => (u?.id === id ? u : null));
    setMobileView('note');
    setFocusRequest(focus ? { id, target: focus } : null);
  }, []);

  const onNoteChange = useCallback((id: string, patch: NotePatch) => {
    if (id === SCRATCH_ID) return setScratch((n) => ({ ...n, ...patch }));
    // A locked note's content never goes into the list, so it can't show up in previews or search.
    const { content, ...rest } = patch;
    setNotes((all) => all?.map((n) => (n.id === id ? { ...n, ...(n.is_locked ? rest : patch) } : n)) ?? all);
    if (content !== undefined) setUnlocked((u) => (u?.id === id ? { ...u, content } : u));
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
    if (note.is_locked) return setPinPrompt({ kind: 'delete', id });
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

  const onShared = useCallback((id: string, token: string | null) => {
    setNotes((all) => all?.map((n) => (n.id === id ? { ...n, share_token: token } : n)) ?? all);
    if (token) {
      navigator.clipboard.writeText(`${window.location.origin}/share#${token}`).then(
        () => toast({ tone: 'success', message: 'Link created and copied' }), () => {});
    } else toast({ message: 'Sharing turned off. The old link no longer works.' });
  }, [toast]);

  /** Moves to the neighbouring note in the list, as after a delete. */
  const leaveNote = useCallback((id: string) => {
    const { activeId: openId, order } = latest.current;
    if (id !== openId) return;
    const i = order.findIndex((n) => n.id === id);
    const next = order[i + 1] ?? order[i - 1] ?? null;
    setActiveId(next?.id ?? null);
    if (!next) setMobileView('list');
  }, []);

  const unlock = useCallback(async (id: string, pin: string) => {
    const r = await unlockNote(id, pin);
    if (!r.ok) return lockErrorMessage(r);
    setUnlocked({ id, pin, content: r.content ?? null });
    setFocusRequest({ id, target: 'end' });
    return null;
  }, []);

  const lockNow = useCallback(async () => {
    await editorRef.current?.flush();
    setUnlocked(null);
  }, []);

  /** Runs the action the PIN dialog was opened for. Resolves to an error message, or null when done. */
  const submitPin = useCallback(async (pin: string): Promise<string | null> => {
    if (!pinPrompt) return null;
    const { kind, id } = pinPrompt;
    const isOpen = latest.current.activeId === id;
    // Unsaved edits must land (through the right save path) before the lock changes.
    if (isOpen && editorRef.current && !(await editorRef.current.flush())) {
      return 'Your latest changes haven’t saved yet. Check your connection and try again.';
    }

    if (kind === 'lock') {
      // The editor always holds the note as JSON, whatever format it was stored in.
      if (!isOpen || !editorRef.current) return 'Open the note to lock it.';
      const { content } = editorRef.current.snapshot();
      const r = await lockNote(id, pin, content);
      if (!r.ok) return lockErrorMessage(r);
      setNotes((all) => all?.map((n) => (n.id === id ? { ...n, content: null, is_locked: true, share_token: null } : n)) ?? all);
      if (isOpen) setUnlocked({ id, pin, content });
      toast({ tone: 'success', message: isOpen ? 'Note locked. It locks again when you leave it.' : 'Note locked' });
    } else if (kind === 'remove') {
      const r = await removeNoteLock(id, pin);
      if (!r.ok) return lockErrorMessage(r);
      setNotes((all) => all?.map((n) => (n.id === id ? { ...n, content: r.content ?? null, is_locked: false } : n)) ?? all);
      setUnlocked((u) => (u?.id === id ? null : u));
      toast({ tone: 'success', message: 'Lock removed' });
    } else {
      const r = await deleteLockedNote(id, pin);
      if (!r.ok) return lockErrorMessage(r);
      const title = latest.current.notes?.find((n) => n.id === id)?.title.trim() || 'Untitled';
      leaveNote(id);
      setUnlocked((u) => (u?.id === id ? null : u));
      setNotes((all) => all?.filter((n) => n.id !== id) ?? all);
      setPinnedList((list) => list.filter((x) => x !== id));
      toast({ message: `Deleted “${title}”` });
    }
    setPinPrompt(null);
    return null;
  }, [pinPrompt, leaveNote, setPinnedList, toast]);

  /** The open note (or scratchpad) including edits that haven't saved yet. */
  const openNoteSnapshot = useCallback((): Pick<Note, 'title' | 'content'> | null => {
    const { activeId: id } = latest.current;
    if (!id || !editorRef.current) return null;
    return editorRef.current.snapshot();
  }, []);

  const copyMarkdown = useCallback(() => {
    const note = openNoteSnapshot();
    if (!note) return;
    navigator.clipboard.writeText(toMarkdown(note.title, note.content)).then(
      () => toast({ tone: 'success', message: 'Copied as Markdown' }),
      () => toast({ tone: 'error', message: 'Couldn’t access the clipboard' }));
  }, [openNoteSnapshot, toast]);

  const downloadMarkdown = useCallback(() => {
    const note = openNoteSnapshot();
    if (note) downloadFile(fileName(note.title, 'md'), toMarkdown(note.title, note.content));
  }, [openNoteSnapshot]);

  /** Uses the browser's print dialog, where "Save as PDF" is a destination. */
  const exportPdf = useCallback(() => {
    const note = openNoteSnapshot();
    if (!note) return;
    const previous = document.title;
    document.title = note.title.trim() || 'Untitled'; // becomes the suggested PDF file name
    window.addEventListener('afterprint', () => { document.title = previous; }, { once: true });
    window.print();
  }, [openNoteSnapshot]);

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

  const saveNow = useCallback(async () => {
    if (latest.current.activeId === SCRATCH_ID) {
      toast({ message: 'The scratchpad is temporary and isn’t saved' });
      return;
    }
    if (!editorRef.current) return;
    if (await editorRef.current.flush()) toast({ tone: 'success', message: 'Saved' });
    else toast({ tone: 'error', message: 'Couldn’t save. Your changes are kept and will retry.' });
  }, [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isMod(e)) return;
      if (e.code === 'KeyK' && !e.shiftKey && !e.altKey) { e.preventDefault(); focusSearch(); }
      else if (e.code === 'KeyN' && e.altKey) { e.preventDefault(); newNote(); }
      else if (e.code === 'Backslash') { e.preventDefault(); setCollapsed((c) => !c); }
      else if (e.code === 'KeyS' && !e.shiftKey) { e.preventDefault(); saveNow(); }
      else if (e.code === 'Slash') { e.preventDefault(); setShortcutsOpen((o) => !o); }
      else if (e.code === 'KeyP' && !e.shiftKey && !e.altKey) { e.preventDefault(); setPaletteOpen((o) => !o); }
      else if (e.code === 'Comma') { e.preventDefault(); setSettingsOpen((o) => !o); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusSearch, newNote, setCollapsed, saveNow]);

  const isPinned = active ? pinnedIds.has(active.id) : false;
  const isLocked = !isScratch && !!active?.is_locked;
  const openUnlocked = isLocked && unlocked?.id === active?.id ? unlocked : null;
  const showLockScreen = isLocked && !openUnlocked;
  const unlockedPin = openUnlocked?.pin;

  // Locked notes save their content through the PIN-checked function; the title saves normally.
  const lockedSave = useMemo((): SaveFn | undefined => {
    if (!unlockedPin) return undefined;
    return async (id, patch) => {
      const { content, ...rest } = patch;
      if (content !== undefined) {
        const r = await saveLockedNote(id, unlockedPin, content);
        if (!r.ok) return { error: lockErrorMessage(r) };
      }
      if (rest.title === undefined) return { error: null }; // updated_at is set by save_locked_note
      return updateNote(id, rest);
    };
  }, [unlockedPin]);

  // Unavailable actions are `false`; the palette skips them.
  const commands = useMemo((): (Command | false)[] => {
    const note = active && !isScratch ? active : null;
    return [
      { id: 'new', label: 'New note', icon: <Plus size={15} />, hint: keys('Mod+Alt+N'), keywords: 'create add', run: newNote },
      { id: 'search', label: 'Search notes', icon: <Search size={15} />, hint: keys('Mod+K'), keywords: 'find', run: focusSearch },
      { id: 'scratch', label: 'Open scratchpad', icon: <NotebookPen size={15} />, keywords: 'temporary draft', run: () => select(SCRATCH_ID, 'end') },
      !!note && !isLocked && { id: 'share', label: 'Share note…', icon: <Share2 size={15} />, keywords: 'public link publish', run: () => setShareOpen(true) },
      !!note && !isLocked && { id: 'lock', label: 'Lock note with PIN…', icon: <Lock size={15} />, keywords: 'pin password protect private', run: () => setPinPrompt({ kind: 'lock', id: note.id }) },
      !!note && !!openUnlocked && { id: 'lock-now', label: 'Lock note now', icon: <Lock size={15} />, keywords: 'pin close hide', run: lockNow },
      !!note && !!openUnlocked && { id: 'remove-lock', label: 'Remove lock…', icon: <LockOpen size={15} />, keywords: 'pin unlock password', run: () => setPinPrompt({ kind: 'remove', id: note.id }) },
      !!note && { id: 'pin', label: isPinned ? 'Unpin note' : 'Pin note', icon: isPinned ? <PinOff size={15} /> : <Pin size={15} />, run: () => togglePin(note.id) },
      !!note && !isLocked && { id: 'duplicate', label: 'Duplicate note', icon: <Copy size={15} />, keywords: 'copy', run: () => duplicate(note.id) },
      !!active && !showLockScreen && { id: 'copy-md', label: 'Copy as Markdown', icon: <ClipboardCopy size={15} />, keywords: 'export clipboard', run: copyMarkdown },
      !!active && !showLockScreen && { id: 'download-md', label: 'Download as Markdown', icon: <FileDown size={15} />, keywords: 'export save md file', run: downloadMarkdown },
      !!active && !showLockScreen && { id: 'pdf', label: 'Export as PDF', icon: <Printer size={15} />, keywords: 'print save', run: exportPdf },
      !!note && { id: 'delete', label: 'Delete note', icon: <Trash2 size={15} />, keywords: 'remove trash', run: () => remove(note.id) },
      { id: 'sidebar', label: 'Toggle sidebar', icon: <PanelLeft size={15} />, hint: keys('Mod+\\'), run: () => setCollapsed((c) => !c) },
      { id: 'light', label: 'Switch to light theme', icon: <Sun size={15} />, keywords: 'appearance mode', run: () => applyTheme('light') },
      { id: 'dark', label: 'Switch to dark theme', icon: <Moon size={15} />, keywords: 'appearance mode', run: () => applyTheme('dark') },
      { id: 'settings', label: 'Settings', icon: <SettingsIcon size={15} />, hint: keys('Mod+,'), keywords: 'preferences font width code theme tab', run: () => setSettingsOpen(true) },
      { id: 'shortcuts', label: 'Keyboard shortcuts', icon: <Keyboard size={15} />, hint: keys('Mod+/'), keywords: 'keys help', run: () => setShortcutsOpen(true) },
      { id: 'signout', label: 'Sign out', icon: <LogOut size={15} />, keywords: 'log out', run: signOut },
    ];
  }, [active, isScratch, isPinned, isLocked, openUnlocked, showLockScreen, lockNow, newNote, focusSearch, select, togglePin, duplicate, remove, copyMarkdown, downloadMarkdown, exportPdf, setCollapsed, signOut]);

  const exportItems = [
    { label: 'Copy as Markdown', icon: <ClipboardCopy size={15} />, onSelect: copyMarkdown },
    { label: 'Download as Markdown', icon: <FileDown size={15} />, onSelect: downloadMarkdown },
    { label: 'Export as PDF', icon: <Printer size={15} />, onSelect: exportPdf },
  ];

  const loading = notes === null && !loadError;
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
    <div className={`app${collapsed ? ' sidebar-collapsed' : ''}`} data-view={mobileView}
      data-code-theme={settings.codeTheme} style={settingsStyle(settings)}>
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
        onShowSettings={() => setSettingsOpen(true)}
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
        ) : active && showLockScreen ? (
          <LockScreen key={active.id} title={active.title} leading={leading}
            onUnlock={(pin) => unlock(active.id, pin)}
            actions={(
              <>
                <button className={`icon-btn${isPinned ? ' on' : ''}`} onClick={() => togglePin(active.id)}
                  aria-pressed={isPinned} aria-label={isPinned ? 'Unpin note' : 'Pin note'}
                  title={isPinned ? 'Unpin' : 'Pin to top'}>
                  <Pin size={16} />
                </button>
                <Menu label="More actions" items={[
                  { label: 'Delete…', icon: <Trash2 size={15} />, danger: true, onSelect: () => remove(active.id) },
                ]}>
                  <MoreHorizontal size={16} />
                </Menu>
              </>
            )} />
        ) : active ? (
          <Editor
            key={isScratch ? `${SCRATCH_ID}-${scratchVersion}` : active.id}
            ref={editorRef}
            note={openUnlocked ? { ...active, content: openUnlocked.content } : active}
            save={lockedSave}
            scratch={isScratch}
            autoFocus={focusRequest?.id === active.id ? focusRequest.target : undefined}
            onChange={onNoteChange}
            searchTerms={searchTerms}
            leading={leading}
            actions={isScratch ? (
              <>
                <button className="btn btn-sm" onClick={saveScratch} disabled={!scratchHasContent}
                  title="Turn the scratchpad into a saved note">
                  <Save size={14} /> <span className="hide-narrow">Save as note</span>
                </button>
                <Menu label="More actions" items={[
                  ...exportItems,
                  { separator: true },
                  { label: 'Clear scratchpad', icon: <Eraser size={15} />, danger: true, onSelect: clearScratch },
                ]}>
                  <MoreHorizontal size={16} />
                </Menu>
              </>
            ) : (
              <>
                {isLocked ? (
                  <button className="icon-btn on" onClick={lockNow} aria-label="Lock note now" title="Lock now">
                    <Lock size={16} />
                  </button>
                ) : (
                  <button className={`icon-btn${active.share_token ? ' on' : ''}`} onClick={() => setShareOpen(true)}
                    aria-label={active.share_token ? 'Shared publicly. Manage link' : 'Share note'}
                    title={active.share_token ? 'Shared publicly' : 'Share'}>
                    <Share2 size={16} />
                  </button>
                )}
                <button className={`icon-btn${isPinned ? ' on' : ''}`} onClick={() => togglePin(active.id)}
                  aria-pressed={isPinned} aria-label={isPinned ? 'Unpin note' : 'Pin note'}
                  title={isPinned ? 'Unpin' : 'Pin to top'}>
                  <Pin size={16} />
                </button>
                <Menu label="More actions" items={isLocked ? [
                  { label: 'Lock now', icon: <Lock size={15} />, onSelect: lockNow },
                  { label: 'Remove lock…', icon: <LockOpen size={15} />, onSelect: () => setPinPrompt({ kind: 'remove', id: active.id }) },
                  { separator: true },
                  ...exportItems,
                  { separator: true },
                  { label: 'Delete…', icon: <Trash2 size={15} />, danger: true, onSelect: () => remove(active.id) },
                ] : [
                  { label: 'Share…', icon: <Share2 size={15} />, onSelect: () => setShareOpen(true) },
                  { label: 'Lock with PIN…', icon: <Lock size={15} />, onSelect: () => setPinPrompt({ kind: 'lock', id: active.id }) },
                  ...exportItems,
                  { separator: true },
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
              <kbd>{keys('Mod+Alt+N')}</kbd> new note · <kbd>{keys('Mod+P')}</kbd> commands · <kbd>{keys('Mod+/')}</kbd> shortcuts
            </p>
          </EmptyState>
        )}
      </main>

      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ShareDialog open={shareOpen && !isLocked} onClose={() => setShareOpen(false)}
        note={active && !isScratch ? active : null} onShared={onShared} />
      <PinDialog open={!!pinPrompt} mode={pinPrompt?.kind === 'lock' ? 'set' : 'verify'}
        onClose={() => setPinPrompt(null)} onSubmit={submitPin} danger={pinPrompt?.kind === 'delete'}
        {...PIN_PROMPTS[pinPrompt?.kind ?? 'lock'](notes?.find((n) => n.id === pinPrompt?.id)?.title.trim() || 'Untitled')} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands}
        notes={notes ?? []} textOf={textOf} onOpenNote={(id) => select(id, 'end')} />
    </div>
  );
}

const PIN_PROMPTS = {
  lock: () => ({
    title: 'Lock note',
    submitLabel: 'Lock note',
    description: <>Choose a 4-digit PIN. You’ll need it to open or delete this note. If you forget it,
      the content can only be recovered from your Supabase dashboard.</>,
  }),
  remove: () => ({
    title: 'Remove lock',
    submitLabel: 'Remove lock',
    description: 'Enter the PIN to remove the lock. The note will open without a PIN again.',
  }),
  delete: (title: string) => ({
    title: 'Delete locked note',
    submitLabel: 'Delete note',
    description: <>Enter the PIN to delete “{title}”. This can’t be undone.</>,
  }),
};

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
