import type { CollabEvent, CollabProvider, OpenDecision } from '@plume/collab';
import { reduceCollab } from '@plume/collab';
import {
  addObject,
  commit,
  createDocument,
  createEditor,
  createId,
  deleteSelection,
  highlighterDefault,
  makeImage,
  objectById,
  penDefault,
  redo,
  screenToWorld,
  setTheme,
  setView,
  themeColors,
  undo,
  updateText,
  worldToScreen,
  zoomView,
  type Document,
  type EditorState,
  type Tool,
} from '@plume/model';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Board } from './Board';
import { Icon } from './icons';
import { Tip } from './Tip';
import './styles.css';

const TOOLS: { id: Tool; label: string }[] = [
  { id: 'select', label: 'Select' },
  { id: 'pen', label: 'Pen' },
  { id: 'highlighter', label: 'Marker' },
  { id: 'eraser', label: 'Eraser' },
  { id: 'pan', label: 'Pan' },
  { id: 'rect', label: 'Rectangle' },
  { id: 'ellipse', label: 'Ellipse' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'line', label: 'Line' },
  { id: 'arrow', label: 'Arrow' },
  { id: 'text', label: 'Text' },
  { id: 'connector', label: 'Connect' },
];

const GROUPS = [TOOLS.slice(0, 5), TOOLS.slice(5, 10), TOOLS.slice(10)];

const SWATCHES = [penDefault, '#17324a', '#9f2d22', '#1f7a4d', highlighterDefault, '#7a4e9a', '#d7e3ea'];

const KEYS: Record<string, Tool> = {
  v: 'select',
  p: 'pen',
  h: 'highlighter',
  e: 'eraser',
  t: 'text',
  r: 'rect',
};

type Dock = 'left' | 'bottom' | 'right';

const DOCK_KEY = 'plume.toolbar.dock';

function readDock(): Dock {
  try {
    const saved = localStorage.getItem(DOCK_KEY);
    if (saved === 'left' || saved === 'bottom' || saved === 'right') return saved;
  } catch {
    /* storage unavailable */
  }
  return typeof window !== 'undefined' && window.innerWidth < 720 ? 'bottom' : 'left';
}

function nearestDock(point: { x: number; y: number }): Dock {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const candidates: [Dock, number][] = [
    ['left', Math.hypot(point.x, point.y - h / 2)],
    ['bottom', Math.hypot(point.x - w / 2, point.y - h)],
    ['right', Math.hypot(point.x - w, point.y - h / 2)],
  ];
  candidates.sort((a, b) => a[1] - b[1]);
  return candidates[0][0];
}

export type EditorStorage = {
  /** Synchronous read for the first paint. */
  read?: () => Document | null;
  /** Fuller read, for example IndexedDB merged with the synchronous copy. */
  load: () => Promise<Document | null>;
  save: (doc: Document) => void;
  flush?: (doc: Document) => void;
};

export type PlumeEditorProps = {
  /** Step authority. Omit for a board that never syncs. Keep the instance stable. */
  collab?: CollabProvider;
  /** Host persistence. Keep the instance stable. */
  storage?: EditorStorage;
  /** Used when storage has nothing saved yet. */
  initialDocument?: Document;
  className?: string;
};

