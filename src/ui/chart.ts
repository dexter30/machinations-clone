export interface Series {
  label: string;
  color: string;
  points: number[];
  /** Optional band (min/max) for batch runs. */
  dashed?: boolean;
}

const PALETTE = ['#2f6fdb', '#d63a3a', '#2e9e4f', '#ee8a1a', '#8e44ad', '#16a085', '#7f8c8d', '#c0392b', '#1b1b1b'];
export const seriesColor = (i: number) => PALETTE[i % PALETTE.length];

export function drawChart(canvas: HTMLCanvasElement, legend: HTMLElement, series: Series[], title = '') {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const g = canvas.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  const padL = 44;
  const padR = 12;
  const padT = 18;
  const padB = 22;
  const n = Math.max(2, ...series.map((s) => s.points.length));
  let lo = 0;
  let hi = 1;
  for (const s of series) for (const v of s.points) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  hi = niceCeil(hi);
  const X = (i: number) => padL + (i / (n - 1)) * (w - padL - padR);
  const Y = (v: number) => padT + (1 - (v - lo) / (hi - lo || 1)) * (h - padT - padB);

  // axes & grid
  g.strokeStyle = '#e6e8ec';
  g.fillStyle = '#778';
  g.font = '10px system-ui, sans-serif';
  g.lineWidth = 1;
  for (let k = 0; k <= 4; k++) {
    const v = lo + ((hi - lo) * k) / 4;
    const y = Y(v);
    g.beginPath();
    g.moveTo(padL, y);
    g.lineTo(w - padR, y);
    g.stroke();
    g.fillText(fmtAxis(v), 4, y + 3);
  }
  const stepTicks = Math.min(10, n - 1);
  for (let k = 0; k <= stepTicks; k++) {
    const i = Math.round(((n - 1) * k) / stepTicks);
    g.fillText(String(i), X(i) - 4, h - 6);
  }
  if (title) {
    g.fillStyle = '#445';
    g.fillText(title, padL, 11);
  }
  if (series.length === 0) {
    g.fillStyle = '#99a';
    g.fillText('Tick "Show in chart" on pools / registers to plot them here.', padL + 10, h / 2);
  }

  for (const s of series) {
    g.strokeStyle = s.color;
    g.lineWidth = 2;
    g.setLineDash(s.dashed ? [4, 3] : []);
    g.beginPath();
    s.points.forEach((v, i) => (i === 0 ? g.moveTo(X(i), Y(v)) : g.lineTo(X(i), Y(v))));
    g.stroke();
  }
  g.setLineDash([]);

  legend.innerHTML = series
    .map((s) => `<span style="--c:${s.color}">${escapeHtml(s.label)}: ${fmtAxis(s.points[s.points.length - 1] ?? 0)}</span>`)
    .join('');
}

function niceCeil(v: number): number {
  if (v <= 1) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function fmtAxis(v: number): string {
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + 'k';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
