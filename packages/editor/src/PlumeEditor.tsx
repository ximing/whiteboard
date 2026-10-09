import type { CollabEvent, CollabProvider, OpenDecision } from '@plume/collab';
import { reduceCollab } from '@plume/collab';
import {
  addObject,
  alignSelection,
  boundsOf,
  commit,
  createDocument,
  createEditor,
  createId,
  appendComment,
  deleteSelection,
  distributeSelection,
  duplicateObjects,
  expandGroups,
  fitView,
  groupSelection,
  highlighterDefault,
  makeImage,
  makeText,
  moveSelection,
  objectById,
  orderSelection,
  paintOrder,
  panView,
  penDefault,
  redo,
  restyleSelection,
  screenToWorld,
  setCommentResolved,
  setLocked,
  setTextBox,
  setTheme,
  setView,
  themeColors,
  undo,
  ungroupSelection,
  updateText,
  worldToScreen,
  zoomView,
  type BoardObject,
  type Document,
  type EditorState,
  type Point,
  type StylePatch,
  type Tool,
} from '@plume/model';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Board } from './Board';
import { CommentPanel } from './CommentPanel';
import { decodeClipboard, encodeClipboard, insertObjects } from './clipboard';
import { downloadBoardPng, downloadBoardSvg } from './exportBoard';
import { ExportMenu } from './ExportMenu';
import { Icon } from './icons';
import { setLanguage, type PlumeLanguage } from './i18n';
import { dataUrlImageProvider, type ImageProvider } from './images';
import { Minimap } from './Minimap';
import { SelectionBar } from './SelectionBar';
import { measureStickyHeight, measureTextBox } from './textBox';
import { Tip } from './Tip';
import './styles.css';

const TOOL_GROUPS: Tool[][] = [
  ['select', 'laser', 'pen', 'highlighter', 'eraser', 'pan'],
  ['rect', 'ellipse', 'triangle', 'line', 'arrow'],
  ['text', 'sticky', 'comment', 'connector'],
];

const SWATCHES = [penDefault, '#17324a', '#9f2d22', '#1f7a4d', highlighterDefault, '#7a4e9a', '#d7e3ea'];

const KEYS: Record<string, Tool> = {
  v: 'select',
  b: 'laser',
  p: 'pen',
  h: 'highlighter',
  e: 'eraser',
  t: 'text',
  n: 'sticky',
  k: 'comment',
  r: 'rect',
  o: 'ellipse',
  '3': 'triangle',
  l: 'line',
  a: 'arrow',
  c: 'connector',
  m: 'pan',
};

const FILLS = ['transparent', '#f4f1e8', '#d7e3ea', '#f3d2c8', '#d9ead8', '#efe3b0'];

type Dock = 'left' | 'bottom' | 'right';

const DOCK_KEY = 'plume.toolbar.dock';

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const saved = localStorage.getItem(key);
    if (saved === '0') return false;
    if (saved === '1') return true;
  } catch {
    /* storage unavailable */
  }
  return fallback;
}

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
  /**
   * How inserted images become a URL. The default reads a data URL.
   * Pass `{ upload }` that returns an https URL to keep bytes outside the document.
   */
  imageProvider?: ImageProvider;
  /** Block document edits. Pan, zoom, and export stay available. */
  readOnly?: boolean;
  /** Shown on this client's presence cursor and on new comments. */
  userName?: string;
};