export function PlumeEditor({ collab, storage, initialDocument, className }: PlumeEditorProps) {
  const [editor, setEditor] = useState<EditorState>(() => createEditor(storage?.read?.() ?? initialDocument ?? createDocument()));
  const [tool, setTool] = useState<Tool>('pen');
  const [penColor, setPenColor] = useState(penDefault);
  const [penSize, setPenSize] = useState(4);
  const [highlightColor, setHighlightColor] = useState(highlighterDefault);
  const [highlightSize, setHighlightSize] = useState(22);
  const [eraserSize, setEraserSize] = useState(14);
  const [selection, setSelection] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [peers, setPeers] = useState(1);
  const [link, setLink] = useState<'connecting' | 'live' | 'offline'>(collab ? 'connecting' : 'live');
  const [linkDetail, setLinkDetail] = useState<string | undefined>();
  const [dock, setDock] = useState<Dock>(readDock);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const clientID = useState(createId)[0];
  const collabRef = useRef(collab);
  const editBase = useRef<Document | null>(null);
  const editorRef = useRef(editor);
  const frameRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const fileRef = useRef<HTMLInputElement>(null);
  collabRef.current = collab;
  editorRef.current = editor;
  const doc = editor.doc;

  const applyRoom = useCallback((event: CollabEvent | OpenDecision) => {
    if (!event || event.type === 'peers') {
      if (event && event.type === 'peers') setPeers(event.count);
      return;
    }
    if (event.type === 'status') {
      setLink(event.status);
      setLinkDetail(event.detail);
      return;
    }
    setEditor((state) => reduceCollab(state, event));
  }, []);

  const change = useCallback((next: Document, mode: 'transient' | 'commit' | 'view', base?: Document) => {
    setEditor((state) => {
      if (mode !== 'commit') return { ...state, doc: next };
      const source = base ?? state.doc;
      if (sameContent(source, next)) return state.doc === next ? state : { ...state, doc: next };
      return commit({ ...state, doc: source }, next);
    });
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = doc.theme;
    const colors = themeColors[doc.theme];
    const root = document.documentElement.style;
    root.setProperty('--canvas', colors.canvas);
    root.setProperty('--chrome', colors.chrome);
    root.setProperty('--chrome-ink', colors.chromeInk);
    root.setProperty('--ink', colors.ink);
    root.setProperty('--accent', colors.accent);
    root.setProperty('--muted', colors.muted);
    root.setProperty('--panel', colors.panel);
    root.setProperty('--line', colors.line);
  }, [doc.theme]);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      const loaded = storage ? await storage.load() : null;
      if (cancel) return;
      if (loaded) {
        setEditor((state) => {
          const next = { ...loaded, view: state.doc.view };
          if (loaded.rev > state.doc.rev) return createEditor(next);
          if (loaded.rev === state.doc.rev && sameContent(loaded, state.doc)) return state;
          if (loaded.rev < state.doc.rev) return state;
          return { ...state, doc: next, collab: { ...state.collab, confirmed: next } };
        });
      }
      setHydrated(true);
    })();
    return () => {
      cancel = true;
    };
  }, [storage]);

  useEffect(() => {
    if (editingId && editBase.current === null) editBase.current = editor.doc;
  }, [editingId, editor.doc]);

  useEffect(() => {
    if (!hydrated || !collab) return;
    let cancel = false;
    const provider = collab;
    void provider
      .connect({
        clientId: clientID,
        getState: () => editorRef.current,
        emit: applyRoom,
      })
      .then((decision) => {
        if (cancel) return;
        if (decision) setEditor((state) => reduceCollab(state, decision));
        else provider.sync(editorRef.current);
      });
    return () => {
      cancel = true;
      provider.disconnect();
    };
  }, [hydrated, collab, clientID, applyRoom]);

  useEffect(() => {
    if (!hydrated) return;
    collabRef.current?.sync(editor);
  }, [editor, hydrated]);

  useEffect(() => {
    setSelection((ids) => {
      const next = ids.filter((id) => doc.objects.some((object) => object.id === id));
      return next.length === ids.length ? ids : next;
    });
  }, [doc.objects]);

  useEffect(() => {
    if (!hydrated || !storage) return;
    storage.save(editor.doc);
    const flush = () => storage.flush?.(editorRef.current.doc);
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [editor.doc, hydrated, storage]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === 'TEXTAREA' || target?.tagName === 'INPUT';
      if (typing) {
        if (event.key === 'Escape') target?.blur();
        return;
      }
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        setEditor((state) => (event.shiftKey ? redo(state) : undo(state)));
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        const ids = selection;
        if (!ids.length) return;
        event.preventDefault();
        change(deleteSelection(editorRef.current.doc, ids), 'commit');
        setSelection([]);
        return;
      }
      if (event.key === 'Escape') {
        setSelection([]);
        setEditingId(null);
        return;
      }
      if (!meta) {
        const nextTool = KEYS[event.key.toLowerCase()];
        if (nextTool) setTool(nextTool);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [change, selection]);

  const color = tool === 'highlighter' ? highlightColor : penColor;
  const size = tool === 'highlighter' ? highlightSize : tool === 'eraser' ? eraserSize : penSize;
  const showInk = tool !== 'select' && tool !== 'pan' && tool !== 'image';
  const editing = editingId ? objectById(doc, editingId) : undefined;
  const editingBox = editing?.type === 'text' ? editing : null;
  const liveText = link === 'offline' ? 'Offline' : peers > 1 ? `${peers} live` : link === 'connecting' ? 'Connecting' : 'Live';

  const frameCenter = useCallback(() => {
    const frame = frameRef.current;
    if (!frame) return { x: document.documentElement.clientWidth / 2, y: document.documentElement.clientHeight / 2 };
    return { x: frame.clientWidth / 2, y: frame.clientHeight / 2 };
  }, []);

  function setActiveColor(value: string) {
    if (tool === 'highlighter') setHighlightColor(value);
    else setPenColor(value);
  }

  function setActiveSize(value: number) {
    if (tool === 'highlighter') setHighlightSize(value);
    else if (tool === 'eraser') setEraserSize(value);
    else setPenSize(value);
  }

  async function onImageFile(file: File) {
    const dataUrl = await readFile(file);
    const dims = await imageSize(dataUrl);
    const scale = Math.min(1, 480 / Math.max(dims.width, dims.height));
    const current = editorRef.current.doc;
    const center = screenToWorld(frameCenter(), current.view);
    const image = makeImage({
      cx: center.x,
      cy: center.y,
      width: Math.max(24, dims.width * scale),
      height: Math.max(24, dims.height * scale),
      mime: file.type || 'image/png',
      dataUrl,
    });
    change(addObject(current, image), 'commit');
    setSelection([image.id]);
  }

  function zoom(factor: number) {
    const current = editorRef.current.doc;
    change(setView(current, zoomView(current.view, frameCenter(), factor)), 'view');
  }

  function onGripDown(event: React.PointerEvent<HTMLDivElement>) {
    const palette = paletteRef.current;
    if (!palette || event.button !== 0) return;
    event.preventDefault();
    const rect = palette.getBoundingClientRect();
    dragOffset.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    setDragPos({ x: rect.left, y: rect.top });
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onGripMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    const x = Math.min(Math.max(event.clientX - dragOffset.current.x, 4), window.innerWidth - 56);
    const y = Math.min(Math.max(event.clientY - dragOffset.current.y, 4), window.innerHeight - 56);
    setDragPos({ x, y });
  }

  function onGripUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    setDragging(false);
    const next = nearestDock({ x: event.clientX, y: event.clientY });
    setDock(next);
    try {
      localStorage.setItem(DOCK_KEY, next);
    } catch {
      /* storage unavailable */
    }
    // Keep the released pixel position for one frame so the dock snap animates.
    requestAnimationFrame(() => setDragPos(null));
  }

  const rootClass = useMemo(() => ['plume', className].filter(Boolean).join(' '), [className]);

  return (
    <div ref={frameRef} className={rootClass} data-theme={doc.theme} data-plume="editor" data-dock={dock}>
      <Board
        doc={doc}
        selection={selection}
        tool={tool}
        color={color}
        size={size}
        eraserSize={eraserSize}
        onChange={change}
        onSelection={setSelection}
        onEditText={(id) => {
          editBase.current = null;
          setEditingId(id);
          setTool('select');
        }}
      />
      <div
        ref={paletteRef}
        className={dragging ? 'palette dragging' : 'palette'}
        data-dock={dock}
        style={dragPos ? { left: dragPos.x, top: dragPos.y, transform: 'none' } : undefined}
        role="toolbar"
        aria-label="Tools"
      >
        <div
          className="grip"
          title="Drag to move the toolbar"
          aria-label="Drag to move the toolbar"
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={onGripUp}
          onPointerCancel={onGripUp}
        >
          <Icon name={dock === 'bottom' ? 'grip-horizontal' : 'grip-vertical'} />
        </div>
        {GROUPS.map((group, index) => (
          <div key={group[0].id} className="palette-group">
            {index > 0 && <div className="palette-gap" />}
            {group.map((item) => (
              <Tip key={item.id} label={item.label}>
                <button
                  type="button"
                  className="tool"
                  data-tool={item.id}
                  aria-label={item.label}
                  aria-pressed={tool === item.id}
                  onClick={() => setTool(item.id)}
                >
                  <Icon name={item.id} />
                </button>
              </Tip>
            ))}
          </div>
        ))}
        <div className="palette-gap" />
        <Tip label="Image">
          <button type="button" className="tool" aria-label="Image" onClick={() => fileRef.current?.click()}>
            <Icon name="image" />
          </button>
        </Tip>
        <input
          ref={fileRef}
          className="file-input"
          type="file"
          accept="image/*"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onImageFile(file);
            event.target.value = '';
          }}
        />
      </div>
      {showInk && (
        <div className="tray" data-dock={dock} role="toolbar" aria-label="Ink">
          {tool !== 'eraser' &&
            SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className="swatch"
                style={{ background: swatch }}
                aria-label={swatch}
                aria-pressed={color === swatch}
                onClick={() => setActiveColor(swatch)}
              />
            ))}
          {tool !== 'eraser' && (
            <input type="color" aria-label="Custom color" value={toColorInput(color)} onChange={(event) => setActiveColor(event.target.value)} />
          )}
          <input
            type="range"
            min={1}
            max={tool === 'eraser' ? 48 : 36}
            aria-label={tool === 'eraser' ? 'Eraser size' : 'Stroke size'}
            value={size}
            onChange={(event) => setActiveSize(Number(event.target.value))}
          />
          <span className="size-readout">{size}</span>
        </div>
      )}
      <div className="capsule" role="toolbar" aria-label="Board">
        {collab && (
          <span className="live" data-testid="collab-status" data-status={link} title={linkDetail ?? collab.label}>
            <span className="live-kind">{collab.label}</span>
            {liveText}
          </span>
        )}
        <Tip label="Undo">
          <button type="button" className="tool" aria-label="Undo" disabled={editor.past.length === 0} onClick={() => setEditor((state) => undo(state))}>
            <Icon name="undo" />
          </button>
        </Tip>
        <Tip label="Redo">
          <button type="button" className="tool" aria-label="Redo" disabled={editor.future.length === 0} onClick={() => setEditor((state) => redo(state))}>
            <Icon name="redo" />
          </button>
        </Tip>
        <Tip label="Zoom out">
          <button type="button" className="tool" aria-label="Zoom out" onClick={() => zoom(1 / 1.1)}>
            <Icon name="zoom-out" />
          </button>
        </Tip>
        <div className="zoom-label">{Math.round(doc.view.zoom * 100)}%</div>
        <Tip label="Zoom in">
          <button type="button" className="tool" aria-label="Zoom in" onClick={() => zoom(1.1)}>
            <Icon name="zoom-in" />
          </button>
        </Tip>
        <Tip label={doc.theme === 'dark' ? 'Light theme' : 'Dark theme'}>
          <button
            type="button"
            className="tool"
            data-testid="theme-toggle"
            aria-pressed={doc.theme === 'dark'}
            aria-label={doc.theme === 'dark' ? 'Light theme' : 'Dark theme'}
            onClick={() => change(setTheme(editorRef.current.doc, doc.theme === 'light' ? 'dark' : 'light'), 'commit')}
          >
            <Icon name={doc.theme === 'dark' ? 'sun' : 'moon'} />
          </button>
        </Tip>
        {selection.length > 0 && (
          <Tip label="Delete">
            <button
              type="button"
              className="tool"
              aria-label="Delete selection"
              onClick={() => {
                change(deleteSelection(editorRef.current.doc, selection), 'commit');
                setSelection([]);
              }}
            >
              <Icon name="trash" />
            </button>
          </Tip>
        )}
      </div>
      {doc.objects.length === 0 && !editingBox && <p className="hint">Put pen to paper — a finger roams the page.</p>}
      {editingBox && (
        <textarea
          className="text-editor"
          value={editingBox.text}
          aria-label="Text"
          autoFocus
          style={{
            left: worldToScreen({ x: editingBox.cx - editingBox.width / 2, y: editingBox.cy - editingBox.height / 2 }, doc.view).x,
            top: worldToScreen({ x: editingBox.cx - editingBox.width / 2, y: editingBox.cy - editingBox.height / 2 }, doc.view).y,
            width: Math.max(40, editingBox.width * doc.view.zoom),
            height: Math.max(28, editingBox.height * doc.view.zoom),
            fontSize: Math.max(12, editingBox.fontSize * doc.view.zoom),
          }}
          onChange={(event) => change(updateText(editorRef.current.doc, editingBox.id, event.target.value), 'transient')}
          onBlur={() => {
            change(editorRef.current.doc, 'commit', editBase.current ?? undefined);
            editBase.current = null;
            setEditingId(null);
          }}
        />
      )}
    </div>
  );
}

function sameContent(a: Document, b: Document): boolean {
  return JSON.stringify({ ...a, rev: 0, view: undefined }) === JSON.stringify({ ...b, rev: 0, view: undefined });
}

function toColorInput(color: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : penDefault;
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function imageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || 120, height: image.naturalHeight || 80 });
    image.onerror = () => reject(new Error('Image failed to load'));
    image.src = src;
  });
}
