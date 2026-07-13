# Satisfactory Pipe Simulator

An interactive educational model for exploring pipe storage, throughput, head lift, cyclic machines, and transient starvation in Satisfactory-style liquid networks.

The initial dual-feed manifold is now an editable graph rendered with PixiJS. Machines and pipe endpoints can be dragged in **Edit** mode; endpoint handles snap to machine ports or other endpoints to create junctions. Crossing lines do not connect, and disconnected endpoints are valid while editing.

Use **Simulate** mode to inspect machines and pipes, step or run the network, and view independent endpoint fill/drain, signed transit flow, inventory change, and available head. The pure TypeScript solver derives connectivity from attachments rather than geometry and advances in fixed substeps of at most 0.1 seconds.

## Mechanics and controls

- Pipe capacity is derived from explicit physical length at `1.327 m3/m`; canvas pixel length is layout only. Pipe length is configurable from 1-56m and each pipe independently uses Mk.1 (`300 m3/min`) or Mk.2 (`600 m3/min`).
- World elevation is an explicit Z coordinate. Producers provide 10m head by default. Pumps reset downstream head to 20m (Mk.1) or 50m (Mk.2), retain check direction when unpowered, and do not multiply throughput. Valves permit forward flow only and cap it from 0-600 m3/min.
- Fluid Buffers store 400m3 with 8m full head. Industrial Fluid Buffers store 2400m3 with 12m full head. Stored head scales with fill.
- Producers and consumers are one-port cyclic machines with finite internal buffers. A producer completes a batch only when its output buffer has room; a consumer completes a batch only when its input buffer contains enough fluid.
- Component ports accept one pipe endpoint. Junctions accept up to four. Full ports and junctions reject additional snaps with visible status.
- Edit mode adds, drags, connects, configures, and deletes pipes, machines, pumps, valves, and buffers. Drag previews keep connected geometry visible. Simulate mode locks topology and configuration, and provides step/run/reset controls.

**Share Link** serializes the configured, versioned network document into the URL hash and copies the full URL. Tick count and current run volumes are deliberately excluded, so opening a shared link starts from the configured initial volumes. Invalid or unsupported payloads are rejected and leave the default network in place.

Version 2 links include topology, length, tier, elevation, head, cycles, buffers, pumps, and valves. Version 1 graph-editor links are migrated when valid; legacy capacities outside the v2 1-56m physical range are rejected explicitly rather than truncated. URL-sized documents are bounded, validated during both encode and decode, and unknown fields are discarded.

## Fidelity and sources

Official values used by the model:

- [Satisfactory Wiki: Pipelines](https://satisfactory.wiki.gg/wiki/Pipelines) for 1.327m3/m capacity, 300/600m3/min tiers, and nominal 56m build length.
- [Satisfactory Wiki: Pipeline Pump](https://satisfactory.wiki.gg/wiki/Pipeline_Pump) for 20m and 50m pump head lift.
- [Satisfactory Wiki: Fluid Buffer](https://satisfactory.wiki.gg/wiki/Fluid_Buffer) for 400/2400m3 capacities and 8m/12m full-buffer head.

The multiway junction relaxation, finite-box segment behavior, partially filled elevation head, substep conductance, and simultaneous allocation are documented calibrated approximations. This project does not claim exact parity with the proprietary game solver. Gas behavior is not modeled; the UI explicitly identifies the simulated fluid as liquid.

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
