#!/usr/bin/env bash
set -e

echo "Installing packages..."
npm install lucide-react \
  @tiptap/react@latest @tiptap/pm@latest @tiptap/starter-kit@latest \
  @tiptap/extension-text-align@latest @tiptap/extension-highlight@latest \
  @tiptap/extension-placeholder@latest @tiptap/extension-task-list@latest \
  @tiptap/extension-task-item@latest

echo "Writing app/layout.tsx..."
cat > app/layout.tsx <<'EOF'
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Notebook',
  description: 'My personal editor',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
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
  const [busy, setBusy] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setError(error.message);
  }

  return (
    <div className="login-wrap">
      <form className="login" onSubmit={signIn}>
        <div className="brand">Notebook</div>
        <p className="login-sub">Sign in to your documents</p>
        <input type="email" placeholder="Email" value={email}
          onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="Password" value={password}
          onChange={(e) => setPassword(e.target.value)} required />
        <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}
EOF

echo "Writing components/Workspace.tsx..."
cat > components/Workspace.tsx <<'EOF'
'use client';
import { useEffect, useState } from 'react';
import { Plus, FileText, Trash2, LogOut } from 'lucide-react';
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
  const [email, setEmail] = useState('');

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ''));
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
        <div className="brand">Notebook</div>

        <button className="new-doc" onClick={newDoc}>
          <Plus size={16} /> New document
        </button>

        <div className="section-label">Documents</div>
        <ul className="doc-list">
          {docs.map((d) => (
            <li key={d.id}
              className={`doc-item${d.id === activeId ? ' selected' : ''}`}
              onClick={() => setActiveId(d.id)}>
              <FileText size={15} className="doc-icon" />
              <span className="doc-title">{d.title || 'Untitled'}</span>
              <button className="doc-delete" title="Delete"
                onClick={(e) => { e.stopPropagation(); deleteDoc(d.id); }}>
                <Trash2 size={14} />
              </button>
            </li>
          ))}
          {!docs.length && <li className="doc-empty">No documents yet</li>}
        </ul>

        <div className="sidebar-footer">
          <span className="user-email" title={email}>{email}</span>
          <button className="icon-btn" title="Sign out" onClick={() => supabase.auth.signOut()}>
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      <main className="main">
        {active ? (
          <Editor key={active.id} doc={active}
            onChange={(patch) => updateLocal(active.id, patch)} />
        ) : (
          <div className="empty">
            <FileText size={36} strokeWidth={1.25} />
            <p>No document selected</p>
            <button className="new-doc" onClick={newDoc}>
              <Plus size={16} /> New document
            </button>
          </div>
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
import { TextAlign } from '@tiptap/extension-text-align';
import { Highlight } from '@tiptap/extension-highlight';
import { Placeholder } from '@tiptap/extension-placeholder';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import {
  Bold, Italic, Underline, Strikethrough, Code, Highlighter, Link2,
  List, ListOrdered, ListChecks, Quote, SquareCode, Minus,
  AlignLeft, AlignCenter, AlignRight, AlignJustify, Undo2, Redo2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Doc } from './Workspace';

type Props = { doc: Doc; onChange: (patch: Partial<Doc>) => void };

function Btn(props: {
  onClick: () => void;
  title: string;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button type="button" title={props.title} disabled={props.disabled}
      className={`tb-btn${props.active ? ' active' : ''}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={props.onClick}>
      {props.children}
    </button>
  );
}

const Sep = () => <span className="tb-sep" />;

export default function Editor({ doc, onChange }: Props) {
  const [title, setTitle] = useState(doc.title);
  const [status, setStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const pending = useRef<Partial<Doc>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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
      pending.current = { ...patch, ...pending.current };
      setStatus('unsaved');
    } else {
      setStatus('saved');
    }
  }

  function queue(patch: Partial<Doc>) {
    pending.current = { ...pending.current, ...patch };
    onChange(patch);
    setStatus('unsaved');
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 1000);
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Highlight,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: 'Start writing…' }),
    ],
    content: doc.content ?? '',
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    onUpdate: ({ editor }) => queue({ content: editor.getJSON() }),
  });

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

  const blockValue =
    editor.isActive('heading', { level: 1 }) ? 'h1' :
    editor.isActive('heading', { level: 2 }) ? 'h2' :
    editor.isActive('heading', { level: 3 }) ? 'h3' : 'p';

  function setBlock(v: string) {
    if (v === 'p') editor!.chain().focus().setParagraph().run();
    else editor!.chain().focus().setHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run();
  }

  function setLink() {
    const prev = editor!.getAttributes('link').href;
    const url = window.prompt('Link URL (leave empty to remove)', prev ?? 'https://');
    if (url === null) return;
    const chain = editor!.chain().focus().extendMarkRange('link');
    if (url === '') chain.unsetLink().run();
    else chain.setLink({ href: url }).run();
  }

  const text = editor.getText().trim();
  const words = text ? text.split(/\s+/).length : 0;
  const chars = editor.getText().length;
  const c = () => editor.chain().focus();
  const s = 16;

  return (
    <div className="editor-shell">
      <div className="toolbar">
        <select className="tb-select" value={blockValue}
          onChange={(e) => setBlock(e.target.value)}>
          <option value="p">Paragraph</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
        </select>
        <Sep />
        <Btn title="Bold (Ctrl+B)" active={editor.isActive('bold')} onClick={() => c().toggleBold().run()}><Bold size={s} /></Btn>
        <Btn title="Italic (Ctrl+I)" active={editor.isActive('italic')} onClick={() => c().toggleItalic().run()}><Italic size={s} /></Btn>
        <Btn title="Underline (Ctrl+U)" active={editor.isActive('underline')} onClick={() => c().toggleUnderline().run()}><Underline size={s} /></Btn>
        <Btn title="Strikethrough" active={editor.isActive('strike')} onClick={() => c().toggleStrike().run()}><Strikethrough size={s} /></Btn>
        <Btn title="Inline code" active={editor.isActive('code')} onClick={() => c().toggleCode().run()}><Code size={s} /></Btn>
        <Btn title="Highlight" active={editor.isActive('highlight')} onClick={() => c().toggleHighlight().run()}><Highlighter size={s} /></Btn>
        <Btn title="Link" active={editor.isActive('link')} onClick={setLink}><Link2 size={s} /></Btn>
        <Sep />
        <Btn title="Bullet list" active={editor.isActive('bulletList')} onClick={() => c().toggleBulletList().run()}><List size={s} /></Btn>
        <Btn title="Numbered list" active={editor.isActive('orderedList')} onClick={() => c().toggleOrderedList().run()}><ListOrdered size={s} /></Btn>
        <Btn title="Checklist" active={editor.isActive('taskList')} onClick={() => c().toggleTaskList().run()}><ListChecks size={s} /></Btn>
        <Btn title="Quote" active={editor.isActive('blockquote')} onClick={() => c().toggleBlockquote().run()}><Quote size={s} /></Btn>
        <Btn title="Code block" active={editor.isActive('codeBlock')} onClick={() => c().toggleCodeBlock().run()}><SquareCode size={s} /></Btn>
        <Btn title="Divider" onClick={() => c().setHorizontalRule().run()}><Minus size={s} /></Btn>
        <Sep />
        <Btn title="Align left" active={editor.isActive({ textAlign: 'left' })} onClick={() => c().setTextAlign('left').run()}><AlignLeft size={s} /></Btn>
        <Btn title="Align center" active={editor.isActive({ textAlign: 'center' })} onClick={() => c().setTextAlign('center').run()}><AlignCenter size={s} /></Btn>
        <Btn title="Align right" active={editor.isActive({ textAlign: 'right' })} onClick={() => c().setTextAlign('right').run()}><AlignRight size={s} /></Btn>
        <Btn title="Justify" active={editor.isActive({ textAlign: 'justify' })} onClick={() => c().setTextAlign('justify').run()}><AlignJustify size={s} /></Btn>
        <Sep />
        <Btn title="Undo (Ctrl+Z)" disabled={!editor.can().undo()} onClick={() => c().undo().run()}><Undo2 size={s} /></Btn>
        <Btn title="Redo (Ctrl+Shift+Z)" disabled={!editor.can().redo()} onClick={() => c().redo().run()}><Redo2 size={s} /></Btn>

        <div className={`tb-status ${status}`}>
          <span className="dot" />
          {status === 'saved' ? 'Saved' : status === 'saving' ? 'Saving…' : 'Unsaved'}
        </div>
      </div>

      <div className="canvas">
        <div className="page">
          <input className="title" value={title} placeholder="Untitled"
            onChange={(e) => { setTitle(e.target.value); queue({ title: e.target.value }); }} />
          <EditorContent editor={editor} className="content" />
        </div>
        <div className="page-footer">{words} words · {chars} characters</div>
      </div>
    </div>
  );
}
EOF

echo "Writing app/globals.css..."
cat > app/globals.css <<'EOF'
:root {
  --bg: #0b0b0c;
  --sidebar: #111113;
  --surface: #161618;
  --hover: #1d1d20;
  --active: #26262a;
  --border: #232327;
  --text: #d8d8db;
  --strong: #f4f4f5;
  --muted: #8a8a90;
  --faint: #55555b;
  --accent: #8fb0ff;
  --green: #4ade80;
  --amber: #fbbf24;
  color-scheme: dark;
}

* { box-sizing: border-box; }
html, body { height: 100%; background: var(--bg); }
body {
  margin: 0; color: var(--text);
  font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 14px; -webkit-font-smoothing: antialiased;
}
button, input, select { font: inherit; color: inherit; }
button { cursor: pointer; background: none; border: none; }
::selection { background: rgba(143, 176, 255, 0.28); }
::placeholder { color: var(--faint); }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: var(--active); border-radius: 5px; border: 2px solid var(--bg); }
::-webkit-scrollbar-track { background: transparent; }

.brand { font-size: 15px; font-weight: 600; color: var(--strong); letter-spacing: -0.01em; }

/* ---------- Login ---------- */
.login-wrap { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
.login {
  width: 100%; max-width: 340px; padding: 32px;
  background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
  display: flex; flex-direction: column; gap: 12px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
}
.login .brand { font-size: 20px; }
.login-sub { margin: -4px 0 12px; color: var(--muted); }
.login input {
  padding: 10px 12px; background: var(--bg);
  border: 1px solid var(--border); border-radius: 8px; outline: none;
  transition: border-color 0.15s;
}
.login input:focus { border-color: var(--faint); }
.login button {
  margin-top: 8px; padding: 10px; border-radius: 8px;
  background: var(--strong); color: #111; font-weight: 600;
  transition: opacity 0.15s;
}
.login button:hover { opacity: 0.9; }
.login button:disabled { opacity: 0.5; cursor: default; }
.error { margin: 0; color: #f08a8a; font-size: 13px; }

/* ---------- App layout ---------- */
.app { display: flex; height: 100vh; }

.sidebar {
  width: 250px; flex-shrink: 0; background: var(--sidebar);
  border-right: 1px solid var(--border);
  display: flex; flex-direction: column; padding: 18px 12px 12px;
}
.sidebar .brand { padding: 0 8px 18px; }

.new-doc {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border-radius: 8px;
  border: 1px solid var(--border); background: var(--surface);
  color: var(--text); font-weight: 500;
  transition: background 0.15s, border-color 0.15s;
}
.new-doc:hover { background: var(--hover); border-color: var(--faint); }

.section-label {
  margin: 22px 8px 6px; font-size: 11px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.08em; color: var(--faint);
}

.doc-list { list-style: none; margin: 0; padding: 0; flex: 1; overflow-y: auto; }
.doc-item {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 8px; border-radius: 6px; cursor: pointer;
  color: var(--muted); transition: background 0.12s, color 0.12s;
}
.doc-item:hover { background: var(--hover); color: var(--text); }
.doc-item.selected { background: var(--active); color: var(--strong); }
.doc-icon { flex-shrink: 0; opacity: 0.7; }
.doc-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.doc-delete {
  display: grid; place-items: center; padding: 3px; border-radius: 4px;
  color: var(--faint); opacity: 0; transition: opacity 0.12s, color 0.12s, background 0.12s;
}
.doc-item:hover .doc-delete { opacity: 1; }
.doc-delete:hover { color: #f08a8a; background: rgba(240, 138, 138, 0.1); }
.doc-empty { padding: 8px; color: var(--faint); font-size: 13px; }

.sidebar-footer {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 8px 0; margin-top: 8px; border-top: 1px solid var(--border);
}
.user-email {
  flex: 1; font-size: 12px; color: var(--faint);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.icon-btn {
  display: grid; place-items: center; padding: 6px; border-radius: 6px;
  color: var(--muted); transition: background 0.12s, color 0.12s;
}
.icon-btn:hover { background: var(--hover); color: var(--text); }

.main { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden; }

.empty {
  margin: auto; display: flex; flex-direction: column; align-items: center; gap: 12px;
  color: var(--faint);
}
.empty p { margin: 0 0 6px; }

/* ---------- Editor ---------- */
.editor-shell { flex: 1; min-height: 0; display: flex; flex-direction: column; }

.toolbar {
  display: flex; align-items: center; flex-wrap: wrap; gap: 2px;
  padding: 8px 16px; background: var(--sidebar);
  border-bottom: 1px solid var(--border);
}
.tb-btn {
  display: grid; place-items: center; width: 32px; height: 32px;
  border-radius: 6px; color: var(--muted);
  transition: background 0.12s, color 0.12s;
}
.tb-btn:hover:not(:disabled) { background: var(--hover); color: var(--strong); }
.tb-btn.active { background: var(--active); color: var(--strong); }
.tb-btn:disabled { opacity: 0.3; cursor: default; }
.tb-sep { width: 1px; height: 20px; background: var(--border); margin: 0 6px; }
.tb-select {
  height: 32px; padding: 0 28px 0 10px; border-radius: 6px;
  background: var(--surface); border: 1px solid var(--border);
  outline: none; cursor: pointer; appearance: none;
  background-image: linear-gradient(45deg, transparent 50%, var(--muted) 50%),
                    linear-gradient(135deg, var(--muted) 50%, transparent 50%);
  background-position: calc(100% - 15px) 14px, calc(100% - 10px) 14px;
  background-size: 5px 5px; background-repeat: no-repeat;
}
.tb-select:hover { border-color: var(--faint); }
.tb-select option { background: var(--surface); }

.tb-status {
  margin-left: auto; display: flex; align-items: center; gap: 6px;
  font-size: 12px; color: var(--muted);
}
.tb-status .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--green); }
.tb-status.saving .dot, .tb-status.unsaved .dot { background: var(--amber); }

/* ---------- Page ---------- */
.canvas { flex: 1; overflow-y: auto; padding: 40px 24px 80px; }
.page {
  max-width: 816px; min-height: 1056px; margin: 0 auto;
  padding: 72px 88px; background: var(--surface);
  border: 1px solid var(--border); border-radius: 4px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 12px 40px rgba(0, 0, 0, 0.35);
}
.page-footer {
  max-width: 816px; margin: 12px auto 0; text-align: right;
  font-size: 12px; color: var(--faint);
}
@media (max-width: 900px) {
  .page { padding: 40px 28px; min-height: 70vh; }
}

.title {
  width: 100%; margin: 0 0 20px; padding: 0;
  font-size: 34px; font-weight: 700; letter-spacing: -0.02em;
  color: var(--strong); background: transparent; border: none; outline: none;
}

/* ---------- Document content ---------- */
.content .tiptap { outline: none; min-height: 600px; font-size: 16px; line-height: 1.75; }
.tiptap > * + * { margin-top: 0.75em; }
.tiptap p { margin: 0; }
.tiptap p.is-editor-empty:first-child::before {
  content: attr(data-placeholder); float: left; height: 0;
  color: var(--faint); pointer-events: none;
}
.tiptap h1, .tiptap h2, .tiptap h3 {
  color: var(--strong); line-height: 1.3; letter-spacing: -0.01em; margin: 1.6em 0 0.5em;
}
.tiptap h1 { font-size: 28px; font-weight: 700; }
.tiptap h2 { font-size: 22px; font-weight: 650; }
.tiptap h3 { font-size: 18px; font-weight: 600; }
.tiptap strong { color: var(--strong); }
.tiptap a { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.tiptap mark { background: rgba(251, 191, 36, 0.3); color: inherit; border-radius: 3px; padding: 0 2px; }
.tiptap ul, .tiptap ol { padding-left: 1.5em; }
.tiptap li > p { margin: 0.2em 0; }
.tiptap li::marker { color: var(--muted); }
.tiptap blockquote {
  margin: 1.2em 0; padding: 2px 0 2px 18px;
  border-left: 3px solid var(--active); color: var(--muted);
}
.tiptap code {
  background: var(--active); padding: 2px 6px; border-radius: 4px; font-size: 0.875em;
  font-family: ui-monospace, "SF Mono", "Cascadia Code", Menlo, monospace;
}
.tiptap pre {
  background: var(--bg); border: 1px solid var(--border);
  padding: 16px 18px; border-radius: 8px; overflow-x: auto;
}
.tiptap pre code { background: none; padding: 0; font-size: 14px; color: var(--text); }
.tiptap hr { border: none; border-top: 1px solid var(--border); margin: 2em 0; }

/* Checklists */
.tiptap ul[data-type="taskList"] { list-style: none; padding-left: 0.2em; }
.tiptap ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 10px; }
.tiptap ul[data-type="taskList"] li > label { margin-top: 0.3em; user-select: none; }
.tiptap ul[data-type="taskList"] li > div { flex: 1; }
.tiptap ul[data-type="taskList"] input[type="checkbox"] {
  width: 16px; height: 16px; accent-color: var(--accent); cursor: pointer;
}
.tiptap ul[data-type="taskList"] li[data-checked="true"] > div {
  color: var(--faint); text-decoration: line-through;
}
EOF

echo ""
echo "Done! Now run: npm run dev"
