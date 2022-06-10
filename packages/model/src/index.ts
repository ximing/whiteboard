export { adoptSnapshot, authorityReceive, confirmSteps, followRoom, noteLocalSteps, receiveSteps, seedRoom, stepsSince } from './collab';
export type { AuthorityResult, RoomLog } from './collab';
export { applyStep, diffSteps, invertStep, mapStep, rebaseSteps } from './step';
export type { StepResult } from './step';
export { createId } from './id';
export { normalizePointerType, routePointer } from './input';
export { recognizeShape, shapeFromRecognition } from './recognize';
export { deserialize, serialize } from './serialize';
export { strokeOutline } from './stroke';
export { highlighterDefault, penDefault, STORAGE_KEY, themeColors } from './theme';
export type { RecognizedShape } from './recognize';
export {
  bboxOf,
  clamp,
  dist,
  localToWorld,
  panView,
  pointInTriangle,
  pointSegmentDistance,
  polylineNear,
  rotatePoint,
  screenToWorld,
  segmentDistance,
  worldToLocal,
  worldToScreen,
  zoomView,
} from './geometry';
export {
  addConnector,
  addObject,
  anchorPoint,
  applyEraser,
  centerOf,
  commit,
  commitFreehand,
  connectorEndpoints,
  createDocument,
  createEditor,
  deleteSelection,
  dragHandle,
  frameOf,
  hitTest,
  lineEndpoints,
  lineFromPoints,
  makeImage,
  makeStroke,
  makeText,
  moveSelection,
  objectById,
  objectsInRect,
  redo,
  resizeSelection,
  rotateSelection,
  scaleSelection,
  setLineEndpoint,
  setTheme,
  setView,
  shapeFromBox,
  shapeKindForTool,
  triangleVertices,
  undo,
  updateText,
} from './document';
export type { BoxHandle } from './document';
export type {
  BoardObject,
  ConnectorObj,
  Document,
  CollabState,
  EditorState,
  Frame,
  HistoryEvent,
  ImageObj,
  InkStyle,
  Point,
  PointerKind,
  RoutedAction,
  ShapeKind,
  ShapeObj,
  ShapeStyle,
  Step,
  StrokeObj,
  StrokePoint,
  TextObj,
  ThemeName,
  Tool,
  View,
} from './types';
