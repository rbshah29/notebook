import type { JSONContent } from '@tiptap/react';
import type { Note } from '@/lib/notes';

const CALLOUT_TAGS: Record<string, string> = { info: 'NOTE', tip: 'TIP', warning: 'WARNING', danger: 'CAUTION' };

const escapeText = (s: string) => s.replace(/[\\`*[\]<]/g, '\\$&');

function wrap(text: string, open: string, close = open) {
  // Delimiters can't touch whitespace (`** bold**` doesn't render), so keep spaces outside.
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
  return m[2] ? `${m[1]}${open}${m[2]}${close}${m[3]}` : text;
}

function inline(nodes: JSONContent[] = []): string {
  return nodes.map((node) => {
    if (node.type === 'hardBreak') return '  \n';
    if (node.type === 'image') return image(node);
    if (node.type !== 'text') return inline(node.content);
    const marks = node.marks ?? [];
    const code = marks.find((m) => m.type === 'code');
    let text = code ? codeSpan(node.text ?? '') : escapeText(node.text ?? '');
    for (const mark of marks) {
      if (mark.type === 'bold') text = wrap(text, '**');
      else if (mark.type === 'italic') text = wrap(text, '*');
      else if (mark.type === 'strike') text = wrap(text, '~~');
      else if (mark.type === 'underline') text = wrap(text, '<u>', '</u>');
      else if (mark.type === 'highlight') text = wrap(text, '==');
    }
    const link = marks.find((m) => m.type === 'link');
    if (link) text = `[${text}](${String(link.attrs?.href ?? '').replace(/\)/g, '%29')})`;
    return text;
  }).join('');
}

function codeSpan(text: string) {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length));
  const fence = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

function image(node: JSONContent) {
  const { src = '', alt = '', title } = node.attrs ?? {};
  return `![${escapeText(String(alt ?? ''))}](${src}${title ? ` "${String(title).replace(/"/g, '\\"')}"` : ''})`;
}

const indent = (text: string, prefix: string, first = prefix) =>
  text.split('\n').map((l, i) => (i === 0 ? first : l ? prefix : prefix.trimEnd()) + l).join('\n');

function blocks(nodes: JSONContent[] = [], sep = '\n\n'): string {
  return nodes.map(block).filter((b) => b !== null).join(sep);
}

function list(node: JSONContent, marker: (i: number, item: JSONContent) => string) {
  return (node.content ?? []).map((item, i) => {
    const m = marker(i, item);
    // Tight list: an item's own blocks are separated by single blank-free lines.
    return indent(blocks(item.content, '\n') || '', ' '.repeat(m.length), m);
  }).join('\n');
}

function table(node: JSONContent) {
  const rows = (node.content ?? []).map((row) => (row.content ?? []).map((cell) =>
    (cell.content ?? []).map((p) => inline(p.content)).join('<br>').replace(/\|/g, '\\|').replace(/\n/g, ' ') || ' '));
  if (!rows.length) return '';
  const cols = Math.max(...rows.map((r) => r.length));
  const line = (r: string[]) => `| ${Array.from({ length: cols }, (_, i) => r[i] ?? ' ').join(' | ')} |`;
  return [line(rows[0]), `| ${Array(cols).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n');
}

function block(node: JSONContent): string | null {
  switch (node.type) {
    case 'paragraph': return inline(node.content);
    case 'heading': return `${'#'.repeat(node.attrs?.level ?? 1)} ${inline(node.content)}`;
    case 'blockquote': return indent(blocks(node.content), '> ');
    case 'bulletList': return list(node, () => '- ');
    case 'orderedList': return list(node, (i) => `${(node.attrs?.start ?? 1) + i}. `);
    case 'taskList': return list(node, (_, item) => `- [${item.attrs?.checked ? 'x' : ' '}] `);
    case 'codeBlock': {
      const text = (node.content ?? []).map((t) => t.text ?? '').join('');
      const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((r) => r.length));
      const fence = '`'.repeat(longest + 1);
      return `${fence}${node.attrs?.language ?? ''}\n${text}\n${fence}`;
    }
    case 'horizontalRule': return '---';
    case 'image': return image(node);
    case 'table': return table(node);
    case 'callout':
      return indent(`[!${CALLOUT_TAGS[node.attrs?.variant] ?? 'NOTE'}]\n${blocks(node.content)}`, '> ');
    case 'details': {
      const summary = node.content?.find((c) => c.type === 'detailsSummary');
      const body = node.content?.find((c) => c.type === 'detailsContent');
      return `<details>\n<summary>${inline(summary?.content)}</summary>\n\n${blocks(body?.content)}\n\n</details>`;
    }
    default: return node.content ? blocks(node.content) : null;
  }
}

/** Converts a note to GitHub-flavored Markdown, with the title as a top-level heading. */
export function toMarkdown(title: string, content: Note['content']): string {
  const heading = title.trim() ? `# ${title.trim()}\n\n` : '';
  if (!content) return heading.trim() + '\n';
  if (typeof content === 'string') return heading + content.replace(/<[^>]+>/g, '') + '\n';
  return (heading + blocks(content.content)).trim() + '\n';
}

export function downloadFile(name: string, text: string, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const fileName = (title: string, ext: string) =>
  `${(title.trim() || 'Untitled').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 100)}.${ext}`;
