export const CAPACITY_PER_METRE = 1.327
export type TransferTier = 300 | 600
export type ComponentKind = 'producer' | 'consumer' | 'pump' | 'valve' | 'buffer' | 'industrialBuffer'
export type Selection = { kind: ComponentKind | 'pipe'; id: string }
export interface Point { x: number; y: number; z: number }
export type Attachment = { kind: 'component'; id: string; port: string } | { kind: 'junction'; id: string }
export interface Endpoint extends Point { attachment?: Attachment }
export interface PipeDocument {
  id: string
  name: string
  length: number
  tier: TransferTier
  initialVolume: number
  endpoints: [Endpoint, Endpoint]
}
interface ComponentBase extends Point { id: string; name: string; kind: ComponentKind; powered: boolean }
export interface MachineComponent extends ComponentBase {
  kind: 'producer' | 'consumer'
  bufferCapacity: number
  initialBuffer: number
  cycleSeconds: number
  batchAmount: number
  headLift: number
}
export interface PumpComponent extends ComponentBase { kind: 'pump'; tier: 1 | 2; direction: 'in-to-out' | 'out-to-in' }
export interface ValveComponent extends ComponentBase { kind: 'valve'; cap: number; direction: 'in-to-out' | 'out-to-in' }
export interface BufferComponent extends ComponentBase { kind: 'buffer' | 'industrialBuffer'; initialVolume: number }
export type Component = MachineComponent | PumpComponent | ValveComponent | BufferComponent
export interface NetworkDocument {
  version: 2
  name: string
  components: Component[]
  pipes: PipeDocument[]
  defaultTier: TransferTier
  response: number
  tickSeconds: number
  fluid: 'liquid'
}
export interface PipeTelemetry { ends: [{ fill: number; drain: number }, { fill: number; drain: number }]; through: number; inventoryDelta: number; gross: number }
export interface TickStats { produced: number; consumed: number; requested: number; pipes: Record<string, PipeTelemetry> }
export interface SimulationState {
  document: NetworkDocument
  volumes: Record<string, number>
  componentVolumes: Record<string, number>
  cycleProgress: Record<string, number>
  availableHead: Record<string, number>
  tick: number
  elapsedSeconds: number
  stats: TickStats
}

export const pipeCapacity = (pipe: Pick<PipeDocument, 'length'>): number => pipe.length * CAPACITY_PER_METRE
export const componentCapacity = (component: Component): number => component.kind === 'buffer' ? 400 : component.kind === 'industrialBuffer' ? 2400 : 'bufferCapacity' in component ? component.bufferCapacity : 0
export const componentFullHead = (component: Component): number => component.kind === 'buffer' ? 8 : component.kind === 'industrialBuffer' ? 12 : 0
export const componentPorts = (component: Component): string[] => component.kind === 'producer' ? ['out'] : component.kind === 'consumer' ? ['in'] : ['in', 'out']
export const attachmentKey = (attachment: Attachment): string => attachment.kind === 'junction' ? `junction:${attachment.id}` : `component:${attachment.id}:${attachment.port}`
export const cloneDocument = (document: NetworkDocument): NetworkDocument => ({
  version: 2,
  name: document.name,
  components: document.components.map((component) => ({ ...component })),
  pipes: document.pipes.map((pipe) => ({
    ...pipe,
    endpoints: pipe.endpoints.map((endpoint) => ({
      ...endpoint,
      attachment: endpoint.attachment ? { ...endpoint.attachment } : undefined,
    })) as [Endpoint, Endpoint],
  })),
  defaultTier: document.defaultTier,
  response: document.response,
  tickSeconds: document.tickSeconds,
  fluid: document.fluid,
})
export function createId(prefix: string): string { return `${prefix}-${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}` }

