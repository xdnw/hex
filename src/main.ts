type Mock = { x: number[]; series: number[][] };
type MockSeries = { name: string; values: number[] };
type MockData = { values: number[]; series: MockSeries[] };

const canvas = document.getElementById('main') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const hexSizeEl = document.getElementById('hexSize') as HTMLInputElement;
const hexSizeLabel = document.getElementById('hexSizeLabel') as HTMLSpanElement;
const seriesCountEl = document.getElementById('seriesCount') as HTMLInputElement;
const regenBtn = document.getElementById('regen') as HTMLButtonElement;
const downloadBtn = document.getElementById('download') as HTMLButtonElement;
const mockDataEl = document.getElementById('mockData') as HTMLTextAreaElement;
const toggleBtn = document.getElementById('toggleView') as HTMLButtonElement;
const smoothPercentEl = document.getElementById('smoothPercent') as HTMLInputElement;
const smoothPercentLabel = document.getElementById('smoothPercentLabel') as HTMLSpanElement;
let showHex = false;

// New UI elements for global order
const globalOrderEl = document.getElementById('globalOrder') as HTMLDivElement | null;
const resetOrderBtn = document.getElementById('resetOrder') as HTMLButtonElement | null;

// user-defined order (null = follow computed globalOrder)
let userOrder: number[] | null = null;

// App state
let rawData: MockData | null = null;     // As in textarea
let seriesNames: string[] = [];            // Names from rawData
let graphData: Mock | null = null;         // Transformed for chart

type HexCell = { poly: [number, number][], cx: number, cy: number, series: number, counts: number[], samples: number, bbox?: { minX: number, minY: number, maxX: number, maxY: number } };
let hexCells: HexCell[] = [];
let tooltipEl: HTMLDivElement | null = null;

function ensureTooltip(): HTMLDivElement {
    if (tooltipEl) return tooltipEl;
    const el = document.createElement('div');
    el.style.position = 'fixed';
    el.style.zIndex = '9999';
    el.style.pointerEvents = 'none';
    el.style.background = 'rgba(0, 0, 0, 0.75)';
    el.style.color = '#cfe8ff';
    el.style.padding = '6px 8px';
    el.style.borderRadius = '4px';
    el.style.font = '12px Inter, Arial, sans-serif';
    el.style.whiteSpace = 'nowrap';
    el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
    el.style.backdropFilter = 'blur(2px)';
    el.style.display = 'none';
    document.body.appendChild(el);
    tooltipEl = el;
    return el;
}
function showTooltipAt(clientX: number, clientY: number, html: string) {
    const el = ensureTooltip();
    el.innerHTML = html;
    el.style.display = 'block';
    const pad = 12;
    let left = clientX + pad;
    let top = clientY + pad;
    // keep in viewport
    const { innerWidth, innerHeight } = window;
    const rect = el.getBoundingClientRect();
    if (left + rect.width + 8 > innerWidth) left = Math.max(8, innerWidth - rect.width - 8);
    if (top + rect.height + 8 > innerHeight) top = Math.max(8, innerHeight - rect.height - 8);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
}
function hideTooltip() {
    if (tooltipEl) tooltipEl.style.display = 'none';
}

///

function createOffscreen(w: number, h: number): HTMLCanvasElement {
    return Object.assign(document.createElement('canvas'), { width: w, height: h }) as HTMLCanvasElement;
}

// -------- Mock data generation (for Regenerate button) --------

function randomName(i: number) {
    const names = [
        "Rose",
        "Tulip",
        "Daffodil",
        "Lily",
        "Orchid",
        "Sunflower",
        "Daisy",
        "Marigold",
        "Peony",
        "Iris",
        "Lavender",
        "Carnation",
        "Chrysanthemum",
        "Gardenia",
        "Hydrangea"
    ];
    return names[i % names.length];
}

// Generates a  with internal consistency (all series share the same values length).
function generateMock(seriesCount: number, valuesLen?: number): MockData {
    const L = valuesLen ?? (25 + Math.floor(Math.random() * 25));
    const startValue = 1;
    const values = Array.from({ length: L }, (_, i) => startValue + i);

    const series: MockSeries[] = [];
    for (let s = 0; s < seriesCount; s++) {
        const base = Math.random() * 0.5 + 0.2 + s * 0.03;
        const phase = Math.random() * Math.PI * 2;
        const freq = 3 + Math.random() * 4;
        const arr = values.map((_, i) => {
            const t = i / Math.max(1, L - 1);
            // positive values; mild waviness + noise
            return Math.max(0, base + 0.7 * Math.abs(Math.sin(t * freq + phase)) + 0.25 * (Math.random() - 0.5));
        });
        series.push({ name: randomName(s), values: arr });
    }

    return { values, series };
}

