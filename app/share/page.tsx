'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useEditor, EditorContent } from '@tiptap/react';
import { Link2Off, FileDown, Printer } from 'lucide-react';
import { isSupabaseConfigured } from '@/lib/supabase';
import { fetchSharedNote, formatFull, type SharedNote } from '@/lib/notes';
import { useSettings, settingsStyle } from '@/lib/settings';
import { toMarkdown, downloadFile, fileName } from '@/lib/markdown';
import { buildExtensions } from '@/components/extensions';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type State = { status: 'loading' } | { status: 'missing' } | { status: 'error'; message: string } | { status: 'ready'; note: SharedNote };

/**
 * Read-only view of a shared note. The token is in the URL hash (/share#<token>), so it is never
 * sent to the server or logged; the page itself is static.
 */
export default function SharePage() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const settings = useSettings();

  useEffect(() => {
    const load = () => {
      const token = decodeURIComponent(window.location.hash.slice(1));
      if (!isSupabaseConfigured || !UUID.test(token)) return setState({ status: 'missing' });
      setState({ status: 'loading' });
      fetchSharedNote(token).then(({ data, error }) => {
        // PGRST202: the function doesn't exist yet (supabase/sharing-and-images.sql hasn't been run).
        if (error) setState({ status: 'error', message: error.code === 'PGRST202' ? 'Sharing isn’t set up on this server yet.' : error.message });
        else if (!data) setState({ status: 'missing' });
        else setState({ status: 'ready', note: data });
      });
    };
    load();
    window.addEventListener('hashchange', load);
    return () => window.removeEventListener('hashchange', load);
  }, []);

  useEffect(() => {
    if (state.status === 'ready') document.title = `${state.note.title.trim() || 'Untitled'} · Notebook`;
  }, [state]);

  return (
    <div className="share-page" data-code-theme={settings.codeTheme} style={settingsStyle(settings)}>
      <header className="share-bar">
        <Link className="share-brand" href="/">Notebook</Link>
        <span className="share-badge">Read only</span>
        {state.status === 'ready' && (
          <div className="share-bar-end">
            <button className="icon-btn" aria-label="Download as Markdown" title="Download as Markdown"
              onClick={() => downloadFile(fileName(state.note.title, 'md'), toMarkdown(state.note.title, state.note.content))}>
              <FileDown size={16} />
            </button>
            <button className="icon-btn" aria-label="Print or save as PDF" title="Print or save as PDF" onClick={() => window.print()}>
              <Printer size={16} />
            </button>
          </div>
        )}
      </header>
      {state.status === 'loading' ? (
        <div className="note-loading" aria-busy="true" aria-label="Loading">
          <span className="skeleton lg" style={{ width: '40%' }} />
          <span className="skeleton" style={{ width: '90%' }} />
          <span className="skeleton" style={{ width: '72%' }} />
        </div>
      ) : state.status === 'ready' ? (
        <SharedNoteView note={state.note} />
      ) : (
        <div className="empty">
          <div className="empty-icon"><Link2Off size={28} strokeWidth={1.5} /></div>
          <h1>{state.status === 'error' ? 'Couldn’t load this note' : 'This link doesn’t work'}</h1>
          <p>{state.status === 'error' ? state.message : 'The note may have been unshared or deleted, or the link was copied incompletely.'}</p>
        </div>
      )}
    </div>
  );
}

function SharedNoteView({ note }: { note: SharedNote }) {
  const editor = useEditor({
    extensions: buildExtensions({ editable: false }),
    content: note.content ?? '',
    editable: false,
    immediatelyRender: false,
    editorProps: { attributes: { 'aria-label': 'Note content', class: 'prose' } },
  }, [note]);

  return (
    <article className="note-body share-body">
      <h1 className="note-title">{note.title.trim() || 'Untitled'}</h1>
      <div className="note-meta">Last updated {formatFull(note.updated_at)}</div>
      <EditorContent editor={editor} className="note-content" />
    </article>
  );
}