export function makeComponent(kind: ComponentKind, id = createId(kind), x = 500, y = 285): Component {
  const base = { id, kind, name: `New ${kind === 'industrialBuffer' ? 'industrial buffer' : kind}`, x, y, z: 0, powered: true }
  if (kind === 'producer' || kind === 'consumer') return { ...base, kind, bufferCapacity: 50, initialBuffer: kind === 'producer' ? 30 : 0, cycleSeconds: kind === 'producer' ? 60 : 60, batchAmount: kind === 'producer' ? 30 : 45, headLift: kind === 'producer' ? 10 : 0 }
  if (kind === 'pump') return { ...base, kind, tier: 1, direction: 'in-to-out' }
  if (kind === 'valve') return { ...base, kind, cap: 300, direction: 'in-to-out' }
  return { ...base, kind, initialVolume: 0 }
}

export function createDefaultDocument(): NetworkDocument {
  const components: Component[] = [
    { ...makeComponent('producer', 'producer-west', 80, 230), name: 'West producer' },
    { ...makeComponent('producer', 'producer-east', 920, 230), name: 'East producer' },
    { ...makeComponent('consumer', 'consumer-a', 350, 475), name: 'Consumer A' },
    { ...makeComponent('consumer', 'consumer-b', 650, 475), name: 'Consumer B' },
  ]
  const end = (x: number, y: number, attachment: Attachment): Endpoint => ({ x, y, z: 0, attachment })
  const pipe = (id: string, name: string, a: Endpoint, b: Endpoint): PipeDocument => ({ id, name, length: 56, tier: 300, initialVolume: 56 * CAPACITY_PER_METRE, endpoints: [a, b] })
  return { version: 2, name: 'Dual-feed manifold', defaultTier: 300, response: .7, tickSeconds: 1, fluid: 'liquid', components, pipes: [
    pipe('left', 'West feeder', end(123, 230, { kind: 'component', id: 'producer-west', port: 'out' }), end(350, 230, { kind: 'junction', id: 'junction-a' })),
    pipe('center', 'Center span', end(350, 230, { kind: 'junction', id: 'junction-a' }), end(650, 230, { kind: 'junction', id: 'junction-b' })),
    pipe('right', 'East feeder', end(650, 230, { kind: 'junction', id: 'junction-b' }), end(877, 230, { kind: 'component', id: 'producer-east', port: 'out' })),
    pipe('drop-a', 'Consumer A drop', end(350, 230, { kind: 'junction', id: 'junction-a' }), end(350, 432, { kind: 'component', id: 'consumer-a', port: 'in' })),
    pipe('drop-b', 'Consumer B drop', end(650, 230, { kind: 'junction', id: 'junction-b' }), end(650, 432, { kind: 'component', id: 'consumer-b', port: 'in' })),
  ] }
}

const emptyTelemetry = (): PipeTelemetry => ({ ends: [{ fill: 0, drain: 0 }, { fill: 0, drain: 0 }], through: 0, inventoryDelta: 0, gross: 0 })
const emptyStats = (document: NetworkDocument): TickStats => ({ produced: 0, consumed: 0, requested: 0, pipes: Object.fromEntries(document.pipes.map((pipe) => [pipe.id, emptyTelemetry()])) })
export function createSimulation(document: NetworkDocument): SimulationState {
  assertSimulationDocument(document)
  const snapshot = cloneDocument(document)
  return { document: snapshot, volumes: Object.fromEntries(snapshot.pipes.map((pipe) => [pipe.id, pipe.initialVolume])), componentVolumes: Object.fromEntries(snapshot.components.map((component) => [component.id, 'initialBuffer' in component ? component.initialBuffer : 'initialVolume' in component ? component.initialVolume : 0])), cycleProgress: Object.fromEntries(snapshot.components.map((component) => [component.id, 0])), availableHead: Object.fromEntries(snapshot.pipes.map((pipe) => [pipe.id, localPipeHead(pipe, pipe.initialVolume)])), tick: 0, elapsedSeconds: 0, stats: emptyStats(snapshot) }
}
export function cloneState(state: SimulationState): SimulationState {
  return {
    document: cloneDocument(state.document),
    volumes: { ...state.volumes },
    componentVolumes: { ...state.componentVolumes },
    cycleProgress: { ...state.cycleProgress },
    availableHead: { ...state.availableHead },
    tick: state.tick,
    elapsedSeconds: state.elapsedSeconds,
    stats: {
      ...state.stats,
      pipes: Object.fromEntries(Object.entries(state.stats.pipes).map(([id, telemetry]) => [id, {
        ...telemetry,
        ends: telemetry.ends.map((endpoint) => ({ ...endpoint })) as PipeTelemetry['ends'],
      }])),
    },
  }
}