// Data transforms

function transformToMock(data: MockData): { mock: Mock; names: string[] } {
    // Validate
    if (!data || !Array.isArray(data.values) || !Array.isArray(data.series) || data.series.length === 0) {
        throw new Error('Invalid MockData: missing values/series.');
    }
    const L = data.values.length;
    for (const s of data.series) {
        if (!Array.isArray(s.values) || s.values.length !== L) {
            throw new Error('Invalid MockData: each series.values length must equal values length.');
        }
    }

    // Use original samples directly; compute non-negative values and normalize across series per-sample
    const sCount = data.series.length;
    const seriesVals: number[][] = data.series.map(s => s.values.map(v => Math.max(0, v)));

    const seriesNorm: number[][] = Array.from({ length: sCount }, () => new Array(L).fill(0));
    for (let i = 0; i < L; i++) {
        let sum = 0;
        for (let s = 0; s < sCount; s++) sum += seriesVals[s][i];
        if (sum <= 0) {
            const v = 1 / sCount;
            for (let s = 0; s < sCount; s++) seriesNorm[s][i] = v;
        } else {
            for (let s = 0; s < sCount; s++) seriesNorm[s][i] = seriesVals[s][i] / sum;
        }
    }

    // Use simple integer x positions (0..L-1); rendering uses data.x.length only
    const mockX = Array.from({ length: L }, (_, i) => i);
    return {
        mock: { x: mockX, series: seriesNorm },
        names: data.series.map(s => s.name),
    };
}


// -------- Colors --------

function hslToHex(h: number, s: number, l: number): string {
    // h: [0,360), s: [0,1], l: [0,1]
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hp = h / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r = 0, g = 0, b = 0;
    if (hp >= 0 && hp < 1) [r, g, b] = [c, x, 0];
    else if (hp < 2) [r, g, b] = [x, c, 0];
    else if (hp < 3) [r, g, b] = [0, c, x];
    else if (hp < 4) [r, g, b] = [0, x, c];
    else if (hp < 5) [r, g, b] = [x, 0, c];
    else[r, g, b] = [c, 0, x];
    const m = l - c / 2;
    const to255 = (v: number) => Math.round((v + m) * 255);
    const rr = to255(r).toString(16).padStart(2, '0');
    const gg = to255(g).toString(16).padStart(2, '0');
    const bb = to255(b).toString(16).padStart(2, '0');
    return `#${rr}${gg}${bb}`;
}

function getColors(n: number): string[] {
    // Modern/stylish palette for small counts (8 or fewer)
    const stylish = [
        '#2563eb', // blue
        '#7c3aed', // violet
        '#ec4899', // pink
        '#ef4444', // red
        '#f59e0b', // amber
        '#10b981', // green
        '#06b6d4', // teal
        '#374151'  // slate (neutral)
    ];

    if (n <= stylish.length) return stylish.slice(0, n);

    // For larger n, start with the stylish base then generate distinct hues
    const result = [...stylish];
    const golden = 137.508; // golden angle in degrees
    const baseOffset = 0; // deterministic; change to Math.random()*360 if you want random seed

    for (let i = stylish.length; i < n; i++) {
        const idx = i - stylish.length;
        const h = (baseOffset + idx * golden) % 360;

        // Vary saturation/lightness lightly to reduce near-duplicates
        // Cycle through small variations so adjacent generated colors differ
        const satVariants = [0.60, 0.66, 0.54];
        const lightVariants = [0.52, 0.58, 0.46, 0.40];
        const s = satVariants[idx % satVariants.length];
        const l = lightVariants[idx % lightVariants.length];

        result.push(hslToHex(h, s, l));
    }

    return result;
}
// -------- Drawing --------

