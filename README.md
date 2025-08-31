Live demo: https://xdnw.github.io/hex/

# hex — Hex-binned Stacked Area Visualizer

Small interactive web app that renders a stacked-area chart and a hex-binned variant of the same data. Data can be provided as JSON (internal format) or TSV. The UI supports smoothing, per-series ordering, drag-reorder of global stacking order, toggling between stacked-line and hex views, and exporting the canvas as PNG.

## Features
- Stacked area / line chart rendering (canvas)
- Hex-binned visualization where each hex picks the majority series for its cell
- Smooth (moving average) option
- User-controlled global series stacking order (drag & drop)
- Live editing of data as JSON or TSV
- Mock data generation
- Download canvas as PNG
- Lightweight, zero-dependency TypeScript source (src/main.ts)

## Data formats

JSON (internal MockData)
- shape:
  {
    "values": [x0, x1, ...],
    "series": [
      { "name": "Series A", "values": [v0, v1, ...] },
      ...
    ]
  }
- All series.values arrays must match the length of values.

TSV
- First row = header. First column = x (can be numeric or left blank to use row index). Remaining columns = series.
- Example:
  index\tA\tB
  0\t0.1\t0.9
  1\t0.2\t0.8

See: `sample.csv`

The app will try JSON parse first; if that fails it will fallback to TSV parsing.

## Running locally

xdnw: Can you write the running locally section, its node, so npm install, npm run dev etc. can also link to installing node

GitHub Copilot: ```markdown
// ...existing code...
## Running locally
Prerequisites
- Node.js (v18 or later) and npm. Download: https://nodejs.org/
- (Optional, Windows) Use nvm-windows to manage Node versions: https://github.com/coreybutler/nvm-windows

Quick start
1. Install dependencies:
   ```
   npm install
   ```
2. Start the dev server:
   ```
   npm run dev
   ```
   Check the terminal output for the local URL (usually http://localhost:xxxx).

Optional tasks
- Build production bundle:
  ```
  npm run build
  ```
- Serve a production build (if available):
  ```
  npm run start
  ```