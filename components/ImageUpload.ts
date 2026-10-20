import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { imageFiles, uploadImage, validateImage } from '@/lib/images';

type Meta = { add: { id: string; pos: number } } | { remove: { id: string } };

const key = new PluginKey<DecorationSet>('imageUpload');

function placeholderPos(state: EditorState, id: string): number | null {
  const found = key.getState(state)?.find(undefined, undefined, (spec) => spec.id === id);
  return found?.length ? found[0].from : null;
}

/**
 * Uploads images and inserts them where they were dropped or pasted. While uploading, only a
 * decoration marks the spot, so autosave never stores a temporary URL; the image node is added
 * once the upload has finished (at the spot's current position, if text moved meanwhile).
 */
export async function insertImages(editor: Editor, files: File[], pos: number, onError: (message: string) => void) {
  for (const file of files) {
    const problem = validateImage(file);
    if (problem) { onError(problem); continue; }

    const id = crypto.randomUUID();
    editor.view.dispatch(editor.state.tr.setMeta(key, { add: { id, pos } } satisfies Meta));
    let src: string | null = null;
    try {
      src = await uploadImage(file);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Couldn’t upload the image.');
    }
    if (editor.isDestroyed) return;
    const at = placeholderPos(editor.state, id);
    const tr = editor.state.tr.setMeta(key, { remove: { id } } satisfies Meta);
    if (src && at !== null) {
      tr.insert(at, editor.schema.nodes.image.create({ src, alt: file.name.replace(/\.[^.]+$/, '') }));
      pos = tr.mapping.map(at);
    }
    editor.view.dispatch(tr);
  }
}

/** Opens the system file picker and inserts the chosen images at the cursor. */
export function pickImages(editor: Editor) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.onchange = () => {
    const files = imageFiles(input.files);
    const onError = editor.extensionManager.extensions.find((e) => e.name === 'imageUpload')?.options.onError ?? (() => {});
    if (files.length) insertImages(editor, files, editor.state.selection.from, onError);
  };
  input.click();
}

export const ImageUpload = Extension.create<{ onError: (message: string) => void }>({
  name: 'imageUpload',

  addOptions() {
    return { onError: () => {} };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const onError = (m: string) => this.options.onError(m);
    return [new Plugin<DecorationSet>({
      key,
      state: {
        init: () => DecorationSet.empty,
        apply(tr, set) {
          set = set.map(tr.mapping, tr.doc);
          const meta = tr.getMeta(key) as Meta | undefined;
          if (meta && 'add' in meta) {
            const el = document.createElement('span'); // may sit inside a paragraph
            el.className = 'image-uploading';
            el.textContent = 'Uploading image…';
            set = set.add(tr.doc, [Decoration.widget(meta.add.pos, el, { id: meta.add.id })]);
          } else if (meta && 'remove' in meta) {
            set = set.remove(set.find(undefined, undefined, (spec) => spec.id === meta.remove.id));
          }
          return set;
        },
      },
      props: {
        decorations: (state) => key.getState(state),
        handlePaste: (view, event) => {
          const files = imageFiles(event.clipboardData?.files);
          if (!files.length) return false;
          insertImages(editor, files, view.state.selection.from, onError);
          return true;
        },
        handleDrop: (view, event, _slice, moved) => {
          if (moved) return false;
          const files = imageFiles(event.dataTransfer?.files);
          if (!files.length) return false;
          event.preventDefault();
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from;
          insertImages(editor, files, pos, onError);
          return true;
        },
      },
    })];
  },
});
