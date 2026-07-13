import { describe, expect, it } from 'vitest'
import { CAPACITY_PER_METRE, canAttach, cloneDocument, cloneState, componentFullHead, createDefaultDocument, createSimulation, deleteSelection, makeComponent, pipeCapacity, tick, totalVolume, type Endpoint, type NetworkDocument, type PipeDocument, type SimulationState } from './simulation'

const endpoint = (attachment?: Endpoint['attachment'], z = 0): Endpoint => ({ x: 0, y: 0, z, attachment })
const pipe = (id: string, volume: number, attachment: Endpoint['attachment'], other?: Endpoint['attachment'], tier: 300 | 600 = 300): PipeDocument => ({ id, name: id, length: 10, tier, initialVolume: volume, endpoints: [endpoint(attachment), endpoint(other)] })
const simple = (pipes: PipeDocument[] = []): NetworkDocument => ({ version: 2, name: 'Test', defaultTier: 300, response: 1, tickSeconds: 1, fluid: 'liquid', components: [], pipes })
const run = (state: SimulationState, seconds: number): SimulationState => { for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += state.document.tickSeconds) state = tick(state); return state }

describe('pipe physics', () => {
  it('clones reactive proxy inputs used by the Svelte editor', () => {
    const document = createDefaultDocument()
    const documentProxy = new Proxy(document, {})
    const state = createSimulation(document)
    const stateProxy = new Proxy(state, {})
    expect(cloneDocument(documentProxy)).toEqual(document)
    expect(cloneState(stateProxy)).toEqual(state)
    expect(() => tick(stateProxy)).not.toThrow()
  })
  it('derives capacity from physical length independently of canvas geometry', () => {
    const item = pipe('a', 0, undefined); item.length = 56; item.endpoints[1].x = 1
    expect(pipeCapacity(item)).toBeCloseTo(56 * CAPACITY_PER_METRE)
  })
  it('conserves fluid and keeps all values finite and bounded', () => {
    let state = createSimulation(createDefaultDocument())
    for (let index = 0; index < 100; index++) { const before = totalVolume(state); state = tick(state); expect(totalVolume(state)).toBeCloseTo(before + state.stats.produced - state.stats.consumed, 7); for (const item of state.document.pipes) { expect(Number.isFinite(state.volumes[item.id])).toBe(true); expect(state.volumes[item.id]).toBeGreaterThanOrEqual(0); expect(state.volumes[item.id]).toBeLessThanOrEqual(pipeCapacity(item)) } }
  })
  it('allocates symmetric three-way and four-way junctions without overshoot', () => {
    for (const count of [3, 4]) { const pipes = Array.from({ length: count }, (_, index) => pipe(String(index), index ? 0 : 10, { kind: 'junction', id: 'j' })); const next = tick(createSimulation(simple(pipes))); const receivers = pipes.slice(1).map((item) => next.volumes[item.id]); expect(new Set(receivers.map((value) => value.toFixed(9))).size).toBe(1); expect(Math.max(...Object.values(next.volumes))).toBeLessThanOrEqual(10) }
  })
  it('never exceeds one per-pipe gross tier budget under fan-in and mixed tiers', () => {
    const document = simple([pipe('source', 10, { kind: 'junction', id: 'j' }, undefined, 300), pipe('fast', 0, { kind: 'junction', id: 'j' }, undefined, 600), pipe('slow', 0, { kind: 'junction', id: 'j' }, undefined, 300)])
    document.tickSeconds = 1; const next = tick(createSimulation(document))
    expect(next.stats.pipes.source.gross).toBeLessThanOrEqual(5 + 1e-9); expect(next.stats.pipes.fast.gross).toBeLessThanOrEqual(10 + 1e-9)
  })
  it('is permutation independent across pipes and endpoints', () => {
    const document = simple([pipe('a', 10, { kind: 'junction', id: 'j' }), pipe('b', 0, { kind: 'junction', id: 'j' }), pipe('c', 0, { kind: 'junction', id: 'j' })])
    const permuted = structuredClone(document); permuted.pipes.reverse(); permuted.pipes.forEach((item) => item.endpoints.reverse())
    expect(tick(createSimulation(permuted)).volumes).toEqual(tick(createSimulation(document)).volumes)
  })
  it('is independent of junction and component labels across a chain', () => {
    const producer = makeComponent('producer', 'z-producer'), consumer = makeComponent('consumer', 'a-consumer'); if (producer.kind !== 'producer' || consumer.kind !== 'consumer') throw new Error('fixture')
    producer.initialBuffer = 20; producer.cycleSeconds = 1000; consumer.cycleSeconds = 1000
    const document = simple([pipe('left', 5, { kind: 'component', id: producer.id, port: 'out' }, { kind: 'junction', id: 'z-junction' }), pipe('right', 1, { kind: 'junction', id: 'z-junction' }, { kind: 'component', id: consumer.id, port: 'in' })]); document.components = [consumer, producer]
    const renamed = structuredClone(document); renamed.components[0].id = 'z-consumer'; renamed.components[1].id = 'a-producer'; renamed.pipes[0].endpoints[0].attachment = { kind: 'component', id: 'a-producer', port: 'out' }; renamed.pipes[1].endpoints[1].attachment = { kind: 'component', id: 'z-consumer', port: 'in' }; for (const item of renamed.pipes) for (const end of item.endpoints) if (end.attachment?.kind === 'junction') end.attachment.id = 'a-junction'
    expect(tick(createSimulation(renamed)).volumes).toEqual(tick(createSimulation(document)).volumes)
  })
  it('converges over equal elapsed time at different external tick durations', () => {
    const document = simple([pipe('a', 10, { kind: 'junction', id: 'j' }), pipe('b', 0, { kind: 'junction', id: 'j' })]); document.tickSeconds = 1
    const slow = run(createSimulation(document), 5); document.tickSeconds = .2; const fast = run(createSimulation(document), 5)
    expect(fast.volumes.a).toBeCloseTo(slow.volumes.a, 6)
  })
  it('reports through-flow when opposite endpoint activity leaves inventory nearly steady', () => {
    const producer = makeComponent('producer', 'p'), consumer = makeComponent('consumer', 'c'); if (producer.kind !== 'producer' || consumer.kind !== 'consumer') throw new Error('fixture')
    producer.initialBuffer = 50; producer.cycleSeconds = 1000; consumer.cycleSeconds = .1; consumer.batchAmount = .25
    const document = simple([pipe('line', 5, { kind: 'component', id: 'p', port: 'out' }, { kind: 'component', id: 'c', port: 'in' })]); document.components = [producer, consumer]
    const next = tick(createSimulation(document)); expect(Math.abs(next.stats.pipes.line.inventoryDelta)).toBeLessThan(1); expect(next.stats.pipes.line.through).toBeGreaterThan(0)
  })
  it('does not mutate snapshots and has negligible closed-network long-run drift', () => {
    const document = simple([pipe('a', 10, { kind: 'junction', id: 'j' }), pipe('b', 1, { kind: 'junction', id: 'j' })]); const initial = createSimulation(document), copy = structuredClone(initial); let state = initial
    for (let index = 0; index < 1000; index++) state = tick(state)
    expect(initial).toEqual(copy); expect(totalVolume(state)).toBeCloseTo(totalVolume(initial), 8)
  })
})

