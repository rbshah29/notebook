'use client';
import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Extension, type Editor, type Range } from '@tiptap/core';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import {
  Pilcrow, Heading1, Heading2, Heading3, List, ListOrdered, ListChecks, Quote, SquareCode, Minus,
  Table, Image, ChevronRight, type LucideIcon,
} from 'lucide-react';
import { CALLOUTS, type CalloutVariant } from './Callout';
import { pickImages } from './ImageUpload';

type SlashItem = {
  title: string;
  description: string;
  icon: LucideIcon;
  keywords?: string;
  run: (editor: Editor, range: Range) => void;
};

const chain = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range);

const ITEMS: SlashItem[] = [
  { title: 'Text', description: 'Plain paragraph', icon: Pilcrow, keywords: 'paragraph p',
    run: (e, r) => chain(e, r).setParagraph().run() },
  { title: 'Heading 1', description: 'Large section heading', icon: Heading1, keywords: 'h1 title',
    run: (e, r) => chain(e, r).setHeading({ level: 1 }).run() },
  { title: 'Heading 2', description: 'Medium section heading', icon: Heading2, keywords: 'h2 subtitle',
    run: (e, r) => chain(e, r).setHeading({ level: 2 }).run() },
  { title: 'Heading 3', description: 'Small section heading', icon: Heading3, keywords: 'h3',
    run: (e, r) => chain(e, r).setHeading({ level: 3 }).run() },
  { title: 'Bullet list', description: 'Simple bulleted list', icon: List, keywords: 'ul unordered',
    run: (e, r) => chain(e, r).toggleBulletList().run() },
  { title: 'Numbered list', description: 'List with numbers', icon: ListOrdered, keywords: 'ol ordered',
    run: (e, r) => chain(e, r).toggleOrderedList().run() },
  { title: 'Checklist', description: 'Track tasks with checkboxes', icon: ListChecks, keywords: 'todo task',
    run: (e, r) => chain(e, r).toggleTaskList().run() },
  { title: 'Quote', description: 'Capture a quotation', icon: Quote, keywords: 'blockquote',
    run: (e, r) => chain(e, r).toggleBlockquote().run() },
  { title: 'Code block', description: 'Code with syntax highlighting', icon: SquareCode, keywords: 'snippet pre',
    run: (e, r) => chain(e, r).setCodeBlock().run() },
  { title: 'Table', description: 'Rows and columns', icon: Table, keywords: 'grid',
    run: (e, r) => chain(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { title: 'Image', description: 'Upload from your computer', icon: Image, keywords: 'picture photo',
    run: (e, r) => { chain(e, r).run(); pickImages(e); } },
  ...(Object.keys(CALLOUTS) as CalloutVariant[]).map((v): SlashItem => ({
    title: `${CALLOUTS[v].label} callout`,
    description: `Highlighted ${CALLOUTS[v].label.toLowerCase()} box`,
    icon: CALLOUTS[v].icon,
    keywords: 'callout admonition note box',
    run: (e, r) => chain(e, r).setCallout(v).run(),
  })),
  { title: 'Toggle section', description: 'Collapsible block with a title', icon: ChevronRight, keywords: 'details collapse accordion',
    run: (e, r) => chain(e, r).setDetails().run() },
  { title: 'Divider', description: 'Horizontal line', icon: Minus, keywords: 'hr rule separator',
    run: (e, r) => chain(e, r).setHorizontalRule().run() },
];

function filterItems(query: string) {
  const q = query.toLowerCase().trim();
  if (!q) return ITEMS;
  return ITEMS
    .map((item) => {
      const title = item.title.toLowerCase();
      const score = title.startsWith(q) ? 0 : title.includes(q) ? 1 : item.keywords?.includes(q) ? 2 : -1;
      return { item, score };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => a.score - b.score)
    .map((x) => x.item);
}

type ListHandle = { onKeyDown: (e: KeyboardEvent) => boolean };
type ListProps = SuggestionProps<SlashItem, SlashItem> & { ref?: React.Ref<ListHandle> };

function SlashList({ items, command, ref }: ListProps) {
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const [prevItems, setPrevItems] = useState(items);
  if (items !== prevItems) { setPrevItems(items); setIndex(0); }

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  useImperativeHandle(ref, () => ({
    onKeyDown: (e) => {
      if (!items.length) return false;
      if (e.key === 'ArrowDown') { setIndex((i) => (i + 1) % items.length); return true; }
      if (e.key === 'ArrowUp') { setIndex((i) => (i - 1 + items.length) % items.length); return true; }
      if (e.key === 'Enter' || e.key === 'Tab') { command(items[index]); return true; }
      return false;
    },
  }), [items, index, command]);

  return (
    <div className="slash-menu" ref={listRef} role="listbox" aria-label="Insert block">
      {items.length ? items.map((item, i) => {
        const Icon = item.icon;
        return (
          <button key={item.title} type="button" role="option" aria-selected={i === index}
            className="slash-item" onMouseEnter={() => setIndex(i)}
            onMouseDown={(e) => e.preventDefault()} onClick={() => command(item)}>
            <span className="slash-icon"><Icon size={16} /></span>
            <span className="slash-text">
              <span className="slash-title">{item.title}</span>
              <span className="slash-desc">{item.description}</span>
            </span>
          </button>
        );
      }) : <div className="slash-empty">No matching blocks</div>}
    </div>
  );
}

/** Type “/” to insert any block: headings, lists, code, tables, images, callouts… */
export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addProseMirrorPlugins() {
    return [Suggestion<SlashItem, SlashItem>({
      editor: this.editor,
      pluginKey: new PluginKey('slashCommand'),
      char: '/',
      placement: 'bottom-start',
      offset: { mainAxis: 6 },
      allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
      items: ({ query }) => filterItems(query),
      command: ({ editor, range, props }) => props.run(editor, range),
      render: () => {
        let renderer: ReactRenderer<ListHandle, ListProps> | null = null;
        let unmount: (() => void) | null = null;
        return {
          onStart: (props) => {
            renderer = new ReactRenderer(SlashList, { props, editor: props.editor });
            const el = renderer.element as HTMLElement;
            el.classList.add('slash-popup');
            unmount = props.mount(el);
          },
          onUpdate: (props) => renderer?.updateProps(props),
          onKeyDown: ({ event }: SuggestionKeyDownProps) => {
            if (event.key === 'Escape') return false; // the plugin closes the menu
            return renderer?.ref?.onKeyDown(event) ?? false;
          },
          onExit: () => {
            unmount?.();
            renderer?.destroy();
            renderer = null;
            unmount = null;
          },
        };
      },
    })];
  },
});
