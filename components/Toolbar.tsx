'use client';
import { useEffect, useRef, useState } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import {
  Bold, Italic, Underline, Link2, List, ListOrdered, ListChecks, Quote, SquareCode, Minus,
  AlignLeft, AlignCenter, AlignRight, AlignJustify, Undo2, Redo2, ChevronDown, Check, Unlink,
  ExternalLink, Plus, Table, Image as ImageIcon, ChevronRight, Trash2, Rows3, Columns3,
} from 'lucide-react';
import Menu, { type MenuItem } from '@/components/ui/Menu';
import { keys } from '@/lib/shortcuts';
import { CALLOUTS, type CalloutVariant } from './Callout';
import { pickImages } from './ImageUpload';

export function ToolButton({ label, shortcut, active, disabled, onClick, children }: {
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className={`tb-btn${active ? ' active' : ''}`}
      aria-label={label} aria-pressed={active} disabled={disabled}
      title={shortcut ? `${label}  ${shortcut}` : label}
      // Keep focus (and the selection) in the editor.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}>
      {children}
    </button>
  );
}

const BLOCKS = [
  { value: 'p', label: 'Text', hint: '' },
  { value: 'h1', label: 'Heading 1', hint: '#' },
  { value: 'h2', label: 'Heading 2', hint: '##' },
  { value: 'h3', label: 'Heading 3', hint: '###' },
] as const;

const ALIGNS = [
  { value: 'left', label: 'Align left', icon: AlignLeft, hint: 'Mod+Shift+L' },
  { value: 'center', label: 'Align center', icon: AlignCenter, hint: 'Mod+Shift+E' },
  { value: 'right', label: 'Align right', icon: AlignRight, hint: 'Mod+Shift+R' },
  { value: 'justify', label: 'Justify', icon: AlignJustify, hint: 'Mod+Shift+J' },
] as const;

export default function Toolbar({ editor }: { editor: Editor }) {
  // Subscribes to just the bits the toolbar shows, so typing doesn't re-render the whole editor.
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      block: e.isActive('heading', { level: 1 }) ? 'h1'
        : e.isActive('heading', { level: 2 }) ? 'h2'
        : e.isActive('heading', { level: 3 }) ? 'h3' : 'p',
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      link: e.isActive('link'),
      bulletList: e.isActive('bulletList'),
      orderedList: e.isActive('orderedList'),
      taskList: e.isActive('taskList'),
      blockquote: e.isActive('blockquote'),
      codeBlock: e.isActive('codeBlock'),
      table: e.isActive('table'),
      align: ALIGNS.find((a) => e.isActive({ textAlign: a.value }))?.value ?? 'left',
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  const c = () => editor.chain().focus();
  const block = BLOCKS.find((b) => b.value === s.block)!;
  const AlignIcon = ALIGNS.find((a) => a.value === s.align)!.icon;
  const z = 16;

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <Menu label="Text style" triggerClassName="tb-select" align="start"
        items={BLOCKS.map((b) => ({
          label: b.label,
          hint: b.hint,
          checked: b.value === s.block,
          onSelect: () => (b.value === 'p'
            ? c().setParagraph().run()
            : c().setHeading({ level: Number(b.value[1]) as 1 | 2 | 3 }).run()),
        }))}>
        {block.label} <ChevronDown size={14} />
      </Menu>
      <span className="tb-sep" />
      <ToolButton label="Bold" shortcut={keys('Mod+B')} active={s.bold} onClick={() => c().toggleBold().run()}><Bold size={z} /></ToolButton>
      <ToolButton label="Italic" shortcut={keys('Mod+I')} active={s.italic} onClick={() => c().toggleItalic().run()}><Italic size={z} /></ToolButton>
      <ToolButton label="Underline" shortcut={keys('Mod+U')} active={s.underline} onClick={() => c().toggleUnderline().run()}><Underline size={z} /></ToolButton>
      <LinkButton editor={editor} active={s.link} />
      <span className="tb-sep" />
      <ToolButton label="Bullet list" shortcut={keys('Mod+Shift+8')} active={s.bulletList} onClick={() => c().toggleBulletList().run()}><List size={z} /></ToolButton>
      <ToolButton label="Numbered list" shortcut={keys('Mod+Shift+7')} active={s.orderedList} onClick={() => c().toggleOrderedList().run()}><ListOrdered size={z} /></ToolButton>
      <ToolButton label="Checklist" shortcut={keys('Mod+Shift+9')} active={s.taskList} onClick={() => c().toggleTaskList().run()}><ListChecks size={z} /></ToolButton>
      <ToolButton label="Quote" shortcut={keys('Mod+Shift+B')} active={s.blockquote} onClick={() => c().toggleBlockquote().run()}><Quote size={z} /></ToolButton>
      <ToolButton label="Code block" shortcut={keys('Mod+`')} active={s.codeBlock} onClick={() => c().toggleCodeBlock().run()}><SquareCode size={z} /></ToolButton>
      <Menu label="Insert" triggerClassName="tb-btn" align="start" title="Insert"
        items={[
          { label: 'Table', icon: <Table size={15} />, onSelect: () => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
          { label: 'Image', icon: <ImageIcon size={15} />, onSelect: () => pickImages(editor) },
          { label: 'Toggle section', icon: <ChevronRight size={15} />, onSelect: () => c().setDetails().run() },
          { label: 'Divider', icon: <Minus size={15} />, onSelect: () => c().setHorizontalRule().run() },
          { heading: 'Callout' },
          ...(Object.keys(CALLOUTS) as CalloutVariant[]).map((v): MenuItem => {
            const Icon = CALLOUTS[v].icon;
            return { label: CALLOUTS[v].label, icon: <Icon size={15} />, onSelect: () => c().toggleCallout(v).run() };
          }),
        ]}>
        <Plus size={z} />
      </Menu>
      {s.table && <TableMenu editor={editor} />}
      <Menu label="Alignment" triggerClassName="tb-btn" align="start"
        items={ALIGNS.map((a) => ({
          label: a.label,
          hint: keys(a.hint),
          checked: a.value === s.align,
          onSelect: () => c().setTextAlign(a.value).run(),
        }))}>
        <AlignIcon size={z} />
      </Menu>
      <span className="tb-sep" />
      <ToolButton label="Undo" shortcut={keys('Mod+Z')} disabled={!s.canUndo} onClick={() => c().undo().run()}><Undo2 size={z} /></ToolButton>
      <ToolButton label="Redo" shortcut={keys('Mod+Shift+Z')} disabled={!s.canRedo} onClick={() => c().redo().run()}><Redo2 size={z} /></ToolButton>
    </div>
  );
}