function assertSimulationDocument(document: NetworkDocument): void {
  if (!Number.isFinite(document.tickSeconds) || document.tickSeconds < .1 || document.tickSeconds > 10 || !Number.isFinite(document.response) || document.response < 0 || document.response > 1) throw new Error('Invalid simulation timing settings.')
  for (const pipe of document.pipes) if (!Number.isFinite(pipe.length) || pipe.length <= 0 || !Number.isFinite(pipe.initialVolume) || pipe.initialVolume < 0 || pipe.initialVolume > pipeCapacity(pipe) || (pipe.tier !== 300 && pipe.tier !== 600) || pipe.endpoints.some((endpoint) => ![endpoint.x, endpoint.y, endpoint.z].every(Number.isFinite))) throw new Error(`Invalid pipe ${pipe.id}.`)
  for (const component of document.components) {
    if (![component.x, component.y, component.z].every(Number.isFinite)) throw new Error(`Invalid component ${component.id}.`)
    if ((component.kind === 'producer' || component.kind === 'consumer') && (!Number.isFinite(component.cycleSeconds) || component.cycleSeconds < .1 || !Number.isFinite(component.bufferCapacity) || component.bufferCapacity <= 0 || !Number.isFinite(component.batchAmount) || component.batchAmount < 0 || !Number.isFinite(component.initialBuffer) || component.initialBuffer < 0 || component.initialBuffer > component.bufferCapacity || !Number.isFinite(component.headLift) || component.headLift < 0)) throw new Error(`Invalid cyclic machine ${component.id}.`)
    if (component.kind === 'valve' && (!Number.isFinite(component.cap) || component.cap < 0 || component.cap > 600)) throw new Error(`Invalid valve ${component.id}.`)
    if ((component.kind === 'buffer' || component.kind === 'industrialBuffer') && (!Number.isFinite(component.initialVolume) || component.initialVolume < 0 || component.initialVolume > componentCapacity(component))) throw new Error(`Invalid buffer ${component.id}.`)
  }
}

interface PortRef { pipe: PipeDocument; end: 0 | 1 }
function topology(document: NetworkDocument): Map<string, PortRef[]> {
  const result = new Map<string, PortRef[]>()
  for (const pipe of document.pipes) pipe.endpoints.forEach((endpoint, index) => {
    if (!endpoint.attachment) return
    const key = endpoint.attachment.kind === 'junction' ? `j:${endpoint.attachment.id}` : `c:${endpoint.attachment.id}:${endpoint.attachment.port}`
    const refs = result.get(key) ?? []; refs.push({ pipe, end: index as 0 | 1 }); result.set(key, refs)
  })
  return result
}

type Reservoir = { kind: 'pipe'; ref: PortRef } | { kind: 'component'; id: string; capacity: number } | { kind: 'outside' }
interface Intent { from: Reservoir; to: Reservoir; amount: number }
const pipeReservoir = (ref: PortRef): Reservoir => ({ kind: 'pipe', ref })
const componentReservoir = (id: string, capacity: number): Reservoir => ({ kind: 'component', id, capacity })
const localPipeHead = (pipe: PipeDocument, volume: number): number => {
  const low = Math.min(pipe.endpoints[0].z, pipe.endpoints[1].z), high = Math.max(pipe.endpoints[0].z, pipe.endpoints[1].z)
  return low + (high - low) * Math.min(1, volume / pipeCapacity(pipe))
}
const reservoirKey = (reservoir: Reservoir): string | undefined => reservoir.kind === 'pipe' ? `p:${reservoir.ref.pipe.id}` : reservoir.kind === 'component' ? `c:${reservoir.id}` : undefined

