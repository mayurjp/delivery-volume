import { BarChart, CandlestickChart, HeatmapChart, LineChart } from 'echarts/charts';
import {
  CalendarComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
  VisualMapComponent,
  AxisPointerComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  BarChart,
  CandlestickChart,
  HeatmapChart,
  LineChart,
  CalendarComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
  VisualMapComponent,
  AxisPointerComponent,
  CanvasRenderer,
]);

export { echarts };
export type EChartsOption = echarts.EChartsCoreOption;
