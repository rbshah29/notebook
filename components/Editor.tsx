'use client';
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { useEditor, useEditorState, EditorContent, type Editor as TiptapEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { NodeSelection } from '@tiptap/pm/state';
import { Bold, Italic, Underline, Strikethrough, Code, Highlighter, Link2 } from 'lucide-react';
import { updateNote, formatFull, type Note, type NotePatch } from '@/lib/notes';
import { keys } from '@/lib/shortcuts';
import { useSettings } from '@/lib/settings';
import Toolbar, { ToolButton, LinkForm } from './Toolbar';
import { refreshCodeBlocks } from './CodeBlock';
import { buildExtensions } from './extensions';
import { useToast } from './ui/Toast';

export type EditorHandle = {
  /** Persists pending changes immediately. Resolves false if the save failed. */
  flush: () => Promise<boolean>;
  focus: (target: 'title' | 'end') => void;
  isBlank: () => boolean;
  /** The current title and content, including edits not yet saved. */
  snapshot: () => Pick<Note, 'title' | 'content'>;
};

type SaveStatus = 'saved' | 'pending' | 'error';

type Props = {
  note: Note;
  autoFocus?: 'title' | 'end';
  /** In-memory only: changes go to onChange and are never written to Supabase. */
  scratch?: boolean;
  onChange: (id: string, patch: NotePatch) => void;
  leading?: React.ReactNode;
  actions?: React.ReactNode;
  /** Sidebar search terms to highlight in the note. */
  searchTerms?: string[];
  ref?: React.Ref<EditorHandle>;
};

const SAVE_DELAY = 800;

/**
 * Debounced, serialized autosave. Only one request is in flight at a time so updates can't land
 * out of order; failures keep the patch and retry with backoff.
 */
function useAutosave(noteId: string, onSaved: (patch: NotePatch) => void) {
  const [status, setStatus] = useState<SaveStatus>('saved');
  const pending = useRef<NotePatch>({});
  const inFlight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const failures = useRef(0);
  const onSavedRef = useRef(onSaved);
  const flushRef = useRef<() => Promise<boolean>>(async () => true);

  useEffect(() => { onSavedRef.current = onSaved; });

  const flush = useCallback(async (): Promise<boolean> => {
    clearTimeout(timer.current);
    while (inFlight.current) await inFlight.current;
    const patch = pending.current;
    if (!Object.keys(patch).length) return true;
    pending.current = {};
    setStatus('pending');

    const saved: NotePatch = { ...patch, updated_at: new Date().toISOString() };
    let ok = false;
    const request = updateNote(noteId, saved).then(({ error }) => {
      ok = !error;
      if (error) console.error('Save failed', error);
    }, (err) => console.error('Save failed', err));
    inFlight.current = request;
    await request;
    inFlight.current = null;

    if (ok) {
      failures.current = 0;
      onSavedRef.current(saved);
      if (!Object.keys(pending.current).length) setStatus('saved');
    } else {
      // Newer edits made during the request win over the failed patch.
      pending.current = { ...patch, ...pending.current };
      failures.current += 1;
      setStatus('error');
      const backoff = Math.min(30_000, 2000 * 2 ** (failures.current - 1));
      timer.current = setTimeout(() => flushRef.current(), backoff);
    }
    return ok;
  }, [noteId]);

  useEffect(() => { flushRef.current = flush; }, [flush]);

  const queue = useCallback((patch: NotePatch) => {
    pending.current = { ...pending.current, ...patch };
    setStatus((s) => (s === 'error' ? s : 'pending'));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flushRef.current(), SAVE_DELAY);
  }, []);

  useEffect(() => {
    const hasUnsaved = () => Object.keys(pending.current).length > 0 || inFlight.current !== null;
    const warn = (e: BeforeUnloadEvent) => {
      if (hasUnsaved()) e.preventDefault();
    };
    // Mobile browsers often skip beforeunload; saving when the tab is hidden is the reliable hook.
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    const onOnline = () => flush();
    window.addEventListener('beforeunload', warn);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('beforeunload', warn);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('online', onOnline);
      flush(); // switching notes or unmounting must never drop edits
    };
  }, [flush]);

  return { status, queue, flush };
}

const NO_TERMS: string[] = [];

