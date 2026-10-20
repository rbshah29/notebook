import type { Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextAlign } from '@tiptap/extension-text-align';
import { Highlight } from '@tiptap/extension-highlight';
import { Placeholder } from '@tiptap/extension-placeholder';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import { Image } from '@tiptap/extension-image';
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details';
import { CodeBlock } from './CodeBlock';
import { Callout } from './Callout';
import { ImageUpload } from './ImageUpload';
import { SearchHighlight } from './SearchHighlight';
import { SlashCommand } from './SlashMenu';

/**
 * Everything a note can contain. The share page uses the same list read-only, so a shared note
 * renders exactly like it does in the editor.
 */
export function buildExtensions({ editable, onError = () => {} }: {
  editable: boolean;
  onError?: (message: string) => void;
}): Extensions {
  return [
    StarterKit.configure({ codeBlock: false, link: { openOnClick: !editable, autolink: true, defaultProtocol: 'https' } }),
    CodeBlock,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Highlight,
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: editable, HTMLAttributes: { class: 'table' } }),
    TableRow,
    TableHeader,
    TableCell,
    Image.configure({ HTMLAttributes: { loading: 'lazy' } }),
    Callout,
    Details.configure({ persist: true, HTMLAttributes: { class: 'details' } }),
    DetailsSummary,
    DetailsContent,
    SearchHighlight,
    ...(editable ? [
      Placeholder.configure({
        includeChildren: true,
        placeholder: ({ node, editor }) => {
          if (node.type.name === 'heading') return `Heading ${node.attrs.level}`;
          if (node.type.name === 'detailsSummary') return 'Toggle title';
          return editor.isEmpty ? 'Start writing, or type “/” for commands…' : 'Type “/” for commands';
        },
      }),
      ImageUpload.configure({ onError }),
      SlashCommand,
    ] : []),
  ];
}
