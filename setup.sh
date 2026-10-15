#!/usr/bin/env bash
set -e

echo "Installing packages..."
npm install @supabase/supabase-js @tiptap/react @tiptap/pm @tiptap/starter-kit

mkdir -p lib components app

echo "Writing .env.local..."
cat > .env.local <<'EOF'
NEXT_PUBLIC_SUPABASE_URL=https://snfsjxkipvzazqymxrpa.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=PASTE_YOUR_PUBLISHABLE_KEY_HERE
EOF

echo "Writing lib/supabase.ts..."
cat > lib/supabase.ts <<'EOF'
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
EOF

echo "Writing app/page.tsx..."
cat > app/page.tsx <<'EOF'
'use client';
import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import Login from '@/components/Login';
import Workspace from '@/components/Workspace';

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (loading) return null;
  return session ? <Workspace /> : <Login />;
}
EOF

echo "Writing components/Login.tsx..."
cat > components/Login.tsx <<'EOF'
'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
  }

  return (
    <form className="login" onSubmit={signIn}>
      <h1>My Editor</h1>
      <input type="email" placeholder="Email" value={email}
        onChange={(e) => setEmail(e.target.value)} required />
      <input type="password" placeholder="Password" value={password}
        onChange={(e) => setPassword(e.target.value)} required />
      <button type="submit">Sign in</button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
EOF

echo "Writing components/Workspace.tsx..."
cat > components/Workspace.tsx <<'EOF'
'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Editor from '@/components/Editor';

export type Doc = {
  id: string;
  title: string;
  content: any;
  updated_at: string;
};

export default function Workspace() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('documents')
        .select('id, title, content, updated_at')
        .order('updated_at', { ascending: false });
      if (error) return alert(error.message);
      setDocs(data);
      if (data.length) setActiveId(data[0].id);
    })();
  }, []);

  async function newDoc() {
    const { data, error } = await supabase
      .from('documents')
      .insert({ title: 'Untitled' })
      .select()
      .single();
    if (error) return alert(error.message);
    setDocs((d) => [data, ...d]);
    setActiveId(data.id);
  }

  async function deleteDoc(id: string) {
    if (!confirm('Delete this document?')) return;
    const { error } = await supabase.from('documents').delete().eq('id', id);
    if (error) return alert(error.message);
    const remaining = docs.filter((x) => x.id !== id);
    setDocs(remaining);
    if (activeId === id) setActiveId(remaining[0]?.id ?? null);
  }

  function updateLocal(id: string, patch: Partial<Doc>) {
    setDocs((d) => d.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  const active = docs.find((d) => d.id === activeId);

  return (
    <div className="app">
      <aside className="sidebar">
        <button className="new" onClick={newDoc}>+ New document</button>
        <ul>
          {docs.map((d) => (
            <li key={d.id}
              className={d.id === activeId ? 'selected' : ''}
              onClick={() => setActiveId(d.id)}>
              <span>{d.title || 'Untitled'}</span>
              <button className="delete"
                onClick={(e) => { e.stopPropagation(); deleteDoc(d.id); }}>×</button>
            </li>
          ))}
        </ul>
        <button className="signout" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </aside>
      <main>
        {active ? (
          <Editor key={active.id} doc={active}
            onChange={(patch) => updateLocal(active.id, patch)} />
        ) : (
          <p className="empty">Create a document to get started.</p>
        )}
      </main>
    </div>
  );
}
EOF

echo "Writing components/Editor.tsx..."
cat > components/Editor.tsx <<'EOF'
'use client';
import { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { supabase } from '@/lib/supabase';
import type { Doc } from './Workspace';

type Props = { doc: Doc; onChange: (patch: Partial<Doc>) => void };

export default function Editor({ doc, onChange }: Props) {
  const [title, setTitle] = useState(doc.title);
  const [status, setStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const pending = useRef<Partial<Doc>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Send any pending changes to Supabase
  async function flush() {
    clearTimeout(timer.current);
    const patch = pending.current;
    if (!Object.keys(patch).length) return;
    pending.current = {};
    setStatus('saving');
    const updated_at = new Date().toISOString();
    const { error } = await supabase
      .from('documents')
      .update({ ...patch, updated_at })
      .eq('id', doc.id);
    if (error) {
      console.error(error);
      pending.current = { ...patch, ...pending.current }; // retry on next save
      setStatus('unsaved');
    } else {
      setStatus('saved');
    }
  }

  // Queue a change and save 1 second after typing stops
  function queue(patch: Partial<Doc>) {
    pending.current = { ...pending.current, ...patch };
    onChange(patch);
    setStatus('unsaved');
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 1000);
  }

  const editor = useEditor({
    extensions: [StarterKit],
    content: doc.content ?? '',
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    onUpdate: ({ editor }) => queue({ content: editor.getJSON() }),
  });

  // Save when switching documents; warn before closing the tab with unsaved changes
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (Object.keys(pending.current).length) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      flush();
    };
  }, []);

  if (!editor) return null;

  const btn = (label: string, action: () => boolean, active = false) => (
    <button className={active ? 'active' : ''}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => action()}>
      {label}
    </button>
  );

  return (
    <div className="editor">
      <div className="toolbar">
        {btn('B', () => editor.chain().focus().toggleBold().run(), editor.isActive('bold'))}
        {btn('I', () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic'))}
        {btn('S', () => editor.chain().focus().toggleStrike().run(), editor.isActive('strike'))}
        {btn('H1', () => editor.chain().focus().toggleHeading({ level: 1 }).run(), editor.isActive('heading', { level: 1 }))}
        {btn('H2', () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive('heading', { level: 2 }))}
        {btn('• List', () => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList'))}
        {btn('1. List', () => editor.chain().focus().toggleOrderedList().run(), editor.isActive('orderedList'))}
        {btn('Quote', () => editor.chain().focus().toggleBlockquote().run(), editor.isActive('blockquote'))}
        {btn('Code', () => editor.chain().focus().toggleCodeBlock().run(), editor.isActive('codeBlock'))}
        {btn('Undo', () => editor.chain().focus().undo().run())}
        {btn('Redo', () => editor.chain().focus().redo().run())}
        <span className="status">
          {status === 'saved' ? 'Saved' : status === 'saving' ? 'Saving…' : 'Unsaved'}
        </span>
      </div>
      <input className="title" value={title} placeholder="Untitled"
        onChange={(e) => { setTitle(e.target.value); queue({ title: e.target.value }); }} />
      <EditorContent editor={editor} className="content" />
    </div>
  );
}
EOF

echo "Writing app/globals.css..."
cat > app/globals.css <<'EOF'
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; color: #1f2328; background: #fff; }
button, input { font: inherit; }
button { cursor: pointer; }

.login { max-width: 320px; margin: 15vh auto; display: flex; flex-direction: column; gap: 10px; }
.login input, .login button { padding: 10px; border: 1px solid #ccc; border-radius: 6px; }
.login button { background: #1f2328; color: #fff; border: none; }
.error { color: #c0392b; }

.app { display: flex; height: 100vh; }
.sidebar { width: 240px; background: #f6f7f9; border-right: 1px solid #e3e5e8;
  display: flex; flex-direction: column; padding: 12px; }
.sidebar ul { list-style: none; padding: 0; margin: 12px 0; flex: 1; overflow-y: auto; }
.sidebar li { display: flex; justify-content: space-between; align-items: center;
  padding: 6px 8px; border-radius: 6px; cursor: pointer; }
.sidebar li span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sidebar li:hover, .sidebar li.selected { background: #e8eaee; }
.delete { border: none; background: none; color: #888; visibility: hidden; }
.sidebar li:hover .delete { visibility: visible; }
.new, .signout { padding: 8px; border: 1px solid #d0d4d9; border-radius: 6px; background: #fff; }

main { flex: 1; overflow-y: auto; }
.empty { color: #888; text-align: center; margin-top: 30vh; }
.editor { max-width: 760px; margin: 0 auto; padding: 0 24px 24px; }
.toolbar { position: sticky; top: 0; z-index: 1; background: #fff; display: flex; flex-wrap: wrap;
  gap: 4px; padding: 10px 0; border-bottom: 1px solid #eee; align-items: center; }
.toolbar button { padding: 4px 8px; border: 1px solid transparent; border-radius: 4px; background: none; }
.toolbar button:hover { background: #f0f1f3; }
.toolbar button.active { background: #e3e7ee; border-color: #c9ced6; }
.status { margin-left: auto; font-size: 13px; color: #888; }
.title { width: 100%; font-size: 2rem; font-weight: 700; border: none; outline: none; margin: 24px 0 8px; }
.content .tiptap { outline: none; min-height: 60vh; line-height: 1.6; }
.tiptap blockquote { border-left: 3px solid #ccc; margin-left: 0; padding-left: 12px; color: #555; }
.tiptap pre { background: #f6f8fa; padding: 12px; border-radius: 6px; overflow-x: auto; }
EOF

echo ""
echo "Done! Next steps:"
echo "  1. Put your sb_publishable_ key in .env.local"
echo "  2. Run: npm run dev"
echo "  3. Open http://localhost:3000"
