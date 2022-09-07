import {
  cloneElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';

type TipProps = {
  label: string;
  children: ReactElement<{ 'aria-describedby'?: string }>;
};

type Spot = { top: number; left: number };

const SHOW_DELAY = 280;
const GAP = 10;
const MARGIN = 8;

/**
 * Hover and focus label for an icon button. The bubble is portaled so a
 * scrolling tool dock cannot clip it. The anchor keeps pointer events.
 */
export function Tip({ label, children }: TipProps) {
  const [open, setOpen] = useState(false);
  const [spot, setSpot] = useState<Spot | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();

  function hide() {
    clearTimeout(timer.current);
    setOpen(false);
    setSpot(null);
  }

  function show(immediate: boolean) {
    clearTimeout(timer.current);
    const delay = immediate || window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : SHOW_DELAY;
    timer.current = setTimeout(() => setOpen(true), delay);
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const tip = tipRef.current;
    if (!anchor || !tip) return;
    const place = () => {
      const host = anchor.getBoundingClientRect();
      const bubble = tip.getBoundingClientRect();
      setSpot(chooseSpot(host, bubble));
    };
    place();
    window.addEventListener('resize', hide);
    window.addEventListener('scroll', hide, true);
    return () => {
      window.removeEventListener('resize', hide);
      window.removeEventListener('scroll', hide, true);
    };
  }, [open, label]);

  return (
    <span
      ref={anchorRef}
      className="tip-anchor"
      onMouseEnter={() => show(false)}
      onMouseLeave={hide}
      onFocus={() => show(true)}
      onBlur={hide}
    >
      {cloneElement(children, { 'aria-describedby': open ? id : undefined })}
      {open &&
        createPortal(
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            className="tip"
            style={spot ? { top: spot.top, left: spot.left } : { top: 0, left: 0, visibility: 'hidden' }}
          >
            {label}
          </div>,
          document.body,
        )}
    </span>
  );
}

function chooseSpot(host: DOMRect, bubble: DOMRect): Spot {
  const viewWidth = window.innerWidth;
  const viewHeight = window.innerHeight;
  const candidates = [
    { top: host.top + host.height / 2 - bubble.height / 2, left: host.right + GAP },
    { top: host.bottom + GAP, left: host.left + host.width / 2 - bubble.width / 2 },
    { top: host.top - GAP - bubble.height, left: host.left + host.width / 2 - bubble.width / 2 },
    { top: host.top + host.height / 2 - bubble.height / 2, left: host.left - GAP - bubble.width },
  ];
  const order = host.left < 120 ? [0, 1, 2, 3] : host.top < 96 ? [1, 3, 0, 2] : host.bottom > viewHeight - 96 ? [2, 0, 3, 1] : [0, 1, 2, 3];
  for (const index of order) {
    const spot = contain(candidates[index], bubble, viewWidth, viewHeight);
    if (!covers(spot, host, bubble)) return spot;
  }
  return contain(candidates[order[0]], bubble, viewWidth, viewHeight);
}

function contain(spot: Spot, bubble: DOMRect, viewWidth: number, viewHeight: number): Spot {
  return {
    top: clamp(spot.top, MARGIN, viewHeight - bubble.height - MARGIN),
    left: clamp(spot.left, MARGIN, viewWidth - bubble.width - MARGIN),
  };
}

function covers(spot: Spot, host: DOMRect, bubble: DOMRect): boolean {
  const right = spot.left + bubble.width;
  const bottom = spot.top + bubble.height;
  return spot.left < host.right && right > host.left && spot.top < host.bottom && bottom > host.top;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
