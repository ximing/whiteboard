import getStroke from 'perfect-freehand';
import type { StrokePoint } from './types';

function pressureIsReported(points: StrokePoint[]): boolean {
  return points.some((point) => typeof point.pressure === 'number');
}

/**
 * Outline of a stroke in world space.
 * Reported pressure changes width. Samples with no pressure stay a constant width
 * (velocity is not turned into fake pressure).
 */
export function strokeOutline(points: StrokePoint[], size: number): number[][] {
  if (points.length === 0 || size <= 0) return [];
  const pressured = pressureIsReported(points);
  const input = points.map((point) => [point.x, point.y, pressured ? (point.pressure as number) : 0.5]);
  return getStroke(input, {
    size,
    thinning: pressured ? 0.7 : 0,
    smoothing: 0.5,
    streamline: 0,
    simulatePressure: false,
    easing: (t) => t,
    start: { cap: true, taper: 0, easing: (t) => t },
    end: { cap: true, taper: 0, easing: (t) => t },
  });
}