export default function Editor({ note, autoFocus, scratch = false, onChange, leading, actions, searchTerms = NO_TERMS, ref }: Props) {
  const toast = useToast();
  const settings = useSettings();
  const [title, setTitle] = useState(note.title);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [editingLink, setEditingLink] = useState(false);

  const { status, flush, queue: queueSave } = useAutosave(note.id, (patch) => onChange(note.id, patch));
  const queue = useCallback((patch: NotePatch) => {
    if (scratch) onChange(note.id, patch);
    else queueSave(patch);
  }, [scratch, onChange, note.id, queueSave]);

  const editor = useEditor({
    extensions: buildExtensions({ editable: true, onError: (message) => toast({ tone: 'error', message }) }),
    content: note.content ?? '',
    immediatelyRender: false,
    editorProps: {
      attributes: { 'aria-label': 'Note content', class: 'prose', spellcheck: String(settings.spellcheck) },
      handleKeyDown: (view, event) => {
        // ArrowUp from the first line jumps back into the title, like one continuous document.
        if (event.key === 'ArrowUp' && view.state.selection.from <= 1 && view.state.selection.empty) {
          const el = titleRef.current;
          el?.focus();
          el?.setSelectionRange(el.value.length, el.value.length);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor, transaction }) => {
      // Plugins such as TrailingNode normalize a freshly loaded doc via appended transactions.
      // Those aren't edits, so don't save them (it would bump updated_at just by opening a note).
      if (!transaction.docChanged) return;
      queue({ content: editor.getJSON() });
    },
  });

  const focus = useCallback((target: 'title' | 'end') => {
    if (target === 'title') titleRef.current?.focus();
    else editor?.commands.focus('end');
  }, [editor]);

  useImperativeHandle(ref, () => ({
    flush,
    focus,
    isBlank: () => !titleRef.current?.value.trim() && (editor?.isEmpty ?? true),
    snapshot: () => ({
      title: titleRef.current?.value ?? note.title,
      content: editor ? editor.getJSON() : note.content,
    }),
  }), [flush, focus, editor, note.title, note.content]);

  // Auto-grow the title so long titles wrap instead of scrolling sideways.
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = '0';
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  // Settings that live inside the editor: spellcheck, and code blocks' default line numbers.
  useEffect(() => {
    if (!editor) return;
    editor.view.dom.setAttribute('spellcheck', String(settings.spellcheck));
  }, [editor, settings.spellcheck]);
  useEffect(() => {
    if (editor) refreshCodeBlocks(editor);
  }, [editor, settings.lineNumbers]);

  // Highlight search matches; when a note is opened from a search, scroll to the first one.
  const scrolledToMatch = useRef(false);
  useEffect(() => {
    if (!editor) return;
    editor.commands.setSearchTerms(searchTerms);
    if (!searchTerms.length || scrolledToMatch.current) return;
    scrolledToMatch.current = true;
    requestAnimationFrame(() => {
      editor.view.dom.querySelector('.search-match')?.scrollIntoView({ block: 'center' });
    });
  }, [editor, searchTerms]);

  const focusedOnce = useRef(false);
  useEffect(() => {
    if (!editor || !autoFocus || focusedOnce.current) return;
    focusedOnce.current = true;
    focus(autoFocus);
  }, [editor, autoFocus, focus]);

  function onTitleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    const atEnd = el.selectionStart === el.value.length;
    if (e.key === 'Enter' || (e.key === 'ArrowDown' && atEnd)) {
      e.preventDefault();
      editor?.commands.focus('start');
    }
  }

  return (
    <div className="note">
      <header className="note-bar">
        <div className="note-bar-start">{leading}</div>
        {editor && <Toolbar editor={editor} />}
        <div className="note-bar-end">
          {scratch ? (
            <span className="scratch-badge" title="Kept in this tab only. Cleared when you refresh or close the page.">
              Temporary · not saved
            </span>
          ) : (
            <SaveIndicator status={status} updatedAt={note.updated_at} onRetry={flush} />
          )}
          {actions}
        </div>
      </header>

      <div className="canvas" ref={setScrollEl}>
        <article className="note-body">
          <textarea ref={titleRef} className="note-title" rows={1} value={title}
            placeholder={scratch ? 'Scratchpad' : 'Untitled'} aria-label="Note title" spellCheck
            onChange={(e) => {
              const value = e.target.value.replace(/\n/g, ' ');
              setTitle(value);
              if (!scratch) onChange(note.id, { title: value }); // live in the sidebar, before the save lands
              queue({ title: value });
            }}
            onKeyDown={onTitleKeyDown} />
          {editor && (scratch
            ? <div className="note-meta">Scratch space for quick thoughts. Nothing here is saved; it disappears when you refresh or close the page.</div>
            : <NoteMeta editor={editor} updatedAt={note.updated_at} />)}
          <EditorContent editor={editor} className="note-content"
            onClick={(e) => {
              // Clicking the empty space below the last line should place the caret at the end.
              if (e.target === e.currentTarget) editor?.commands.focus('end');
            }} />
        </article>
      </div>

      {editor && scrollEl && (
        <BubbleMenu editor={editor}
          options={{ placement: 'top', offset: 8, scrollTarget: scrollEl, onHide: () => setEditingLink(false) }}
          shouldShow={({ editor: e, state, from, to, element }) => {
            const hasFocus = e.view.hasFocus() || element.contains(document.activeElement);
            return hasFocus && from !== to && !e.isActive('codeBlock') && !(state.selection instanceof NodeSelection);
          }}>
          <div className="bubble">
            {editingLink
              ? <LinkForm editor={editor} onDone={() => setEditingLink(false)} />
              : <BubbleMarks editor={editor} onLink={() => setEditingLink(true)} />}
          </div>
        </BubbleMenu>
      )}
    </div>
  );
}