function TableMenu({ editor }: { editor: Editor }) {
  const c = () => editor.chain().focus();
  return (
    <Menu label="Table" triggerClassName="tb-select" align="start"
      items={[
        { heading: 'Rows' },
        { label: 'Insert row above', icon: <Rows3 size={15} />, onSelect: () => c().addRowBefore().run() },
        { label: 'Insert row below', icon: <Rows3 size={15} />, onSelect: () => c().addRowAfter().run() },
        { label: 'Delete row', icon: <Trash2 size={15} />, onSelect: () => c().deleteRow().run() },
        { heading: 'Columns' },
        { label: 'Insert column left', icon: <Columns3 size={15} />, onSelect: () => c().addColumnBefore().run() },
        { label: 'Insert column right', icon: <Columns3 size={15} />, onSelect: () => c().addColumnAfter().run() },
        { label: 'Delete column', icon: <Trash2 size={15} />, onSelect: () => c().deleteColumn().run() },
        { separator: true },
        { label: 'Toggle header row', onSelect: () => c().toggleHeaderRow().run() },
        { label: 'Merge or split cells', onSelect: () => c().mergeOrSplit().run() },
        { label: 'Delete table', icon: <Trash2 size={15} />, danger: true, onSelect: () => c().deleteTable().run() },
      ]}>
      <Table size={15} /> Table <ChevronDown size={14} />
    </Menu>
  );
}

function LinkButton({ editor, active }: { editor: Editor; active: boolean }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  return (
    <div className="menu-wrap" ref={wrapRef}>
      <ToolButton label={active ? 'Edit link' : 'Add link'} active={active || open}
        onClick={() => setOpen((o) => !o)}>
        <Link2 size={16} />
      </ToolButton>
      {open && (
        <div className="popover menu-start menu-bottom">
          <LinkForm editor={editor} onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

function normalizeUrl(raw: string): string {
  const url = raw.trim();
  if (!url) return '';
  if (/^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith('/') || url.startsWith('#')) return url;
  if (/^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(url)) return `mailto:${url}`;
  return `https://${url}`;
}

/** Inline link editor used by both the toolbar popover and the selection bubble. */
export function LinkForm({ editor, onDone }: { editor: Editor; onDone: () => void }) {
  const existing = editor.getAttributes('link').href as string | undefined;
  const [url, setUrl] = useState(existing ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  function apply(e: React.FormEvent) {
    e.preventDefault();
    const href = normalizeUrl(url);
    const chain = editor.chain().focus().extendMarkRange('link');
    if (!href) chain.unsetLink().run();
    else if (editor.state.selection.empty && !editor.isActive('link')) {
      chain.insertContent({ type: 'text', text: url.trim(), marks: [{ type: 'link', attrs: { href } }] }).run();
    } else chain.setLink({ href }).run();
    onDone();
  }

  return (
    <form className="link-form" onSubmit={apply}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); onDone(); editor.commands.focus(); }
      }}>
      <input ref={inputRef} value={url} onChange={(e) => setUrl(e.target.value)}
        placeholder="Paste or type a link…" aria-label="Link URL" spellCheck={false} />
      <button type="submit" className="tb-btn" aria-label="Apply link" title="Apply  ↵">
        <Check size={15} />
      </button>
      {existing && (
        <>
          <a className="tb-btn" href={existing} target="_blank" rel="noopener noreferrer"
            aria-label="Open link" title="Open link">
            <ExternalLink size={15} />
          </a>
          <button type="button" className="tb-btn" aria-label="Remove link" title="Remove link"
            onClick={() => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); onDone(); }}>
            <Unlink size={15} />
          </button>
        </>
      )}
    </form>
  );
}
