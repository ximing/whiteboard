export type Point = { x: number; y: number };

export type StrokePoint = Point & { pressure?: number };

export type ThemeName = 'light' | 'dark';

export type View = {
  panX: number;
  panY: number;
  zoom: number;
};

export type Tool =
  | 'pen'
  | 'highlighter'
  | 'eraser'
  | 'select'
  | 'pan'
  | 'rect'
  | 'ellipse'
  | 'triangle'
  | 'line'
  | 'arrow'
  | 'text'
  | 'sticky'
  | 'comment'
  | 'connector'
  | 'laser'
  | 'image';

export type PointerKind = 'pen' | 'mouse' | 'touch';

export type RoutedAction =
  | 'draw'
  | 'erase'
  | 'pan'
  | 'pinch'
  | 'select'
  | 'shape'
  | 'text'
  | 'sticky'
  | 'comment'
  | 'connector'
  | 'laser'
  | 'none';

export type ShapeKind = 'rect' | 'ellipse' | 'triangle' | 'line' | 'arrow';

type ObjBase = {
  id: string;
  /** Low paints first. High is hit first. */
  z: number;
  locked?: boolean;
  groupId?: string;
};

export type StrokeObj = ObjBase & {
  type: 'stroke';
  tool: 'pen' | 'highlighter';
  color: string;
  size: number;
  points: StrokePoint[];
};

export type ShapeObj = ObjBase & {
  type: 'shape';
  kind: ShapeKind;
  cx: number;
  cy: number;
  width: number;
  height: number;
  rotation: number;
  stroke: string;
  fill: string;
  strokeWidth: number;
  /** Triangle corners relative to the center, before `rotation`. */
  localVertices?: Point[];
};

export type TextObj = ObjBase & {
  type: 'text';
  cx: number;
  cy: number;
  width: number;
  height: number;
  rotation: number;
  text: string;
  color: string;
  fontSize: number;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
};

export type StickyObj = ObjBase & {
  type: 'sticky';
  cx: number;
  cy: number;
  width: number;
  height: number;
  rotation: number;
  text: string;
  /** Paper color. */
  fill: string;
  /** Ink color. */
  color: string;
  fontSize: number;
};

export type CommentMessage = {
  id: string;
  text: string;
  author: string;
  at: number;
};

/** A pin. `cx`/`cy` are the pin in world space. `targetId` follows that object when it moves. */
export type CommentObj = ObjBase & {
  type: 'comment';
  cx: number;
  cy: number;
  targetId?: string;
  resolved?: boolean;
  color: string;
  messages: CommentMessage[];
};

export type ImageObj = ObjBase & {
  type: 'image';
  cx: number;
  cy: number;
  width: number;
  height: number;
  rotation: number;
  mime: string;
  src: string;
};

export type ConnectorObj = ObjBase & {
  type: 'connector';
  fromId: string;
  toId: string;
  color: string;
  strokeWidth: number;
  route?: 'straight' | 'elbow' | 'curve';
  arrow?: 'none' | 'end' | 'both';
  label?: string;
  fromSide?: 'auto' | 'top' | 'right' | 'bottom' | 'left';
  toSide?: 'auto' | 'top' | 'right' | 'bottom' | 'left';
};

export type BoardObject = StrokeObj | ShapeObj | TextObj | StickyObj | ImageObj | ConnectorObj | CommentObj;

export type Document = {
  version: 1;
  rev: number;
  theme: ThemeName;
  view: View;
  objects: BoardObject[];
};

/** One reversible change. Concurrent steps rebase through `mapStep`. */
export type Step =
  | { type: 'add'; object: BoardObject }
  | { type: 'delete'; object: BoardObject }
  | { type: 'update'; id: string; before: BoardObject; after: BoardObject }
  | { type: 'theme'; before: ThemeName; after: ThemeName };

/** Inverse steps that undo one local transaction. */
export type HistoryEvent = { steps: Step[] };

/**
 * Confirmed authority version, plus local steps not yet accepted.
 * `confirmed` is the document at `version`, before `unconfirmed`.
 */
export type CollabState = {
  version: number;
  confirmed: Document;
  unconfirmed: Step[];
};

export type EditorState = {
  doc: Document;
  past: HistoryEvent[];
  future: HistoryEvent[];
  collab: CollabState;
};

export type Frame = {
  cx: number;
  cy: number;
  width: number;
  height: number;
  rotation: number;
};

export type InkStyle = {
  color: string;
  size: number;
};

export type ShapeStyle = {
  stroke: string;
  fill: string;
  strokeWidth: number;
};

export type StylePatch = {
  color?: string;
  fill?: string;
  strokeWidth?: number;
  size?: number;
  fontSize?: number;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  route?: 'straight' | 'elbow' | 'curve';
  arrow?: 'none' | 'end' | 'both';
  label?: string;
  fromSide?: 'auto' | 'top' | 'right' | 'bottom' | 'left';
  toSide?: 'auto' | 'top' | 'right' | 'bottom' | 'left';
};