function drawStackedArea(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    data: Mock,
    colors: string[]
) {
    ctx.clearRect(0, 0, w, h);
    const points = data.x.length;
    const pad = 20;
    const xs = data.x.map((_, i) => (i / (points - 1)) * (w - pad * 2) + pad);
    const sCount = data.series.length;
    const cumulative: number[][] = Array.from({ length: sCount }, () => Array(points).fill(0));

    for (let i = 0; i < points; i++) {
        let cum = 0;
        for (let s = 0; s < sCount; s++) {
            cum += data.series[s]?.[i] ?? 0;
            cumulative[s][i] = cum;
        }
    }

    for (let s = sCount - 1; s >= 0; s--) {
        ctx.beginPath();
        for (let i = 0; i < points; i++) {
            const px = xs[i];
            const py = h - (cumulative[s][i] * (h - pad * 2) + pad);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        for (let i = points - 1; i >= 0; i--) {
            const px = xs[i];
            const bottomValue = s > 0 ? cumulative[s - 1][i] : 0;
            const py = h - (bottomValue * (h - pad * 2) + pad);
            ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = colors[s % colors.length];
        ctx.fill();
    }

    // Draw axes, ticks and labels
    drawAxes(ctx, w, h, pad, rawData?.values);
}

// New helper for axes/ticks/labels
function drawAxes(ctx: CanvasRenderingContext2D, w: number, h: number, pad: number, values?: number[]) {
    // Axes
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, pad);
    ctx.lineTo(pad, h - pad);
    ctx.lineTo(w - pad, h - pad);
    ctx.stroke();

    // Ticks and labels
    ctx.save();
    ctx.font = '8px Inter, Arial';
    ctx.fillStyle = '#cfe8ff';
    ctx.textBaseline = 'top';

    // X-axis ticks (values if available)
    const xTicks = 5;
    for (let i = 0; i <= xTicks; i++) {
        const t = i / xTicks;
        const x = pad + t * (w - pad * 2);
        // tick
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.beginPath();
        ctx.moveTo(x, h - pad);
        ctx.lineTo(x, h - pad + 5);
        ctx.stroke();
        // label
        let label = '';
        if (values && values.length > 0) {
            const yi = Math.round(t * (values.length - 1));
            label = String(values[yi]);
        } else {
            label = (t * 100).toFixed(0) + '%';
        }
        const tw = ctx.measureText(label).width;
        ctx.fillText(label, x - tw / 2, h - pad + 7);
    }

    // Y-axis ticks (0%..100%)
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    const yVals = [0, 0.25, 0.5, 0.75, 1];
    for (const v of yVals) {
        const y = h - (v * (h - pad * 2) + pad);
        // grid line (optional)
        ctx.strokeStyle = v === 0 || v === 1 ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)';
        ctx.beginPath();
        ctx.moveTo(pad - 4, y);
        ctx.lineTo(pad, y);
        ctx.stroke();
        const label = `${Math.round(v * 100)}%`;
        ctx.fillStyle = '#cfe8ff';
        ctx.fillText(label, pad, y);
    }
    ctx.restore();
}

const HEX_GAP = 0.5;

function hexPolygon(cx: number, cy: number, r: number): [number, number][] {
    // Draw a slightly smaller hex so adjacent hexes show a gap.
    const innerR = Math.max(0, r - HEX_GAP);
    const pts: [number, number][] = [];
    for (let i = 0; i < 6; i++) {
        const angle = ((60 * i - 30) * Math.PI) / 180;
        pts.push([cx + innerR * Math.cos(angle), cy + innerR * Math.sin(angle)]);
    }
    return pts;
}
function hexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
    const pts = hexPolygon(cx, cy, r);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
}

function pointInPoly(x: number, y: number, poly: [number, number][]) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[j];
        const intersect = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
        if (intersect) inside = !inside;
    }
    return inside;
}

// -------- Render (uses transformed state only) --------

function movingAverage(arr: number[], windowSamples: number): number[] {
    const n = arr.length;
    if (windowSamples <= 1) return arr.slice();
    const half = Math.floor(windowSamples / 2);
    const pref = new Array(n + 1).fill(0);
    for (let i = 0; i < n; i++) pref[i + 1] = pref[i] + (arr[i] ?? 0);
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
        const start = Math.max(0, i - half);
        const end = Math.min(n - 1, i + half);
        const sum = pref[end + 1] - pref[start];
        out[i] = sum / (end - start + 1);
    }
    return out;
}