function recomputeHead(state: SimulationState, groups: Map<string, PortRef[]>): Record<string, number> {
  const heads = Object.fromEntries(state.document.pipes.map((pipe) => [pipe.id, localPipeHead(pipe, state.volumes[pipe.id])]))
  for (const component of state.document.components) {
    let head: number | undefined
    let refs: PortRef[] = []
    if (component.kind === 'producer' && component.powered && state.componentVolumes[component.id] > 0) { head = component.z + component.headLift; refs = groups.get(`c:${component.id}:out`) ?? [] }
    if ((component.kind === 'buffer' || component.kind === 'industrialBuffer') && state.componentVolumes[component.id] > 0) { head = component.z + componentFullHead(component) * state.componentVolumes[component.id] / componentCapacity(component); refs = [...(groups.get(`c:${component.id}:in`) ?? []), ...(groups.get(`c:${component.id}:out`) ?? [])] }
    if (head !== undefined) for (const ref of refs) if (head >= ref.pipe.endpoints[ref.end].z) heads[ref.pipe.id] = Math.max(heads[ref.pipe.id], head)
  }
  for (let pass = 0; pass < state.document.pipes.length + state.document.components.length; pass++) {
    let changed = false
    for (const [key, refs] of groups) if (key.startsWith('j:')) {
      const propagated = Math.max(...refs.filter((ref) => state.volumes[ref.pipe.id] >= pipeCapacity(ref.pipe) * .98).map((ref) => heads[ref.pipe.id]), -Infinity)
      if (Number.isFinite(propagated)) for (const ref of refs) if (propagated >= ref.pipe.endpoints[ref.end].z && propagated > heads[ref.pipe.id]) { heads[ref.pipe.id] = propagated; changed = true }
    }
    for (const component of state.document.components) if (component.kind === 'pump') {
      const input = groups.get(`c:${component.id}:${component.direction === 'in-to-out' ? 'in' : 'out'}`)?.[0]
      const output = groups.get(`c:${component.id}:${component.direction === 'in-to-out' ? 'out' : 'in'}`)?.[0]
      if (!input || !output || state.volumes[input.pipe.id] <= 0 || heads[input.pipe.id] + 1e-9 < component.z) continue
      const outputHead = component.z + (component.powered ? component.tier === 1 ? 20 : 50 : 0)
      if (outputHead >= output.pipe.endpoints[output.end].z && outputHead > heads[output.pipe.id]) { heads[output.pipe.id] = outputHead; changed = true }
    }
    if (!changed) break
  }
  return heads
}

function addBalancedIntents(intents: Intent[], entries: { reservoir: Reservoir; volume: number; capacity: number; head: number; z: number }[], strength: number): void {
  if (entries.length < 2) return
  const target = entries.reduce((sum, entry) => sum + entry.volume, 0) / entries.reduce((sum, entry) => sum + entry.capacity, 0)
  const donors = entries.map((entry) => ({ entry, amount: Math.max(0, entry.volume - entry.capacity * target) * strength })).filter((item) => item.amount > 1e-12)
  const receivers = entries.map((entry) => ({ entry, amount: Math.max(0, entry.capacity * target - entry.volume) * strength })).filter((item) => item.amount > 1e-12)
  const donorTotal = donors.reduce((sum, item) => sum + item.amount, 0), receiverTotal = receivers.reduce((sum, item) => sum + item.amount, 0)
  const total = Math.min(donorTotal, receiverTotal)
  for (const donor of donors) for (const receiver of receivers) if (donor.entry.head + 1e-9 >= receiver.entry.z) intents.push({ from: donor.entry.reservoir, to: receiver.entry.reservoir, amount: total * donor.amount / donorTotal * receiver.amount / receiverTotal })
}

