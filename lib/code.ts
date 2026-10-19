import { common, createLowlight } from 'lowlight';

/** Shared highlighter: highlight.js's ~35 most common languages. */
export const lowlight = createLowlight(common);

/** VS Code language ids (sent with its clipboard data) that highlight.js names differently. */
const ALIASES: Record<string, string> = {
  typescriptreact: 'typescript',
  javascriptreact: 'javascript',
  shellscript: 'bash',
  jsonc: 'json',
  html: 'xml',
  vue: 'xml',
  svelte: 'xml',
  dockerfile: 'bash',
  'objective-c': 'objectivec',
};

/** Languages offered in the picker, in display order. */
export const LANGUAGES: { value: string; label: string }[] = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'java', label: 'Java' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'csharp', label: 'C#' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'kotlin', label: 'Kotlin' },
  { value: 'swift', label: 'Swift' },
  { value: 'php', label: 'PHP' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'xml', label: 'HTML / XML' },
  { value: 'css', label: 'CSS' },
  { value: 'scss', label: 'SCSS' },
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'sql', label: 'SQL' },
  { value: 'graphql', label: 'GraphQL' },
  { value: 'bash', label: 'Bash / Shell' },
  { value: 'diff', label: 'Diff' },
  { value: 'lua', label: 'Lua' },
  { value: 'r', label: 'R' },
  { value: 'plaintext', label: 'Plain text' },
];

/** Maps any language id or alias to the name stored on the node, or null when unknown. */
export function resolveLanguage(id: string | null | undefined): string | null {
  if (!id) return null;
  const name = ALIASES[id.toLowerCase()] ?? id.toLowerCase();
  return lowlight.registered(name) ? name : null;
}

export const INDENT = '    ';

/**
 * Removes the indentation every line shares, so code copied from deep inside a file starts at
 * the left edge. Editors often copy the first line without its indent (the selection started
 * after it), so when that happens the first line is ignored when measuring.
 */
export function dedent(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\t/g, INDENT).split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.length) return '';

  const width = (l: string) => /^ */.exec(l)![0].length;
  const measure = (ls: string[]) => {
    const filled = ls.filter((l) => l.trim());
    return filled.length ? Math.min(...filled.map(width)) : 0;
  };
  const strip = (l: string, n: number) => l.slice(Math.min(n, width(l)));

  const all = measure(lines);
  const rest = measure(lines.slice(1));
  if (width(lines[0]) === 0 && rest > 0) {
    // "if (x) {" copied without its indent: keep its body one level in.
    const opens = /[{([:]\s*$/.test(lines[0]);
    const closes = lines.slice(1).some((l) => l.trim() && width(l) === rest && /^\s*[})\]]/.test(l));
    const keep = opens && !closes ? INDENT.length : 0;
    return [lines[0], ...lines.slice(1).map((l) => strip(l, rest - keep))].join('\n');
  }
  return lines.map((l) => strip(l, all)).join('\n');
}

const CODE_LINE = /[;{}]\s*$|^\s*(?:\/\/|#include|import |from \S+ import|export |def |class |return\b|const |let |var |function\b|public |private |fn |func |package |SELECT |<\/?[a-z][\w-]*[\s>])|=>|\)\s*\{|^\s{2,}\S/i;

/**
 * Best guess at whether pasted plain text is source code: several lines, most of which have
 * code-like structure, that highlight.js also recognizes as some language.
 */
export function detectCode(text: string): { language: string | null } | null {
  const lines = text.split(/\r\n?|\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const codeLines = lines.filter((l) => CODE_LINE.test(l)).length;
  if (codeLines / lines.length < 0.5) return null;
  const guess = lowlight.highlightAuto(text);
  const relevance = (guess.data as { relevance?: number } | undefined)?.relevance ?? 0;
  if (relevance < 2) return null;
  // Short snippets are easy to misattribute (JS often scores as C#), so only pin the language
  // when the guess is confident; otherwise leave it on auto-detect.
  const language = (guess.data as { language?: string } | undefined)?.language;
  return { language: relevance >= 10 ? resolveLanguage(language) : null };
}