// Blur/soften a distribution table across neighboring columns (radius in columns)
function smoothDistTable(dist: number[][], radius: number): number[][] {
    if (radius <= 0) return dist.map(c => c.slice());
    const cols = dist.length;
    const sCount = dist[0]?.length ?? 0;
    const out: number[][] = Array.from({ length: cols }, () => new Array(sCount).fill(0));
    for (let c = 0; c < cols; c++) {
        const start = Math.max(0, c - radius);
        const end = Math.min(cols - 1, c + radius);
        const span = end - start + 1;
        for (let s = 0; s < sCount; s++) {
            let sum = 0;
            for (let k = start; k <= end; k++) sum += dist[k]?.[s] ?? 0;
            out[c][s] = sum / span;
        }
    }
    return out;
}

// Aggregate normalized series into per-hex-column distributions.
// When shiftHalfBin=true, bins are computed with a half-bin offset to match staggered rows.
function aggregateBins(data: Mock, columns: number, shiftHalfBin: boolean): number[][] {
    const sCount = data.series.length;
    const points = data.x.length;
    const bins: number[][] = Array.from({ length: columns }, () => new Array(sCount).fill(0));
    const binSize = points / columns;
    const offset = shiftHalfBin ? binSize * 0.5 : 0;

    for (let b = 0; b < columns; b++) {
        const startF = b * binSize + offset;
        const endF = (b + 1) * binSize + offset;
        const start = Math.max(0, Math.floor(startF));
        const end = Math.min(points, Math.ceil(endF));

        for (let i = start; i < end; i++) {
            for (let s = 0; s < sCount; s++) {
                const v = Math.max(0, data.series[s][i] ?? 0);
                bins[b][s] += v;
            }
        }
        // Normalize distribution for this bin
        let sum = 0;
        for (let s = 0; s < sCount; s++) sum += bins[b][s];
        if (sum <= 0) {
            const v = 1 / sCount;
            for (let s = 0; s < sCount; s++) bins[b][s] = v;
        } else {
            for (let s = 0; s < sCount; s++) bins[b][s] /= sum;
        }
    }
    return bins;
}

// Compute a stable global series order (largest overall share at the bottom)
function computeGlobalOrder(binsEven: number[][], binsOdd: number[][], sCount: number): number[] {
    const totals = new Array(sCount).fill(0);
    const addBins = (bins: number[][]) => {
        for (let c = 0; c < bins.length; c++) {
            const col = bins[c] || [];
            for (let s = 0; s < sCount; s++) totals[s] += col[s] || 0;
        }
    };
    addBins(binsEven);
    addBins(binsOdd);
    return Array.from({ length: sCount }, (_, i) => i).sort((a, b) => totals[b] - totals[a]);
}

// Build per-column vertical allocations using a fixed series order,
// so each series stays on the same side (stacked bottom->top in 'order').
function buildAllocations(distTable: number[][], rowsForParity: number, order: number[]): number[][] {
    const cols = distTable.length;
    const sCount = order.length;
    const allocations: number[][] = new Array(cols);

    for (let c = 0; c < cols; c++) {
        const dist = distTable[c] ?? [];
        // Normalize defensively
        const raw = new Array(sCount).fill(0).map((_, i) => Math.max(0, dist[i] ?? 0));
        let sum = raw.reduce((a, b) => a + b, 0);
        const shares = sum > 0 ? raw.map(v => v / sum) : new Array(sCount).fill(1 / Math.max(1, sCount));

        // Reorder shares according to the fixed global order (bottom -> top)
        const sharesOrdered = order.map(s => shares[s]);

        // Cumulative from bottom to top
        const cum: number[] = new Array(sCount);
        let acc = 0;
        for (let i = 0; i < sCount; i++) {
            acc += sharesOrdered[i];
            cum[i] = acc;
        }
        // Guard against numeric drift
        cum[sCount - 1] = 1;

        // For each row (top to bottom), pick the series whose cumulative interval covers it.
        const colAlloc = new Array<number>(rowsForParity);
        for (let r = 0; r < rowsForParity; r++) {
            const yFromTop = (r + 0.5) / Math.max(1, rowsForParity); // (0,1]
            const yFromBottom = 1 - yFromTop;                         // [0,1)
            let k = 0;
            while (k < sCount - 1 && yFromBottom > cum[k]) k++;
            colAlloc[r] = order[k];
        }
        allocations[c] = colAlloc;
    }
    return allocations;
}