describe('head and inline components', () => {
  it('cuts off lift above producer head and permits downhill delivery', () => {
    const producer = makeComponent('producer', 'p'); if (producer.kind !== 'producer') throw new Error('fixture'); producer.initialBuffer = 20; producer.cycleSeconds = 1000; producer.headLift = 10
    const high = pipe('high', 0, { kind: 'component', id: 'p', port: 'out' }); high.endpoints[0].z = 11
    let document = simple([high]); document.components = [producer]; expect(tick(createSimulation(document)).volumes.high).toBe(0)
    high.endpoints[0].z = -5; document = simple([high]); document.components = [producer]; expect(tick(createSimulation(document)).volumes.high).toBeGreaterThan(0)
  })
  it('pump resets rather than stacks head, obeys check direction, and unpowered adds no head', () => {
    const pump = makeComponent('pump', 'pump'); if (pump.kind !== 'pump') throw new Error('fixture'); pump.z = 5; pump.tier = 1
    const input = pipe('in', 10 * CAPACITY_PER_METRE, { kind: 'component', id: 'pump', port: 'in' }); input.endpoints[0].z = 5; input.endpoints[1].z = 5; const output = pipe('out', 0, { kind: 'component', id: 'pump', port: 'out' }); output.endpoints[0].z = 24
    let document = simple([input, output]); document.components = [pump]; let next = tick(createSimulation(document)); expect(next.volumes.out).toBeGreaterThan(0); expect(next.availableHead.out).toBe(25)
    pump.powered = false; document = simple([input, output]); document.components = [pump]; next = tick(createSimulation(document)); expect(next.volumes.out).toBe(0)
    pump.powered = true; input.initialVolume = 0; output.initialVolume = 10; document = simple([input, output]); document.components = [pump]; expect(tick(createSimulation(document)).volumes.in).toBe(0)
  })
  it('requires inlet head at pump elevation and clears stale head after power-off or disconnect', () => {
    const pump = makeComponent('pump', 'pump'); if (pump.kind !== 'pump') throw new Error('fixture'); pump.z = 10
    const input = pipe('in', 5, { kind: 'component', id: 'pump', port: 'in' }); input.endpoints[0].z = 10
    const output = pipe('out', 0, { kind: 'component', id: 'pump', port: 'out' }); let document = simple([input, output]); document.components = [pump]
    let state = tick(createSimulation(document)); expect(state.volumes.out).toBe(0)
    input.endpoints[1].z = 10; input.initialVolume = pipeCapacity(input); document = simple([input, output]); document.components = [pump]; state = tick(createSimulation(document)); expect(state.availableHead.out).toBe(30)
    const runtimePump = state.document.components[0]; runtimePump.powered = false; state = tick(state); expect(state.availableHead.out).toBeLessThanOrEqual(10)
    delete state.document.pipes[0].endpoints[0].attachment; state = tick(state); expect(state.availableHead.out).toBeLessThanOrEqual(10)
  })
  it('does not initialize a partial vertical pipe at its highest endpoint head', () => {
    const item = pipe('vertical', pipeCapacity(pipe('fixture', 0, undefined)) / 2, undefined); item.endpoints[0].z = 0; item.endpoints[1].z = 20
    expect(createSimulation(simple([item])).availableHead.vertical).toBeCloseTo(10)
  })
  it('valve caps forward flow and prevents reverse flow', () => {
    const valve = makeComponent('valve', 'v'); if (valve.kind !== 'valve') throw new Error('fixture'); valve.cap = 60
    const input = pipe('in', 10, { kind: 'component', id: 'v', port: 'in' }); const output = pipe('out', 0, { kind: 'component', id: 'v', port: 'out' }); let document = simple([input, output]); document.components = [valve]
    let next = tick(createSimulation(document)); expect(next.volumes.out).toBeLessThanOrEqual(1 + 1e-9)
    input.initialVolume = 0; output.initialVolume = 10; document = simple([input, output]); document.components = [valve]; next = tick(createSimulation(document)); expect(next.volumes.in).toBe(0)
  })
})

