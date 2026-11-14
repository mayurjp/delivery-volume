import { useEffect, useRef } from 'react';
import { useDark } from '../lib/theme';
import { echarts, type EChartsOption } from './echarts';

interface Props {
  option: EChartsOption;
  /** Fixed pixel height, so the layout does not shift while loading. */
  height: number;
  className?: string;
  ariaLabel?: string;
  /** Called with the clicked data item (series data entry). */
  onItemClick?: (data: unknown) => void;
}

/** The single ECharts wrapper: init, theme switch, resize and dispose. */
export default function EChart({ option, height, className, ariaLabel, onItemClick }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const dark = useDark();
  const click = useRef(onItemClick);
  useEffect(() => {
    click.current = onItemClick;
  });

  useEffect(() => {
    if (!el.current) return;
    const c = echarts.init(el.current, dark ? 'dark' : undefined, { renderer: 'canvas' });
    chart.current = c;
    c.on('click', (e: unknown) => click.current?.((e as { data?: unknown }).data));
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, [dark]);

  useEffect(() => {
    chart.current?.setOption({ backgroundColor: 'transparent', animation: false, ...option }, true);
  }, [option, dark]);

  return (
    <div ref={el} className={className} style={{ height, width: '100%' }} role="img" aria-label={ariaLabel} />
  );
}