function BubbleMarks({ editor, onLink }: { editor: TiptapEditor; onLink: () => void }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'), italic: e.isActive('italic'), underline: e.isActive('underline'),
      strike: e.isActive('strike'), code: e.isActive('code'), highlight: e.isActive('highlight'),
      link: e.isActive('link'),
    }),
  });
  const c = () => editor.chain().focus();
  return (
    <>
      <ToolButton label="Bold" shortcut={keys('Mod+B')} active={s.bold} onClick={() => c().toggleBold().run()}><Bold size={15} /></ToolButton>
      <ToolButton label="Italic" shortcut={keys('Mod+I')} active={s.italic} onClick={() => c().toggleItalic().run()}><Italic size={15} /></ToolButton>
      <ToolButton label="Underline" shortcut={keys('Mod+U')} active={s.underline} onClick={() => c().toggleUnderline().run()}><Underline size={15} /></ToolButton>
      <ToolButton label="Strikethrough" shortcut={keys('Mod+Shift+S')} active={s.strike} onClick={() => c().toggleStrike().run()}><Strikethrough size={15} /></ToolButton>
      <ToolButton label="Inline code" shortcut={keys('Mod+E')} active={s.code} onClick={() => c().toggleCode().run()}><Code size={15} /></ToolButton>
      <ToolButton label="Highlight" shortcut={keys('Mod+Shift+H')} active={s.highlight} onClick={() => c().toggleHighlight().run()}><Highlighter size={15} /></ToolButton>
      <span className="tb-sep" />
      <ToolButton label={s.link ? 'Edit link' : 'Add link'} active={s.link} onClick={onLink}><Link2 size={15} /></ToolButton>
    </>
  );
}

function NoteMeta({ editor, updatedAt }: { editor: TiptapEditor; updatedAt: string }) {
  const words = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const text = e.getText().trim();
      return text ? text.split(/\s+/).length : 0;
    },
  });
  const minutes = Math.max(1, Math.round(words / 230));
  return (
    <div className="note-meta">
      <span title={`Last edited ${formatFull(updatedAt)}`}>
        {new Date(updatedAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
      </span>
      <span aria-hidden>·</span>
      <span>{words} {words === 1 ? 'word' : 'words'}</span>
      {words > 0 && <><span aria-hidden>·</span><span>{minutes} min read</span></>}
    </div>
  );
}

function SaveIndicator({ status, updatedAt, onRetry }: {
  status: SaveStatus; updatedAt: string; onRetry: () => void;
}) {
  if (status === 'error') {
    return (
      <button className="save-status error" onClick={onRetry} title="Your changes are kept locally. Click to retry now.">
        <span className="dot" /> Not saved · Retry
      </button>
    );
  }
  return (
    <span className={`save-status ${status}`} role="status"
      title={status === 'saved' ? `Saved ${formatFull(updatedAt)}` : undefined}>
      <span className="dot" />
      {status === 'saved' ? 'Saved' : 'Saving…'}
    </span>
  );
}