export function PlumeEditor({ collab, storage, initialDocument, className, imageProvider, readOnly, userName }: PlumeEditorProps) {
  const { t, i18n } = useTranslation();
  const [editor, setEditor] = useState<EditorState>(() => createEditor(storage?.read?.() ?? initialDocument ?? createDocument()));
  const [tool, setTool] = useState<Tool>('pen');
  const [penColor, setPenColor] = useState(penDefault);
  const [penSize, setPenSize] = useState(4);
  const [shapeFill, setShapeFill] = useState('transparent');
  const [highlightColor, setHighlightColor] = useState(highlighterDefault);
  const [highlightSize, setHighlightSize] = useState(22);
  const [eraserSize, setEraserSize] = useState(14);
  const [selection, setSelection] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [peers, setPeers] = useState(1);
  const [link, setLink] = useState<'connecting' | 'live' | 'offline'>(collab ? 'connecting' : 'live');
  const [linkDetail, setLinkDetail] = useState<string | undefined>();
  const [cursors, setCursors] = useState<
    { id: string; x: number; y: number; color: string; name?: string; at: number; trail?: Point[]; trailAt?: number; presenting?: boolean; view?: Document['view'] }[]
  >([]);
  const [presenting, setPresenting] = useState(false);
  const [showGrid, setShowGrid] = useState(() => readFlag('plume.view.grid', true));
  const [snapEnabled, setSnapEnabled] = useState(() => readFlag('plume.view.snap', true));
  const [frameSize, setFrameSize] = useState({ width: 1, height: 1 });
  const [labelDraft, setLabelDraft] = useState('');
  const [labelFocused, setLabelFocused] = useState(false);
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
  const selectionRef = useRef(selection);
  const doc = editor.doc;
  const objectsRef = useRef(doc.objects);
  const editingRef = useRef(editingId);
  const provider = imageProvider ?? dataUrlImageProvider;
  const readOnlyRef = useRef(!!readOnly);
  const userNameRef = useRef(userName);
  const presentingRef = useRef(false);
  const toolRef = useRef(tool);
  const toolBeforePresent = useRef<Tool>('select');
  const presencePoint = useRef<{ x: number; y: number; trail?: Point[]; color?: string } | null>(null);
  readOnlyRef.current = !!readOnly;
  userNameRef.current = userName;
  presentingRef.current = presenting;
  toolRef.current = tool;
  selectionRef.current = selection;
  objectsRef.current = doc.objects;
  editingRef.current = editingId;
  collabRef.current = collab;
  editorRef.current = editor;

  const applyRoom = useCallback((event: CollabEvent | OpenDecision) => {
    if (!event || event.type === 'peers' || event.type === 'cursor') {
      if (event && event.type === 'peers') setPeers(event.count);
      if (event && event.type === 'cursor') {
        setCursors((list) => {
          const next = list.filter((cursor) => cursor.id !== event.clientId);
          if (!event.active) return next;
          return [
            ...next,
            {
              id: event.clientId,
              x: event.x,
              y: event.y,
              color: event.color,
              name: event.name,
              at: Date.now(),
              trail: event.trail,
              trailAt: event.trail && event.trail.length > 1 ? performance.now() : undefined,
              presenting: event.presenting,
              view: event.view,
            },
          ];
        });
      }
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
    if (readOnlyRef.current && mode !== 'view') return;
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
      const alive = new Set(objectsRef.current.map((object) => object.id));
      const editing = editingRef.current;
      let next = ids.filter((id) => alive.has(id));
      if (editing && alive.has(editing) && !next.includes(editing)) next = [editing, ...next];
      if (next.length === ids.length && next.every((id, index) => id === ids[index])) return ids;
      return next;
    });
  }, [doc.objects, editingId]);

  useEffect(() => {
    if (!hydrated || !storage) return;
    storage.save(editor.doc);
    const flush = () => storage.flush?.(editorRef.current.doc);
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [editor.doc, hydrated, storage]);

  function enterPresent() {
    toolBeforePresent.current = toolRef.current === 'laser' ? 'select' : toolRef.current;
    setPresenting(true);
    setTool('laser');
    setSelection([]);
    setEditingId(null);
    const frame = frameRef.current;
    const current = editorRef.current.doc;
    const bounds = boundsOf(current);
    if (frame && bounds) change(setView(current, fitView({ width: frame.clientWidth, height: frame.clientHeight }, bounds)), 'view');
    void frame?.requestFullscreen?.().catch(() => undefined);
  }

  function exitPresent() {
    if (!presentingRef.current) return;
    presentingRef.current = false;
    setPresenting(false);
    const previous = toolBeforePresent.current;
    setTool(previous === 'laser' ? 'select' : previous);
    const spot = presencePoint.current;
    collabRef.current?.presence?.(spot ? { x: spot.x, y: spot.y, name: userNameRef.current } : null);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }

  useEffect(() => {
    const onFull = () => {
      if (!document.fullscreenElement && presentingRef.current) exitPresent();
    };
    document.addEventListener('fullscreenchange', onFull);
    return () => document.removeEventListener('fullscreenchange', onFull);
  }, []);

  useEffect(() => {
    if (!presenting) return;
    const spot = presencePoint.current;
    if (!spot) return;
    collabRef.current?.presence?.({
      x: spot.x,
      y: spot.y,
      name: userNameRef.current,
      presenting: true,
      view: doc.view,
    });
  }, [doc.view, presenting]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === 'TEXTAREA' || target?.tagName === 'INPUT';
      if (typing) {
        if (event.key === 'Escape') target?.blur();
        return;
      }
      const meta = event.metaKey || event.ctrlKey;
      if (readOnlyRef.current && ((meta && event.key.toLowerCase() === 'z') || event.key === 'Delete' || event.key === 'Backspace')) return;
      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        setEditor((state) => (event.shiftKey ? redo(state) : undo(state)));
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (presentingRef.current) return;
        const ids = selection;
        if (!ids.length) return;
        event.preventDefault();
        change(deleteSelection(editorRef.current.doc, ids), 'commit');
        setSelection(ids.filter((id) => objectById(editorRef.current.doc, id)?.locked));
        return;
      }
      if (event.key === 'Escape') {
        if (presentingRef.current) {
          event.preventDefault();
          exitPresent();
          return;
        }
        setSelection([]);
        setEditingId(null);
        return;
      }
      if (meta && event.key === 'Enter') {
        event.preventDefault();
        if (presentingRef.current) exitPresent();
        else enterPresent();
        return;
      }
      if (presentingRef.current && (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        const step = event.shiftKey ? 160 : 48;
        const dx = event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0;
        const dy = event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0;
        const viewDoc = editorRef.current.doc;
        change(setView(viewDoc, panView(viewDoc.view, dx, dy)), 'view');
        return;
      }
      if (presentingRef.current) {
        const presentKey = event.key.toLowerCase();
        if (meta && presentKey === '0') zoomReset();
        else if (!meta && presentKey === 'f') fit();
        return;
      }
      const key = event.key.toLowerCase();
      const current = editorRef.current.doc;
      const ids = expandGroups(current, selectionRef.current);
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        if (readOnlyRef.current || !ids.length) return;
        event.preventDefault();
        const step = event.shiftKey ? 8 : 1;
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        const movable = ids.some((id) => {
          const object = objectById(current, id);
          return !!object && !object.locked && object.type !== 'connector';
        });
        if (movable) change(moveSelection(current, ids, dx, dy), 'commit');
        return;
      }
      if (meta && key === 'a') {
        event.preventDefault();
        setSelection(current.objects.map((object) => object.id));
        return;
      }
      if (meta && key === 'd') {
        event.preventDefault();
        if (readOnlyRef.current || !ids.length) return;
        const copy = duplicateObjects(current, ids);
        change(copy.doc, 'commit');
        setSelection(copy.ids);
        return;
      }
      if (meta && key === 'g') {
        event.preventDefault();
        if (readOnlyRef.current) return;
        if (event.shiftKey) change(ungroupSelection(current, ids), 'commit');
        else {
          const grouped = groupSelection(current, ids);
          change(grouped.doc, 'commit');
        }
        return;
      }
      if (meta && key === '0') {
        event.preventDefault();
        zoomReset();
        return;
      }
      if (!meta && key === 'f') {
        fit(ids.length ? ids : undefined);
        return;
      }
      if (key === ']' || key === '[') {
        if (readOnlyRef.current) return;
        event.preventDefault();
        const mode = key === ']' ? (meta ? 'front' : 'forward') : meta ? 'back' : 'backward';
        if (ids.length) change(orderSelection(current, ids, mode), 'commit');
        return;
      }
      if (!meta) {
        const nextTool = KEYS[key];
        if (nextTool) setTool(nextTool);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [change, selection]);

  useEffect(() => {
    const onCopy = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'TEXTAREA' || target?.tagName === 'INPUT') return;
      const objects = copiedObjects(editorRef.current.doc, selectionRef.current);
      if (!objects.length) return;
      event.preventDefault();
      event.clipboardData?.setData('text/plain', encodeClipboard(objects));
    };
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'TEXTAREA' || target?.tagName === 'INPUT') return;
      const file = [...(event.clipboardData?.files ?? [])].find((item) => item.type.startsWith('image/'));
      if (file) {
        event.preventDefault();
        void onImageFile(file);
        return;
      }
      if (readOnlyRef.current) return;
      const text = event.clipboardData?.getData('text/plain') ?? '';
      const objects = decodeClipboard(text);
      if (objects) {
        event.preventDefault();
        pasteAt(objects);
        return;
      }
      const plain = text.trim();
      if (!plain) return;
      event.preventDefault();
      const current = editorRef.current.doc;
      const center = screenToWorld(frameCenter(), current.view);
      const measured = measureTextBox(plain, 22);
      const note = makeText({
        cx: center.x,
        cy: center.y,
        width: measured.width,
        height: measured.height,
        text: plain,
        color: penDefault,
      });
      change(addObject(current, note), 'commit');
      setSelection([note.id]);
      setTool('select');
    };
    window.addEventListener('copy', onCopy);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('paste', onPaste);
    };
  }, [change]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const cutoff = Date.now() - 4000;
      setCursors((list) => (list.some((cursor) => cursor.at < cutoff) ? list.filter((cursor) => cursor.at >= cutoff) : list));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const update = () => setFrameSize({ width: frame.clientWidth, height: frame.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const color = tool === 'highlighter' ? highlightColor : penColor;
  const size = tool === 'highlighter' ? highlightSize : tool === 'eraser' ? eraserSize : penSize;
  const showInk = !presenting && tool !== 'select' && tool !== 'pan' && tool !== 'image' && !readOnly;
  const selectedObjects = doc.objects.filter((object) => selection.includes(object.id));
  const showStyle = !presenting && !readOnly && tool === 'select' && selectedObjects.length > 0;
  const presenter = cursors.find((cursor) => cursor.presenting && cursor.view);
  const styleTargets = {
    color: selectedObjects.some((object) => object.type !== 'image'),
    fill: selectedObjects.some((object) => object.type === 'shape' || object.type === 'sticky'),
    size: selectedObjects.some((object) => object.type === 'stroke'),
    strokeWidth: selectedObjects.some((object) => object.type === 'shape' || object.type === 'connector'),
    text: selectedObjects.some((object) => object.type === 'text'),
    sticky: selectedObjects.some((object) => object.type === 'sticky'),
    connector: selectedObjects.some((object) => object.type === 'connector'),
  };
  const textTarget = selectedObjects.find((object) => object.type === 'text');
  const stickyTarget = selectedObjects.find((object) => object.type === 'sticky');
  const connectorTarget = selectedObjects.find((object) => object.type === 'connector');
  const commentTarget = selectedObjects.find((object) => object.type === 'comment');
  const locked = selectedObjects.length > 0 && selectedObjects.every((object) => object.locked);
  const grouped = selectedObjects.some((object) => object.groupId);
  const editing = editingId ? objectById(doc, editingId) : undefined;
  const editingBox = editing?.type === 'text' || editing?.type === 'sticky' ? editing : null;
  const liveText =
    link === 'offline' ? t('collab.offline') : peers > 1 ? t('collab.peers', { count: peers }) : link === 'connecting' ? t('collab.connecting') : t('collab.live');
  const language: PlumeLanguage = i18n.language.startsWith('en') ? 'en' : 'zh';

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

  async function onImageFile(file: Blob) {
    if (readOnlyRef.current) return;
    try {
      const src = await provider.upload(file);
      const dims = await imageSize(src);
      const scale = Math.min(1, 480 / Math.max(dims.width, dims.height));
      const current = editorRef.current.doc;
      const center = screenToWorld(frameCenter(), current.view);
      const image = makeImage({
        cx: center.x,
        cy: center.y,
        width: Math.max(24, dims.width * scale),
        height: Math.max(24, dims.height * scale),
        mime: file.type || 'image/png',
        src,
      });
      change(addObject(current, image), 'commit');
      setSelection([image.id]);
      setTool('select');
    } catch {
      setLinkDetail('Image upload failed');
    }
  }

  function zoom(factor: number) {
    const current = editorRef.current.doc;
    change(setView(current, zoomView(current.view, frameCenter(), factor)), 'view');
  }

  function zoomReset() {
    const current = editorRef.current.doc;
    const center = frameCenter();
    const world = screenToWorld(center, current.view);
    change(setView(current, { zoom: 1, panX: center.x - world.x, panY: center.y - world.y }), 'view');
  }

  function fit(ids?: string[]) {
    const current = editorRef.current.doc;
    const frame = frameRef.current;
    const bounds = boundsOf(current, ids);
    if (!bounds || !frame) return;
    change(setView(current, fitView({ width: frame.clientWidth, height: frame.clientHeight }, bounds)), 'view');
  }

  function patchSelection(patch: StylePatch) {
    const current = editorRef.current.doc;
    change(restyleSelection(current, selectionRef.current, patch), 'commit');
  }

  function copiedObjects(doc: Document, ids: string[]): BoardObject[] {
    const picked = new Set(expandGroups(doc, ids));
    return paintOrder(doc.objects).filter((object) => {
      if (picked.has(object.id)) return true;
      if (object.type === 'connector' && picked.has(object.fromId) && picked.has(object.toId)) return true;
      return object.type === 'comment' && !!object.targetId && picked.has(object.targetId);
    });
  }

  function pasteAt(objects: BoardObject[]) {
    if (!objects.length) return;
    const current = editorRef.current.doc;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const object of objects) {
      if (object.type === 'connector') continue;
      if (object.type === 'stroke') {
        for (const point of object.points) {
          minX = Math.min(minX, point.x);
          minY = Math.min(minY, point.y);
          maxX = Math.max(maxX, point.x);
          maxY = Math.max(maxY, point.y);
        }
      } else if (object.type === 'comment') {
        minX = Math.min(minX, object.cx);
        minY = Math.min(minY, object.cy);
        maxX = Math.max(maxX, object.cx);
        maxY = Math.max(maxY, object.cy);
      } else {
        minX = Math.min(minX, object.cx - object.width / 2);
        minY = Math.min(minY, object.cy - object.height / 2);
        maxX = Math.max(maxX, object.cx + object.width / 2);
        maxY = Math.max(maxY, object.cy + object.height / 2);
      }
    }
    const center = screenToWorld(frameCenter(), current.view);
    const dx = Number.isFinite(minX) ? center.x - (minX + maxX) / 2 : 24;
    const dy = Number.isFinite(minY) ? center.y - (minY + maxY) / 2 : 24;
    const inserted = insertObjects(current, objects, { x: dx, y: dy });
    change(inserted.doc, 'commit');
    setSelection(inserted.ids);
    setTool('select');
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
    <div
      ref={frameRef}
      className={rootClass}
      data-theme={doc.theme}
      data-plume="editor"
      data-dock={dock}
      data-present={presenting ? 'true' : 'false'}
      onDragOver={(event) => {
        if ([...event.dataTransfer.types].includes('Files')) event.preventDefault();
      }}
      onDrop={(event) => {
        const file = [...event.dataTransfer.files].find((item) => item.type.startsWith('image/'));
        if (!file) return;
        event.preventDefault();
        void onImageFile(file);
      }}
    >
      <Board
        doc={doc}
        selection={selection}
        tool={tool}
        color={color}
        fill={shapeFill}
        size={size}
        eraserSize={eraserSize}
        cursors={cursors}
        onChange={change}
        onSelection={setSelection}
        onEditText={(id) => {
          editBase.current = null;
          setEditingId(id);
          setSelection([id]);
          setTool('select');
        }}
        readOnly={readOnly}
        snap={snapEnabled}
        showGrid={showGrid}
        onPresence={(point) => {
          if (point) presencePoint.current = point;
          const presentingNow = presentingRef.current;
          if (!point && !presentingNow) {
            collabRef.current?.presence?.(null);
            return;
          }
          const spot = point ?? presencePoint.current;
          if (!spot) return;
          collabRef.current?.presence?.({
            x: spot.x,
            y: spot.y,
            trail: point?.trail,
            color: point?.color,
            name: userNameRef.current,
            presenting: presentingNow || undefined,
            view: presentingNow ? editorRef.current.doc.view : undefined,
          });
        }}
      />
      {!presenting && (
      <div
        ref={paletteRef}
        className={dragging ? 'palette dragging' : 'palette'}
        data-dock={dock}
        style={dragPos ? { left: dragPos.x, top: dragPos.y, transform: 'none' } : undefined}
        role="toolbar"
        aria-label={t('chrome.tools')}
      >
        <div
          className="grip"
          title={t('chrome.drag')}
          aria-label={t('chrome.drag')}
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={onGripUp}
          onPointerCancel={onGripUp}
        >
          <Icon name={dock === 'bottom' ? 'grip-horizontal' : 'grip-vertical'} />
        </div>
        {TOOL_GROUPS.map((group, index) => (
          <div key={group[0]} className="palette-group">
            {index > 0 && <div className="palette-gap" />}
            {group.map((id) => (
              <Tip key={id} label={t(`tool.${id}`)}>
                <button
                  type="button"
                  className="tool"
                  data-tool={id}
                  aria-label={t(`tool.${id}`)}
                  aria-pressed={tool === id}
                  disabled={!!readOnly && id !== 'select' && id !== 'pan' && id !== 'laser'}
                  onClick={() => setTool(id)}
                >
                  <Icon name={id} />
                </button>
              </Tip>
            ))}
          </div>
        ))}
        <div className="palette-gap" />
        <Tip label={t('tool.image')}>
          <button type="button" className="tool" aria-label={t('tool.image')} disabled={!!readOnly} onClick={() => fileRef.current?.click()}>
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
      )}
      {showStyle && (
        <div
          className="tray"
          data-dock={dock}
          role="toolbar"
          aria-label={t('chrome.style')}
          onMouseDown={(event) => {
            if ((event.target as HTMLElement).closest('input, textarea')) return;
            event.preventDefault();
          }}
        >
          {styleTargets.color &&
            SWATCHES.map((swatch) => (
              <button key={swatch} type="button" className="swatch" style={{ background: swatch }} aria-label={swatch} onClick={() => patchSelection({ color: swatch })} />
            ))}
          {styleTargets.fill &&
            FILLS.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className={swatch === 'transparent' ? 'swatch none' : 'swatch'}
                style={swatch === 'transparent' ? undefined : { background: swatch }}
                aria-label={swatch === 'transparent' ? t('style.noFill') : swatch}
                onClick={() => patchSelection({ fill: swatch })}
              />
            ))}
          {(styleTargets.text || styleTargets.sticky) && (textTarget?.type === 'text' || stickyTarget?.type === 'sticky') && (
            <>
              {textTarget?.type === 'text' && (
                <>
                  <Tip label={t('style.bold')}>
                    <button type="button" className="tool" aria-label={t('style.bold')} aria-pressed={!!textTarget.bold} onClick={() => patchSelection({ bold: !textTarget.bold })}>
                      <Icon name="bold" />
                    </button>
                  </Tip>
                  {(['left', 'center', 'right'] as const).map((align) => (
                    <Tip key={align} label={t(align === 'left' ? 'style.alignLeft' : align === 'center' ? 'style.alignCenter' : 'style.alignRight')}>
                      <button type="button" className="tool" aria-label={t(align === 'left' ? 'style.alignLeft' : align === 'center' ? 'style.alignCenter' : 'style.alignRight')} aria-pressed={(textTarget.align ?? 'left') === align} onClick={() => patchSelection({ align })}>
                        <Icon name={align === 'left' ? 'align-left' : align === 'center' ? 'align-center' : 'align-right'} />
                      </button>
                    </Tip>
                  ))}
                </>
              )}
              <input
                type="range"
                min={12}
                max={72}
                aria-label={t('style.fontSize')}
                value={textTarget?.type === 'text' ? textTarget.fontSize : stickyTarget?.type === 'sticky' ? stickyTarget.fontSize : 18}
                onChange={(event) => patchSelection({ fontSize: Number(event.target.value) })}
              />
            </>
          )}
          {styleTargets.connector && connectorTarget?.type === 'connector' && (
            <>
              {(['straight', 'elbow', 'curve'] as const).map((route) => (
                <Tip key={route} label={t(route === 'straight' ? 'style.straight' : route === 'elbow' ? 'style.elbow' : 'style.curve')}>
                  <button
                    type="button"
                    className="tool"
                    aria-label={t(route === 'straight' ? 'style.straight' : route === 'elbow' ? 'style.elbow' : 'style.curve')}
                    aria-pressed={(connectorTarget.route ?? 'straight') === route}
                    onClick={() => patchSelection({ route })}
                  >
                    <Icon name={route} />
                  </button>
                </Tip>
              ))}
              {(['none', 'end', 'both'] as const).map((arrow) => (
                <button
                  key={arrow}
                  type="button"
                  className="tool"
                  aria-label={t(arrow === 'none' ? 'style.arrowNone' : arrow === 'end' ? 'style.arrowEnd' : 'style.arrowBoth')}
                  aria-pressed={(connectorTarget.arrow ?? 'end') === arrow}
                  onClick={() => patchSelection({ arrow })}
                >
                  {arrow === 'none' ? '–' : arrow === 'end' ? '→' : '↔'}
                </button>
              ))}
              <input
                className="field"
                aria-label={t('style.connectorLabel')}
                value={labelFocused ? labelDraft : (connectorTarget.label ?? '')}
                placeholder={t('style.labelPlaceholder')}
                onFocus={() => {
                  setLabelFocused(true);
                  setLabelDraft(connectorTarget.label ?? '');
                }}
                onChange={(event) => setLabelDraft(event.target.value)}
                onBlur={() => {
                  patchSelection({ label: labelDraft });
                  setLabelFocused(false);
                }}
              />
              {(['fromSide', 'toSide'] as const).map((side) => (
                <select
                  key={side}
                  className="field"
                  aria-label={t(side === 'fromSide' ? 'style.fromSide' : 'style.toSide')}
                  value={connectorTarget[side] ?? 'auto'}
                  onChange={(event) => patchSelection({ [side]: event.target.value as 'auto' | 'top' | 'right' | 'bottom' | 'left' })}
                >
                  {(['auto', 'top', 'right', 'bottom', 'left'] as const).map((option) => (
                    <option key={option} value={option}>
                      {t(side === 'fromSide' ? 'style.fromSide' : 'style.toSide')}{' '}
                      {t(
                        option === 'auto'
                          ? 'style.sideAuto'
                          : option === 'top'
                            ? 'style.sideTop'
                            : option === 'right'
                              ? 'style.sideRight'
                              : option === 'bottom'
                                ? 'style.sideBottom'
                                : 'style.sideLeft',
                      )}
                    </option>
                  ))}
                </select>
              ))}
            </>
          )}
          {(styleTargets.size || styleTargets.strokeWidth) && (
            <input
              type="range"
              min={1}
              max={36}
              aria-label={styleTargets.size ? t('style.strokeSize') : t('style.lineWidth')}
              value={styleTargets.size && selectedObjects.find((object) => object.type === 'stroke')?.type === 'stroke' ? selectedObjects.find((object) => object.type === 'stroke')!.size : connectorTarget?.type === 'connector' ? connectorTarget.strokeWidth : 2.5}
              onChange={(event) => {
                const value = Number(event.target.value);
                patchSelection(styleTargets.size ? { size: value } : { strokeWidth: value });
              }}
            />
          )}
        </div>
      )}
      {showInk && (
        <div className="tray" data-dock={dock} role="toolbar" aria-label={t('chrome.ink')}>
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
          {tool !== 'eraser' && (tool === 'rect' || tool === 'ellipse' || tool === 'triangle' || tool === 'sticky') &&
            FILLS.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className={swatch === 'transparent' ? 'swatch none' : 'swatch'}
                style={swatch === 'transparent' ? undefined : { background: swatch }}
                aria-label={swatch === 'transparent' ? t('style.noFill') : t('style.fill', { color: swatch })}
                aria-pressed={shapeFill === swatch}
                onClick={() => setShapeFill(swatch)}
              />
            ))}
          {tool !== 'eraser' && (
            <input type="color" aria-label={t('style.custom')} value={toColorInput(color)} onChange={(event) => setActiveColor(event.target.value)} />
          )}
          {tool !== 'comment' && tool !== 'laser' && (
            <>
              <input
                type="range"
                min={1}
                max={tool === 'eraser' ? 48 : 36}
                aria-label={tool === 'eraser' ? t('style.eraserSize') : t('style.strokeSize')}
                value={size}
                onChange={(event) => setActiveSize(Number(event.target.value))}
              />
              <span className="size-readout">{size}</span>
            </>
          )}
        </div>
      )}
      <div className="capsule" role="toolbar" aria-label={t('chrome.board')}>
        {presenting ? (
          <span className="live">{t('chrome.presenting')}</span>
        ) : (
        <>
        {collab && (
          <span className="live" data-testid="collab-status" data-status={link} title={linkDetail ?? collab.label}>
            <span className="live-kind">{collab.label === 'Server' ? t('collab.server') : collab.label === 'Local' ? t('collab.local') : collab.label}</span>
            {liveText}
          </span>
        )}
        <Tip label={t('chrome.undo')}>
          <button type="button" className="tool" aria-label={t('chrome.undo')} disabled={!!readOnly || editor.past.length === 0} onClick={() => setEditor((state) => undo(state))}>
            <Icon name="undo" />
          </button>
        </Tip>
        <Tip label={t('chrome.redo')}>
          <button type="button" className="tool" aria-label={t('chrome.redo')} disabled={!!readOnly || editor.future.length === 0} onClick={() => setEditor((state) => redo(state))}>
            <Icon name="redo" />
          </button>
        </Tip>
        <Tip label={t('chrome.grid')}>
          <button
            type="button"
            className="tool"
            aria-label={t('chrome.grid')}
            aria-pressed={showGrid}
            onClick={() => {
              setShowGrid((value) => {
                localStorage.setItem('plume.view.grid', value ? '0' : '1');
                return !value;
              });
            }}
          >
            <Icon name="grid" />
          </button>
        </Tip>
        <Tip label={t('chrome.snap')}>
          <button
            type="button"
            className="tool"
            aria-label={t('chrome.snap')}
            aria-pressed={snapEnabled}
            onClick={() => {
              setSnapEnabled((value) => {
                localStorage.setItem('plume.view.snap', value ? '0' : '1');
                return !value;
              });
            }}
          >
            <Icon name="snap" />
          </button>
        </Tip>
        </>
        )}
        <Tip label={t('chrome.zoomOut')}>
          <button type="button" className="tool" aria-label={t('chrome.zoomOut')} onClick={() => zoom(1 / 1.1)}>
            <Icon name="zoom-out" />
          </button>
        </Tip>
        <Tip label={t('chrome.actual')}>
          <button type="button" className="zoom-label" aria-label={t('chrome.actual')} onClick={zoomReset}>
            {Math.round(doc.view.zoom * 100)}%
          </button>
        </Tip>
        <Tip label={t('chrome.fit')}>
          <button type="button" className="tool" aria-label={t('chrome.fit')} onClick={() => fit(selection.length ? selection : undefined)}>
            <Icon name="fit" />
          </button>
        </Tip>
        <Tip label={t('chrome.zoomIn')}>
          <button type="button" className="tool" aria-label={t('chrome.zoomIn')} onClick={() => zoom(1.1)}>
            <Icon name="zoom-in" />
          </button>
        </Tip>
        <Tip label={t('chrome.lang')}>
          <button
            type="button"
            className="tool lang-toggle"
            aria-label={t('chrome.lang')}
            onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')}
          >
            {language === 'zh' ? '中' : 'EN'}
          </button>
        </Tip>
        {presenting ? (
          <Tip label={t('chrome.exitPresent')}>
            <button type="button" className="tool" aria-label={t('chrome.exitPresent')} onClick={exitPresent}>
              <span className="tray-label">{t('chrome.exit')}</span>
            </button>
          </Tip>
        ) : (
        <>
        <ExportMenu
          gridDefault={showGrid}
          selectionCount={selection.length}
          onPng={(includeGrid) => void downloadBoardPng(editorRef.current.doc, includeGrid)}
          onSvg={() => downloadBoardSvg(editorRef.current.doc)}
          onSelection={() => downloadBoardSvg(editorRef.current.doc, expandGroups(editorRef.current.doc, selection))}
        />
        <Tip label={doc.theme === 'dark' ? t('chrome.themeLight') : t('chrome.themeDark')}>
          <button
            type="button"
            className="tool"
            data-testid="theme-toggle"
            aria-pressed={doc.theme === 'dark'}
            aria-label={doc.theme === 'dark' ? t('chrome.themeLight') : t('chrome.themeDark')}
            disabled={!!readOnly}
            onClick={() => change(setTheme(editorRef.current.doc, doc.theme === 'light' ? 'dark' : 'light'), 'commit')}
          >
            <Icon name={doc.theme === 'dark' ? 'sun' : 'moon'} />
          </button>
        </Tip>
        {selection.length > 0 && !readOnly && (
          <Tip label={t('chrome.delete')}>
            <button
              type="button"
              className="tool"
              aria-label={t('chrome.delete')}
              disabled={locked}
              onClick={() => {
                const current = editorRef.current.doc;
                change(deleteSelection(current, selection), 'commit');
                setSelection((ids) => ids.filter((id) => objectById(current, id)?.locked));
              }}
            >
              <Icon name="trash" />
            </button>
          </Tip>
        )}
        <Tip label={t('chrome.present')}>
          <button type="button" className="tool" aria-label={t('chrome.present')} onClick={enterPresent}>
            <Icon name="present" />
          </button>
        </Tip>
        </>
        )}
      </div>
      {!readOnly && !presenting && (
      <SelectionBar
        count={selection.length}
        locked={!!locked}
        grouped={grouped}
        onDuplicate={() => {
          const copy = duplicateObjects(editorRef.current.doc, selection);
          change(copy.doc, 'commit');
          setSelection(copy.ids);
        }}
        onOrder={(mode) => change(orderSelection(editorRef.current.doc, selection, mode), 'commit')}
        onAlign={(mode) => change(alignSelection(editorRef.current.doc, selection, mode), 'commit')}
        onDistribute={(axis) => change(distributeSelection(editorRef.current.doc, selection, axis), 'commit')}
        onGroup={() => change(groupSelection(editorRef.current.doc, selection).doc, 'commit')}
        onUngroup={() => change(ungroupSelection(editorRef.current.doc, selection), 'commit')}
        onLock={(next) => change(setLocked(editorRef.current.doc, selection, next), 'commit')}
      />
      )}
      {doc.objects.length === 0 && !editingBox && <p className="hint">{t('hint')}</p>}
      {editingBox && (
        <textarea
          className="text-editor"
          value={editingBox.text}
          aria-label={t('tool.text')}
          autoFocus
          style={{
            left: worldToScreen({ x: editingBox.cx - editingBox.width / 2, y: editingBox.cy - editingBox.height / 2 }, doc.view).x,
            top: worldToScreen({ x: editingBox.cx - editingBox.width / 2, y: editingBox.cy - editingBox.height / 2 }, doc.view).y,
            width: Math.max(40, editingBox.width * doc.view.zoom),
            height: Math.max(28, editingBox.height * doc.view.zoom),
            fontSize: Math.max(12, editingBox.fontSize * doc.view.zoom),
            fontWeight: editingBox.type === 'text' && editingBox.bold ? 600 : 400,
            textAlign: editingBox.type === 'text' ? (editingBox.align ?? 'left') : 'left',
            background: editingBox.type === 'sticky' ? editingBox.fill : undefined,
          }}
          onChange={(event) => {
            const text = event.target.value;
            let next = updateText(editorRef.current.doc, editingBox.id, text);
            if (editingBox.type === 'sticky') {
              next = setTextBox(next, editingBox.id, editingBox.width, measureStickyHeight(text, editingBox.width, editingBox.fontSize));
            } else {
              const measured = measureTextBox(text, editingBox.fontSize, editingBox.bold);
              next = setTextBox(next, editingBox.id, Math.max(editingBox.width, measured.width), measured.height);
            }
            change(next, 'transient');
          }}
          onBlur={() => {
            change(editorRef.current.doc, 'commit', editBase.current ?? undefined);
            editBase.current = null;
            setEditingId(null);
          }}
        />
      )}
      {!presenting && commentTarget?.type === 'comment' && (
        <CommentPanel
          comment={commentTarget}
          author={userName ?? ''}
          readOnly={readOnly}
          screen={worldToScreen({ x: commentTarget.cx, y: commentTarget.cy }, doc.view)}
          onAppend={(text) => change(appendComment(editorRef.current.doc, commentTarget.id, { text, author: userName }), 'commit')}
          onResolve={(resolved) => change(setCommentResolved(editorRef.current.doc, commentTarget.id, resolved), 'commit')}
        />
      )}
      {!presenting && (
        <Minimap
          doc={doc}
          viewport={frameSize}
          onView={(view) => change(setView(editorRef.current.doc, view), 'view')}
        />
      )}
      {!presenting && presenter && (
        <button
          type="button"
          className="follow"
          onClick={() => {
            if (!presenter.view) return;
            change(setView(editorRef.current.doc, presenter.view), 'view');
          }}
        >
          {presenter.name ? t('follow', { name: presenter.name }) : t('followAnon')}
        </button>
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

function imageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || 120, height: image.naturalHeight || 80 });
    image.onerror = () => reject(new Error('Image failed to load'));
    image.src = src;
  });
}