function propose(state: SimulationState, dt: number, groups: Map<string, PortRef[]>, heads: Record<string, number>): Intent[] {
  const intents: Intent[] = [], strength = 1 - Math.exp(-state.document.response * dt * 2)
  for (const [key, refs] of groups) if (key.startsWith('j:')) addBalancedIntents(intents, refs.map((ref) => ({ reservoir: pipeReservoir(ref), volume: state.volumes[ref.pipe.id], capacity: pipeCapacity(ref.pipe), head: heads[ref.pipe.id], z: ref.pipe.endpoints[ref.end].z })), strength)
  for (const component of state.document.components) {
    const input = groups.get(`c:${component.id}:in`) ?? [], output = groups.get(`c:${component.id}:out`) ?? []
    if (component.kind === 'producer' && component.powered && output[0] && component.z + component.headLift >= output[0].pipe.endpoints[output[0].end].z) intents.push({ from: componentReservoir(component.id, component.bufferCapacity), to: pipeReservoir(output[0]), amount: output[0].pipe.tier * dt / 60 })
    else if (component.kind === 'consumer' && component.powered && input[0]) intents.push({ from: pipeReservoir(input[0]), to: componentReservoir(component.id, component.bufferCapacity), amount: input[0].pipe.tier * dt / 60 })
    else if (component.kind === 'buffer' || component.kind === 'industrialBuffer') {
      const capacity = componentCapacity(component), volume = state.componentVolumes[component.id], head = component.z + componentFullHead(component) * volume / capacity
      addBalancedIntents(intents, [{ reservoir: componentReservoir(component.id, capacity), volume, capacity, head, z: component.z }, ...[...input, ...output].map((ref) => ({ reservoir: pipeReservoir(ref), volume: state.volumes[ref.pipe.id], capacity: pipeCapacity(ref.pipe), head: heads[ref.pipe.id], z: ref.pipe.endpoints[ref.end].z }))], strength)
    } else if (component.kind === 'pump' || component.kind === 'valve') {
      const from = (component.direction === 'in-to-out' ? input : output)[0], to = (component.direction === 'in-to-out' ? output : input)[0]
      if (!from || !to || heads[from.pipe.id] + 1e-9 < component.z) continue
      const pressure = state.volumes[from.pipe.id] / pipeCapacity(from.pipe) - state.volumes[to.pipe.id] / pipeCapacity(to.pipe)
      const cap = component.kind === 'valve' ? component.cap : Math.min(from.pipe.tier, to.pipe.tier)
      const outputHead = component.kind === 'pump' ? component.z + (component.powered ? component.tier === 1 ? 20 : 50 : 0) : heads[from.pipe.id]
      const amount = component.kind === 'pump' && component.powered ? cap * dt / 60 : Math.max(0, pressure) * Math.min(pipeCapacity(from.pipe), pipeCapacity(to.pipe)) * strength
      if (outputHead >= to.pipe.endpoints[to.end].z && amount > 0) intents.push({ from: pipeReservoir(from), to: pipeReservoir(to), amount: Math.min(amount, cap * dt / 60) })
    }
  }
  return intents
}

