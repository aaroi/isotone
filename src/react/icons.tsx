import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, ChevronRight, CornerDownRight, CornerLeftUp,
  Crosshair, Gem, MessageSquare, PencilRuler, Redo2, RotateCcw, SlidersHorizontal, TextAlignCenter,
  TextAlignEnd, TextAlignJustify, TextAlignStart, Trash2, Undo2, X,
} from 'lucide-react';

const icons = {
  close: X, chevron: ChevronDown, message: MessageSquare,
  sliders: SlidersHorizontal, pin: Crosshair, send: ArrowUp,
  reset: RotateCcw, trash: Trash2, check: Check, iterate: Gem,
  // The experimental style editor.
  style: PencilRuler, undo: Undo2, redo: Redo2, parent: CornerLeftUp, child: CornerDownRight,
  crumb: ChevronRight, 'text-left': TextAlignStart, 'text-center': TextAlignCenter,
  'text-right': TextAlignEnd, 'text-justify': TextAlignJustify,
  'dir-row': ArrowRight, 'dir-column': ArrowDown, 'dir-row-reverse': ArrowLeft, 'dir-column-reverse': ArrowUp,
};
export type IconName = keyof typeof icons;

/** One optical size and stroke across the dock, menus and composer. */
export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const Component = icons[name];
  return <Component size={size} strokeWidth={1.75} aria-hidden="true" />;
}