function drawLegend(ctx: CanvasRenderingContext2D, x: number, y: number, colors: string[], names: string[]) {
    ctx.font = '13px Inter, Arial';
    for (let s = 0; s < colors.length; s++) {
        ctx.fillStyle = colors[s];
        ctx.fillRect(x, y + s * 22, 16, 12);
        ctx.fillStyle = '#cfe8ff';
        const label = names[s] || `Series ${s + 1}`;
        ctx.fillText(label, x + 22, y + s * 22 + 10);
    }
}

let cachedColors: string[] = []; // cache colors for current series count

let renderQueued = false;
function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    window.requestAnimationFrame(() => { renderQueued = false; render(); });
}

// build a mapping col,row -> chosen series from allocations (precompute outside mouse loop)
function buildCellMap(cols: number, rows: number, startXEven: number, hexWidth: number, firstY: number, vertStep: number, allocEven: number[][], allocOdd: number[][]) {
    // include col index on each entry so we can look up distTable later
    const cellMap: { x: number, y: number, series: number, col: number }[][] = Array.from({ length: rows }, () => []);
    for (let row = 0; row < rows; row++) {
        const y = firstY + row * vertStep;
        const isEven = (row % 2 === 0);
        const startX = isEven ? startXEven : (startXEven + hexWidth / 2);
        const rowInParity = Math.floor(row / 2);
        const allocTable = isEven ? allocEven : allocOdd;
        for (let col = 0; col < cols; col++) {
            const x = startX + col * hexWidth;
            if (x < 20 + hexWidth * 0.25 || x > (canvas.clientWidth - 20) - hexWidth * 0.25) continue;
            const chosen = allocTable[col]?.[rowInParity] ?? 0;
            cellMap[row].push({ x, y, series: chosen, col });
        }
    }
    return cellMap;
}

let lastPlot: { left: number, top: number, right: number, bottom: number } | null = null;

