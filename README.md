# dex-machinations

**A vibe coded web clone of the original [Machinations](https://machinations.io/) game-economy diagramming and simulation tool.**

dex-machinations is a browser-based diagram editor + simulation engine for modelling game economies. Draw nodes and pools, wire them together with drains, converters, traders and converters, hit play, and watch the resources flow — all rendered as an SVG canvas with a live resource chart underneath.

## Why

The original Machinations is a great tool, but it lives behind a hosted service and a credits system: you burn AI tokens and credits to get diagrams, simulations and exports out of it.

dex-machinations removes that entirely. It is a **fully local, zero-token product**:

- **No AI tokens.** Nothing is sent to a model. Every node, connection and formula is evaluated by a deterministic engine running in your browser.
- **No credits.** No sign-up, no metering, no paywall. Open the page and model.
- **No server.** It is a static site. Your diagrams are plain JSON files you save yourself (`Ctrl+S`).

It was vibe coded — written iteratively with an AI assistant in the loop — but the resulting product runs on its own with no ongoing AI dependency.

## Features

- **Diagram editor** — pools, sources, drains, converters, traders, gates, registers, delays, connections with formulas.
- **Formula language** — write expressions like `1d6`, `rand()`, `pools.gold / 10` on connections and in node values.
- **Simulation engine** — deterministic RNG, step/single-step/play controls, adjustable speed, batch "Quick Run" for many iterations.
- **Live chart** — resource totals charted as the simulation runs.
- **Examples** — load sample economies to see how it works.
- **Save / Open** — diagrams are portable JSON.

## Running it

```bash
npm install
npm run dev      # local dev server at http://localhost:5173
```

Other scripts:

```bash
npm test         # run the test suite (vitest)
npm run build    # typecheck + production build into dist/
npm run preview  # serve the production build locally
```

## Deployed version

The live build is published to GitHub Pages on every push to `master`:

**https://dexter30.github.io/machinations-clone/**

## Tech

- TypeScript, [Vite](https://vitejs.dev/), [Vitest](https://vitest.dev/)
- SVG for the diagram canvas, `<canvas>` for the chart
- No runtime dependencies — the entire app is hand-written vanilla TS

## License

MIT