function commit(state: SimulationState, intents: Intent[], dt: number): void {
  const outgoing = new Map<string, number>(), incoming = new Map<string, number>(), activity = new Map<string, number>()
  for (const intent of intents) {
    const from = reservoirKey(intent.from), to = reservoirKey(intent.to)
    if (from) outgoing.set(from, (outgoing.get(from) ?? 0) + intent.amount)
    if (to) incoming.set(to, (incoming.get(to) ?? 0) + intent.amount)
    if (intent.from.kind === 'pipe') activity.set(intent.from.ref.pipe.id, (activity.get(intent.from.ref.pipe.id) ?? 0) + intent.amount)
    if (intent.to.kind === 'pipe') activity.set(intent.to.ref.pipe.id, (activity.get(intent.to.ref.pipe.id) ?? 0) + intent.amount)
  }
  const available = (reservoir: Reservoir): number => reservoir.kind === 'pipe' ? state.volumes[reservoir.ref.pipe.id] : reservoir.kind === 'component' ? state.componentVolumes[reservoir.id] : Infinity
  const room = (reservoir: Reservoir): number => reservoir.kind === 'pipe' ? pipeCapacity(reservoir.ref.pipe) - state.volumes[reservoir.ref.pipe.id] : reservoir.kind === 'component' ? reservoir.capacity - state.componentVolumes[reservoir.id] : Infinity
  const amounts = intents.map((intent) => {
    const fromKey = reservoirKey(intent.from), toKey = reservoirKey(intent.to)
    let scale = 1
    if (fromKey) scale = Math.min(scale, available(intent.from) / (outgoing.get(fromKey) ?? 1))
    if (toKey) scale = Math.min(scale, room(intent.to) / (incoming.get(toKey) ?? 1))
    if (intent.from.kind === 'pipe') scale = Math.min(scale, intent.from.ref.pipe.tier * dt / 60 / (activity.get(intent.from.ref.pipe.id) ?? 1))
    if (intent.to.kind === 'pipe') scale = Math.min(scale, intent.to.ref.pipe.tier * dt / 60 / (activity.get(intent.to.ref.pipe.id) ?? 1))
    return Math.max(0, intent.amount * scale)
  })
  intents.forEach((intent, index) => {
    const amount = amounts[index]
    if (intent.from.kind === 'pipe') { state.volumes[intent.from.ref.pipe.id] -= amount; const telemetry = state.stats.pipes[intent.from.ref.pipe.id]; telemetry.ends[intent.from.ref.end].drain += amount; telemetry.gross += amount }
    else if (intent.from.kind === 'component') state.componentVolumes[intent.from.id] -= amount
    if (intent.to.kind === 'pipe') { state.volumes[intent.to.ref.pipe.id] += amount; const telemetry = state.stats.pipes[intent.to.ref.pipe.id]; telemetry.ends[intent.to.ref.end].fill += amount; telemetry.gross += amount }
    else if (intent.to.kind === 'component') state.componentVolumes[intent.to.id] += amount
  })
}

function runCycles(state: SimulationState, dt: number, blockedDemand: Set<string>): void {
  for (const component of state.document.components) if ((component.kind === 'producer' || component.kind === 'consumer') && component.powered) {
    state.cycleProgress[component.id] += dt
    while (state.cycleProgress[component.id] + 1e-9 >= component.cycleSeconds) {
      const possible = component.kind === 'producer' ? state.componentVolumes[component.id] + component.batchAmount <= component.bufferCapacity : state.componentVolumes[component.id] >= component.batchAmount
      if (component.kind === 'consumer' && !blockedDemand.has(component.id)) { state.stats.requested += component.batchAmount; blockedDemand.add(component.id) }
      if (!possible) { state.cycleProgress[component.id] = component.cycleSeconds; break }
      state.componentVolumes[component.id] += component.kind === 'producer' ? component.batchAmount : -component.batchAmount
      if (component.kind === 'producer') state.stats.produced += component.batchAmount
      else { state.stats.consumed += component.batchAmount; blockedDemand.delete(component.id) }
      state.cycleProgress[component.id] -= component.cycleSeconds
    }
  }
}

function substep(state: SimulationState, dt: number, blockedDemand: Set<string>): void {
  const before = { ...state.volumes }, groups = topology(state.document)
  runCycles(state, dt, blockedDemand)
  const heads = recomputeHead(state, groups)
  commit(state, propose(state, dt, groups, heads), dt)
  state.availableHead = recomputeHead(state, groups)
  for (const pipe of state.document.pipes) state.stats.pipes[pipe.id].inventoryDelta += state.volumes[pipe.id] - before[pipe.id]
}