function render() {
    if (!graphData) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    const hexR = parseInt(hexSizeEl.value, 10);
    hexSizeLabel.textContent = String(hexR);

    const seriesLen = graphData.series.length;
    if (!cachedColors || cachedColors.length !== seriesLen) cachedColors = getColors(seriesLen);
    const colors = cachedColors;

    // Clear canvas for either view
    ctx.clearRect(0, 0, w, h);
    // If we're in "line/stacked" view, only draw the stacked area and legend
    if (!showHex) {
        const off = createOffscreen(Math.round(w * dpr), Math.round(h * dpr));
        const oc = off.getContext('2d')!;
        oc.setTransform(dpr, 0, 0, dpr, 0, 0);
        oc.fillStyle = '#071022';
        oc.fillRect(0, 0, w, h);
        drawStackedArea(oc, w, h, graphData, colors);
        ctx.drawImage(off, 0, 0, w, h);
        // draw legend
        drawLegend(ctx, 24, 24, colors, seriesNames);
        // Ensure no hex cells are active for hover
        hexCells = [];
        return;
    }


    // // Plot rect for hex layout (match drawStackedArea)
    const plot = { left: 20, top: 20, right: w - 20, bottom: h - 20 };
    lastPlot = plot;
    // // Reset hover cells each render
    hexCells = [];

    // // Hex grid geometry
    const hexWidth = Math.sqrt(3) * hexR;
    const vertStep = 1.5 * hexR;

    // // Columns constrained to plot width
    const plotW = Math.max(1, plot.right - plot.left);
    const cols = Math.max(1, Math.floor(plotW / hexWidth));

    const smoothPercent = parseInt(smoothPercentEl.value, 10);
    smoothPercentLabel.textContent = `${smoothPercent}`;

    let smoothedGraph;
    if (smoothPercent > 2) {
        const smoothWindowFrac = smoothPercent / 100; // 0 = none, 0.06 = use ~6% of samples as smoothing window
        const windowSamples = Math.max(1, Math.round(graphData.x.length * smoothWindowFrac));
        smoothedGraph = {
            x: graphData.x,
            series: graphData.series.map(s => movingAverage(s, windowSamples))
        };
    } else {
        smoothedGraph = graphData;
    }

    // // Aggregate data into per-column distributions for even and odd rows
    const binsEven = aggregateBins(smoothedGraph, cols, false);
    const binsOdd = aggregateBins(smoothedGraph, cols, true);

    // // Rows constrained to plot height
    const firstY = plot.top + hexR;
    const lastY = plot.bottom - hexR;
    const rows = Math.max(1, Math.floor((lastY - firstY) / vertStep) + 1);

    // // Build vertical allocations per column for each row parity
    const evenRowCount = Math.ceil(rows / 2);
    const oddRowCount = Math.floor(rows / 2);

    // // Stable global order to keep bands from swapping vertically
    const computedGlobalOrder = computeGlobalOrder(binsEven, binsOdd, seriesLen);

    const activeOrder = userOrder && userOrder.length === computedGlobalOrder.length ? userOrder : computedGlobalOrder;
    // Update the UI to reflect the active order
    renderGlobalOrderUI(activeOrder);

    const allocEven = buildAllocations(binsEven, evenRowCount, activeOrder);
    const allocOdd = buildAllocations(binsOdd, oddRowCount, activeOrder);

    // // Starting x for each row parity (center hexes within plot)
    const startXEven = plot.left + hexWidth / 2;
    const startXOdd = startXEven + hexWidth / 2;

    const cellMap = buildCellMap(cols, rows, startXEven, hexWidth, firstY, vertStep, allocEven, allocOdd);

    for (let r = 0; r < cellMap.length; r++) {
        const isEven = (r % 2) === 0;
        const distTable = isEven ? binsEven : binsOdd;
        for (const c of cellMap[r]) {
            const col = c.col;
            const dist = (distTable[col] || new Array(seriesLen).fill(0));
            const counts = new Array(seriesLen);
            let samples = 0;
            for (let s = 0; s < seriesLen; s++) {
                const vv = Math.max(0, dist[s] || 0);
                const ct = Math.round(vv * 1000);
                counts[s] = ct;
                samples += ct;
            }
            const poly = hexPolygon(c.x, c.y, hexR);
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const [px, py] of poly) {
                if (px < minX) minX = px;
                if (py < minY) minY = py;
                if (px > maxX) maxX = px;
                if (py > maxY) maxY = py;
            }
            hexCells.push({ poly, cx: c.x, cy: c.y, series: c.series, counts, samples, bbox: { minX, minY, maxX, maxY } });
        }
    }

    // Prepare Path2D per series
    const seriesPaths: Path2D[] = new Array(seriesLen).fill(null).map(() => new Path2D());
    for (let r = 0; r < cellMap.length; r++) {
        for (const c of cellMap[r]) {
            const sIdx = c.series;
            const key = `${hexR}:${sIdx}`;
            // Create a small polygon path appended to that series' Path2D
            const pts = hexPolygon(c.x, c.y, hexR);
            seriesPaths[sIdx].moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) seriesPaths[sIdx].lineTo(pts[i][0], pts[i][1]);
            seriesPaths[sIdx].closePath();
        }
    }

    // Fill each series once
    for (let s = 0; s < seriesLen; s++) {
        ctx.fillStyle = colors[s];
        ctx.fill(seriesPaths[s]);
    }
    // Multiply overlay (single pass)
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    for (let s = 0; s < seriesLen; s++) ctx.fill(seriesPaths[s]);
    ctx.globalCompositeOperation = 'source-over';

    drawLegend(ctx, 24, 24, colors, seriesNames);
    drawAxes(ctx, w, h, 20, rawData?.values);
}

// -------- Wiring: parse, sync inputs, and render --------

function safeParseMockData(text: string): MockData {
    try {
        const obj = JSON.parse(text);
        if (!obj || !Array.isArray(obj.values) || !Array.isArray(obj.series)) {
            throw new Error('Invalid data: must contain values and series arrays.');
        }
        // Minimal validation; detailed validation in transformToMock
        return obj as MockData;
    } catch (jsonErr) {
        try {
            const result = parseTsvToMockData(text);
            return result;
        } catch (tsvErr) {
            throw tsvErr || jsonErr;
        }
    }
}