describe('buffers, machines, and topology', () => {
  it('uses official buffer capacities and fill-dependent heads', () => {
    const small = makeComponent('buffer'), large = makeComponent('industrialBuffer')
    expect(componentFullHead(small)).toBe(8); expect(componentFullHead(large)).toBe(12)
    expect(createSimulation({ ...simple(), components: [small, large] }).componentVolumes[small.id]).toBe(0)
  })
  it('balances a multiport buffer simultaneously without ID-order overshoot', () => {
    const buffer = makeComponent('buffer', 'buffer'); if (buffer.kind !== 'buffer') throw new Error('fixture'); buffer.initialVolume = 200
    const first = pipe('z-pipe', 0, { kind: 'component', id: buffer.id, port: 'in' }), second = pipe('a-pipe', 0, { kind: 'component', id: buffer.id, port: 'out' }); const document = simple([first, second]); document.components = [buffer]
    const renamed = structuredClone(document); renamed.pipes[0].id = 'a-renamed'; renamed.pipes[1].id = 'z-renamed'
    const result = tick(createSimulation(document)), other = tick(createSimulation(renamed))
    expect(result.volumes['z-pipe']).toBeCloseTo(result.volumes['a-pipe']); expect(other.volumes['a-renamed']).toBeCloseTo(result.volumes['z-pipe']); expect(result.componentVolumes.buffer).toBeGreaterThan(0)
  })
  it('cycles producer buffers only with space and starves consumer batches without input', () => {
    const producer = makeComponent('producer', 'p'), consumer = makeComponent('consumer', 'c'); if (producer.kind !== 'producer' || consumer.kind !== 'consumer') throw new Error('fixture')
    producer.initialBuffer = 50; producer.cycleSeconds = 1; producer.batchAmount = 30; consumer.cycleSeconds = 1; consumer.batchAmount = 20
    const document = simple(); document.components = [producer, consumer]; let state = tick(createSimulation(document)); expect(state.componentVolumes.p).toBe(50); expect(state.stats.produced).toBe(0); expect(state.stats.consumed).toBe(0)
    producer.initialBuffer = 0; producer.batchAmount = 7; state = tick(createSimulation(document)); expect(state.componentVolumes.p).toBe(7)
  })
  it('counts one blocked due consumer demand per external tick', () => {
    const consumer = makeComponent('consumer', 'c'); if (consumer.kind !== 'consumer') throw new Error('fixture'); consumer.cycleSeconds = .1; consumer.batchAmount = 4
    const document = simple(); document.components = [consumer]
    expect(tick(createSimulation(document)).stats.requested).toBe(4)
  })
  it('rejects invalid simulation settings before substepping', () => {
    const document = simple(); document.tickSeconds = 0; expect(() => createSimulation(document)).toThrow(/timing/)
    document.tickSeconds = 1; const machine = makeComponent('producer'); if (machine.kind !== 'producer') throw new Error('fixture'); machine.cycleSeconds = 0; document.components = [machine]; expect(() => createSimulation(document)).toThrow(/cyclic/)
  })
  it('cleans deletion attachments and enforces legal cardinality', () => {
    let document = createDefaultDocument(); document = deleteSelection(document, { kind: 'producer', id: 'producer-west' }); expect(document.pipes.find((item) => item.id === 'left')!.endpoints[0].attachment).toBeUndefined()
    const junction = { kind: 'junction' as const, id: 'full' }; document = simple(Array.from({ length: 4 }, (_, index) => pipe(String(index), 0, junction))); expect(canAttach(document, junction)).toBe(false)
    const port = { kind: 'component' as const, id: 'producer-east', port: 'out' }; expect(canAttach(createDefaultDocument(), port)).toBe(false)
  })
})