export function tick(input: SimulationState): SimulationState {
  assertSimulationDocument(input.document)
  const next = cloneState(input); next.stats = emptyStats(next.document)
  let remaining = next.document.tickSeconds; const blockedDemand = new Set<string>()
  while (remaining > 1e-9) { const dt = Math.min(.1, remaining); substep(next, dt, blockedDemand); remaining -= dt }
  for (const telemetry of Object.values(next.stats.pipes)) telemetry.through = Math.min(telemetry.ends[0].fill, telemetry.ends[1].drain) - Math.min(telemetry.ends[1].fill, telemetry.ends[0].drain)
  next.tick++; next.elapsedSeconds += next.document.tickSeconds
  return next
}

export function deleteSelection(document: NetworkDocument, selection: Selection): NetworkDocument {
  const next = cloneDocument(document)
  if (selection.kind === 'pipe') next.pipes = next.pipes.filter((pipe) => pipe.id !== selection.id)
  else { next.components = next.components.filter((component) => component.id !== selection.id); for (const pipe of next.pipes) for (const endpoint of pipe.endpoints) if (endpoint.attachment?.kind === 'component' && endpoint.attachment.id === selection.id) delete endpoint.attachment }
  const counts = new Map<string, number>()
  for (const pipe of next.pipes) for (const endpoint of pipe.endpoints) if (endpoint.attachment?.kind === 'junction') counts.set(endpoint.attachment.id, (counts.get(endpoint.attachment.id) ?? 0) + 1)
  for (const pipe of next.pipes) for (const endpoint of pipe.endpoints) if (endpoint.attachment?.kind === 'junction' && (counts.get(endpoint.attachment.id) ?? 0) < 2) delete endpoint.attachment
  return next
}
export function splitPipeAt(document: NetworkDocument, pipeId: string, fraction: number, junctionId: string): PipeDocument | undefined {
  const index = document.pipes.findIndex((pipe) => pipe.id === pipeId)
  if (index < 0) return undefined
  const pipe = document.pipes[index]
  if (pipe.length < 2 || !Number.isFinite(fraction)) return undefined
  const minimumFraction = 1 / pipe.length
  if (fraction < minimumFraction || fraction > 1 - minimumFraction) return undefined
  const split = fraction
  const [start, end] = pipe.endpoints
  const junction: Endpoint = {
    x: start.x + (end.x - start.x) * split,
    y: start.y + (end.y - start.y) * split,
    z: start.z + (end.z - start.z) * split,
    attachment: { kind: 'junction', id: junctionId },
  }
  const originalLength = pipe.length
  const originalVolume = pipe.initialVolume
  const second: PipeDocument = {
    ...pipe,
    id: createId('pipe'),
    name: `${pipe.name} (split)`,
    length: originalLength * (1 - split),
    initialVolume: originalVolume * (1 - split),
    endpoints: [{ ...junction, attachment: { ...junction.attachment! } }, { ...end, attachment: end.attachment ? { ...end.attachment } : undefined }],
  }
  pipe.length = originalLength * split
  pipe.initialVolume = originalVolume * split
  pipe.endpoints[1] = junction
  document.pipes.splice(index + 1, 0, second)
  return second
}
export function moveJunction(document: NetworkDocument, junctionId: string, x: number, y: number): void {
  for (const pipe of document.pipes) for (const endpoint of pipe.endpoints) {
    if (endpoint.attachment?.kind !== 'junction' || endpoint.attachment.id !== junctionId) continue
    endpoint.x = x
    endpoint.y = y
  }
}
export function canAttach(document: NetworkDocument, attachment: Attachment): boolean {
  let count = 0
  const key = attachmentKey(attachment)
  for (const pipe of document.pipes) for (const endpoint of pipe.endpoints) if (endpoint.attachment && attachmentKey(endpoint.attachment) === key) count++
  return attachment.kind === 'junction' ? count < 4 : count < 1
}
export const totalVolume = (state: SimulationState): number => Object.values(state.volumes).reduce((sum, value) => sum + value, 0) + Object.values(state.componentVolumes).reduce((sum, value) => sum + value, 0)
