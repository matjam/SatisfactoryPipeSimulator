# Satisfactory Pipe Simulator

An interactive educational model for exploring pipe storage, throughput, demand-driven flow, and transient starvation in Satisfactory-style fluid networks.

The initial network is a fixed dual-feed manifold rendered with PixiJS. Select a segment to change its storage capacity or current volume, choose a global 300 or 600 m³/min pipe tier, and step the simulation one tick at a time.

## Development

```bash
npm install
npm run dev
```

## Verification

```bash
npm test
npm run check
npm run lint
npm run build
```

The simulation is an explanatory transient-flow model. It does not claim exact parity with Satisfactory's internal solver.