function parseTsvToMockData(tsv: string): MockData {
    const text = tsv.replace(/\r\n?/g, '\n').trim();
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    if (lines.length < 2) {
        throw new Error('TSV must include a header and at least one data row.');
    }

    const splitRow = (row: string) => row.split('\t').map(c => c.trim());

    // Header
    const headerCells = splitRow(lines[0]);
    if (headerCells.length < 2) {
        throw new Error('Header must include an index column and at least one series column.');
    }

    // Series names (strip optional prefix like "AA:")
    const seriesNames = headerCells.slice(1).map(h => {
        const colon = h.indexOf(':');
        return colon >= 0 ? h.slice(colon + 1).trim() : h;
    });

    const values: number[] = [];
    const seriesValues: number[][] = seriesNames.map(() => []);

    // Data rows
    for (let r = 1; r < lines.length; r++) {
        const cells = splitRow(lines[r]);

        // First cell: x value (row number)
        const xRaw = cells[0] ?? '';
        const xVal = Number.parseFloat(xRaw);
        values.push(Number.isFinite(xVal) ? xVal : r); // fallback to row index if missing

        // Following cells: series values
        for (let s = 0; s < seriesNames.length; s++) {
            const raw = cells[s + 1] ?? '';
            const v = Number.parseFloat(raw);
            seriesValues[s].push(Number.isFinite(v) ? v : 0);
        }
    }

    // Build series
    const series: MockSeries[] = seriesNames.map((name, i) => ({
        name,
        values: seriesValues[i],
    }));

    // Basic consistency check
    const L = values.length;
    for (const s of series) {
        if (s.values.length !== L) {
            throw new Error('Irregular row widths detected while parsing TSV.');
        }
    }

    return { values, series };
}

function setRawDataAndRender(data: MockData) {
    rawData = data;
    seriesNames = data.series.map(s => s.name);
    // Keep inputs in sync with textarea
    seriesCountEl.value = String(data.series.length);
    // Transform and render
    const t = transformToMock(data);
    graphData = t.mock;
    seriesNames = t.names;
    scheduleRender();
}

function initMockData() {
    // Generate initial data and load into textarea
    const initial = generateMock(parseInt(seriesCountEl.value, 10) || 4, 120 + Math.floor(Math.random() * 60));
    mockDataEl.value = JSON.stringify(initial, null, 2);
    setRawDataAndRender(initial);
}
function resizeCanvasToDisplaySize() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}


function init() {
    resizeCanvasToDisplaySize();
    initMockData();
}

// Inputs that affect rendering only
hexSizeEl.addEventListener('input', () => scheduleRender());
smoothPercentEl.addEventListener('input', () => scheduleRender());

// IMPORTANT: changing seriesCount does NOT regenerate or re-render automatically
// It is only used when the user presses the Regenerate button.
// seriesCountEl.addEventListener('input', () => {}); // intentionally not rendering

// Regenerate button: create new mock data according to inputs, update textarea, then render
regenBtn.addEventListener('click', () => {
    const sc = Math.max(1, parseInt(seriesCountEl.value, 10) || 1);
    const next = generateMock(sc);
    mockDataEl.value = JSON.stringify(next, null, 2);
    setRawDataAndRender(next);
});

// Download
downloadBtn.addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = 'hex-stacked-area.png';
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const ectx = exportCanvas.getContext('2d')!;
    ectx.drawImage(canvas, 0, 0);
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
});

// Textarea edits: parse, sync inputs, transform, render
let mockParseTimer: number | undefined;
mockDataEl.addEventListener('input', () => {
    // Debounce to avoid parsing every keystroke
    if (mockParseTimer) window.clearTimeout(mockParseTimer);
    mockParseTimer = window.setTimeout(() => {
        try {
            const parsed = safeParseMockData(mockDataEl.value);
            setRawDataAndRender(parsed);
        } catch (e) {
            // Leave previous data; optionally you can show an error somewhere
            console.warn('Invalid mock data JSON:', e);
        }
    }, 250);
});


canvas.addEventListener('mousemove', (e) => {
    if (!graphData || !showHex) { hideTooltip(); return; }
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Find hex under cursor (linear scan)
    let hit: HexCell | null = null;
    for (let i = 0; i < hexCells.length; i++) {
        const c = hexCells[i];
        const b = c.bbox;
        if (b && (mx < b.minX || mx > b.maxX || my < b.minY || my > b.maxY)) continue;
        if (pointInPoly(mx, my, c.poly)) { hit = c; break; }
    }

    if (!hit) { hideTooltip(); return; }

    // Use lastPlot (exact layout used during render) to map mouse x -> normalized t
    const plot = lastPlot ?? { left: 20, top: 20, right: rect.width - 20, bottom: rect.height - 20 };
    const plotW = Math.max(1, plot.right - plot.left);
    const t = Math.min(1, Math.max(0, (mx - plot.left) / plotW));
    const points = graphData.x.length;
    const idx = Math.max(0, Math.min(points - 1, Math.round(t * (points - 1))));

    // Value label
    let valueLabel = '';
    if (rawData?.values?.length) {
        const yi = Math.max(0, Math.min(rawData.values.length - 1, Math.round(t * (rawData.values.length - 1))));
        valueLabel = String(rawData.values[yi]);
    } else {
        valueLabel = `${Math.round(t * 100)}%`;
    }

    const sIdx = hit.series;
    const share = graphData.series[sIdx]?.[idx] ?? 0;
    const majority = hit.samples > 0 ? hit.counts[sIdx] / hit.samples : 0;
    const sName = seriesNames[sIdx] || `Series ${sIdx + 1}`;
    const html = `
        <div><b>${sName}</b></div>
        <div>Value: ${valueLabel}</div>
        <div>Share: ${(share * 100).toFixed(1)}%</div>
        <div>Hex majority: ${(majority * 100).toFixed(0)}%</div>
    `.trim();

    showTooltipAt(e.clientX, e.clientY, html);
});
canvas.addEventListener('mouseleave', () => hideTooltip());

