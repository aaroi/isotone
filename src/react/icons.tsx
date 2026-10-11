import {
  ArrowUp, Check, ChevronDown, Crosshair, Gem, MessageSquare,
  RotateCcw, SlidersHorizontal, Trash2, X,
} from 'lucide-react';

const icons = {
  close: X, chevron: ChevronDown, message: MessageSquare,
  sliders: SlidersHorizontal, pin: Crosshair, send: ArrowUp,
  reset: RotateCcw, trash: Trash2, check: Check, iterate: Gem,
};

/** One optical size and stroke across the dock, menus and composer. */
export function Icon({ name, size = 16 }: { name: keyof typeof icons; size?: number }) {
  const Component = icons[name];
  return <Component size={size} strokeWidth={1.75} aria-hidden="true" />;
}
