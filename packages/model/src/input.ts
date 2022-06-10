import type { PointerKind, RoutedAction, Tool } from './types';

export function normalizePointerType(pointerType: string): PointerKind {
  if (pointerType === 'pen') return 'pen';
  if (pointerType === 'touch') return 'touch';
  return 'mouse';
}

function actionForTool(tool: Tool, penNeverPans: boolean): RoutedAction {
  switch (tool) {
    case 'pen':
    case 'highlighter':
      return 'draw';
    case 'eraser':
      return 'erase';
    case 'select':
      return 'select';
    case 'pan':
      return penNeverPans ? 'draw' : 'pan';
    case 'rect':
    case 'ellipse':
    case 'triangle':
    case 'line':
    case 'arrow':
      return 'shape';
    case 'text':
      return 'text';
    case 'connector':
      return 'connector';
    case 'image':
      return 'none';
    default:
      return 'none';
  }
}

/**
 * Touch never inks. A stylus never pans: the pan tool still draws.
 * Mouse follows the active tool. The middle button pans.
 */
export function routePointer(input: {
  pointerType: PointerKind;
  tool: Tool;
  pointerCount?: number;
  button?: number;
}): RoutedAction {
  const count = input.pointerCount ?? 1;
  if (input.pointerType === 'touch') {
    return count >= 2 ? 'pinch' : 'pan';
  }
  if (input.pointerType === 'pen') {
    return actionForTool(input.tool, true);
  }
  if (input.button === 1) return 'pan';
  return actionForTool(input.tool, false);
}