// Toggle view button
toggleBtn.addEventListener('click', () => {
    showHex = !showHex;
    toggleBtn.textContent = showHex ? 'Show Line' : 'Show Hex';
    scheduleRender();
});

// Initialize toggle text on startup

window.addEventListener('resize', () => {
    resizeCanvasToDisplaySize();
    scheduleRender();
});

// Helper: move item within array
function arrayMove<T>(arr: T[], from: number, to: number) {
    if (from === to) return;
    const v = arr.splice(from, 1)[0];
    arr.splice(to, 0, v);
}

function renderGlobalOrderUI(order: number[]) {
    if (!globalOrderEl) return;
    // Guard: if series names/colors mismatch length, build minimal placeholders
    const n = Math.max(order.length, seriesNames.length, cachedColors.length);
    // Clear
    globalOrderEl.innerHTML = '';
    for (let i = 0; i < order.length; i++) {
        const sIdx = order[i];
        const name = seriesNames[sIdx] ?? `Series ${sIdx + 1}`;
        const color = cachedColors[sIdx] ?? '#888';
        const item = document.createElement('div');
        item.className = 'order-item';
        item.draggable = true;
        item.dataset.pos = String(i); // current position in 'order' array
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.gap = '8px';
        item.style.padding = '6px';
        item.style.borderRadius = '6px';
        item.style.cursor = 'grab';
        item.style.background = 'rgba(255,255,255,0.02)';
        item.style.border = '1px solid rgba(255,255,255,0.03)';
        // content: swatch + label
        const sw = document.createElement('div');
        sw.style.width = '18px';
        sw.style.height = '12px';
        sw.style.background = color;
        sw.style.borderRadius = '3px';
        sw.style.flex = '0 0 auto';
        const lbl = document.createElement('div');
        lbl.style.fontSize = '12px';
        lbl.style.color = '#cfe8ff';
        lbl.textContent = name;
        item.appendChild(sw);
        item.appendChild(lbl);

        // Drag handlers
        item.addEventListener('dragstart', (ev) => {
            (ev.dataTransfer as DataTransfer).setData('text/plain', String(i));
            item.style.opacity = '0.5';
        });
        item.addEventListener('dragend', () => {
            item.style.opacity = '1';
        });
        item.addEventListener('dragover', (ev) => {
            ev.preventDefault();
            item.style.boxShadow = 'inset 0 0 0 2px rgba(255,255,255,0.04)';
        });
        item.addEventListener('dragleave', () => {
            item.style.boxShadow = '';
        });
        item.addEventListener('drop', (ev) => {
            ev.preventDefault();
            item.style.boxShadow = '';
            const raw = (ev.dataTransfer as DataTransfer).getData('text/plain');
            const fromPos = Number(raw);
            const toPos = Number(item.dataset.pos);
            if (!Number.isFinite(fromPos) || !Number.isFinite(toPos)) return;
            // initialize userOrder if needed
            const base = userOrder ? userOrder.slice() : order.slice();
            arrayMove(base, fromPos, toPos);
            userOrder = base;
            renderGlobalOrderUI(userOrder);
            scheduleRender();
        });

        globalOrderEl.prepend(item);
    }
}

if (resetOrderBtn) {
    resetOrderBtn.addEventListener('click', () => {
        userOrder = null;
        // If we are in render, render() will call renderGlobalOrderUI with computed order;
        // otherwise, best-effort: force a render so computeGlobalOrder runs and UI refreshes.
        scheduleRender();
    });
}

init();