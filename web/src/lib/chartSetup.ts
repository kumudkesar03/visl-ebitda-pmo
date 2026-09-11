import {
  Chart, CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Tooltip, Legend, Filler, BarController, LineController, DoughnutController,
} from 'chart.js';
import { CHART } from './vocabulary';

/**
 * Chart.js is registered once, and the defaults are set here rather than being
 * repeated per chart, so every chart in the application shares one visual
 * language: no gridlines on the category axis, hairline gridlines on the value
 * axis, no chart-level legend (the cards carry their own, which sit closer to
 * the data), and tooltips that state the unit.
 *
 * Registered piecewise rather than with registerables so the bundle carries
 * only the controllers actually used - this runs on a plant network.
 */
Chart.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement,
  Tooltip, Legend, Filler, BarController, LineController, DoughnutController,
);

Chart.defaults.font.family = '"Segoe UI", -apple-system, Roboto, Helvetica, Arial, sans-serif';
Chart.defaults.font.size = 11.5;
Chart.defaults.color = '#64748b';
Chart.defaults.plugins.legend.display = false;
Chart.defaults.maintainAspectRatio = false;
Chart.defaults.animation = { duration: 380 };

Object.assign(Chart.defaults.plugins.tooltip, {
  backgroundColor: '#0a1b33',
  titleFont: { size: 12, weight: 600 },
  bodyFont: { size: 12 },
  padding: 10,
  cornerRadius: 6,
  displayColors: true,
  boxWidth: 9,
  boxHeight: 9,
  boxPadding: 4,
});

// The unit belongs in the tooltip, not repeated on every axis tick.
Chart.defaults.plugins.tooltip.callbacks.label = function label(ctx: any) {
  const v = ctx.parsed?.y ?? ctx.parsed;
  if (typeof v !== 'number') return ctx.dataset?.label || '';
  return `${ctx.dataset.label}: Rs ${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Cr`;
};

/** Shared axis configuration for a money chart. */
export const moneyScales = (opts: { stacked?: boolean } = {}) => ({
  x: {
    stacked: opts.stacked ?? false,
    grid: { display: false },
    border: { color: CHART.grid },
    ticks: { color: CHART.axis, font: { size: 11 } },
  },
  y: {
    stacked: opts.stacked ?? false,
    beginAtZero: true,
    grid: { color: CHART.grid },
    border: { display: false },
    ticks: {
      color: CHART.axis,
      font: { size: 11 },
      // The unit is stated once on the axis, never repeated per tick.
      callback: (v: any) => Number(v).toLocaleString('en-IN'),
    },
  },
});

export { Chart };
