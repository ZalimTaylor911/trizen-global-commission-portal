import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Sizes a chart from its own container, and renders nothing until it knows the
 * width.
 *
 * Recharts' own `ResponsiveContainer` measures with a ResizeObserver, and for a
 * chart that is already laid out when it mounts that observation can come back
 * as zero and never fire again — the size never *changes*, so there is no second
 * callback. The result is a correctly sized container with an empty SVG inside
 * it, which looks exactly like a chart with no data.
 *
 * Measuring in `useLayoutEffect` happens synchronously after the DOM node
 * exists but before paint, so the first render already has a real width.
 */
export default function ChartFrame({
  height = 260,
  children,
}: {
  height?: number;
  children: (size: { width: number; height: number }) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const measure = () => setWidth(element.clientWidth);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ width: '100%', height }}>
      {width > 0 ? children({ width, height }) : null}
    </div>
  );
}
