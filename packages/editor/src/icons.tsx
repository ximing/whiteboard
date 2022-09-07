import {
  ArrowUpRight,
  Circle,
  Eraser,
  GripHorizontal,
  GripVertical,
  Hand,
  Highlighter,
  Image,
  Moon,
  MousePointer2,
  Pen,
  Redo2,
  Slash,
  Spline,
  Square,
  Sun,
  Trash2,
  Triangle,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  select: MousePointer2,
  pen: Pen,
  highlighter: Highlighter,
  eraser: Eraser,
  pan: Hand,
  rect: Square,
  ellipse: Circle,
  triangle: Triangle,
  line: Slash,
  arrow: ArrowUpRight,
  text: Type,
  connector: Spline,
  image: Image,
  undo: Undo2,
  redo: Redo2,
  sun: Sun,
  moon: Moon,
  'zoom-in': ZoomIn,
  'zoom-out': ZoomOut,
  trash: Trash2,
  'grip-vertical': GripVertical,
  'grip-horizontal': GripHorizontal,
};

export function Icon({ name }: { name: string }) {
  const Glyph = ICONS[name];
  if (!Glyph) return null;
  return <Glyph size={18} strokeWidth={1.8} aria-hidden />;
}
