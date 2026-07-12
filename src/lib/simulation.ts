export type PipeId = 'left' | 'center' | 'right' | 'dropA' | 'dropB'

export interface Pipe {
  id: PipeId
  name: string
  capacity: number
  volume: number
}

export interface SimulationConfig {
  pipes: Record<PipeId, Pipe>
  producerRate: number
  consumerRate: number
  transferRate: 300 | 600
  response: number
  tickSeconds: number
}

export interface TickStats {
  produced: number
  consumed: number
  requested: number
  pipeFlow: Record<PipeId, number>
}

export interface SimulationState extends SimulationConfig {
  tick: number
  stats: TickStats
}

interface Transfer {
  from: PipeId
  to: PipeId
  amount: number
}

const pipeIds: PipeId[] = ['left', 'center', 'right', 'dropA', 'dropB']
const junctions: PipeId[][] = [
  ['left', 'center', 'dropA'],
  ['center', 'right', 'dropB'],
]

const emptyFlows = (): Record<PipeId, number> => ({
  left: 0,
  center: 0,
  right: 0,
  dropA: 0,
  dropB: 0,
})

export function createInitialState(): SimulationState {
  const makePipe = (id: PipeId, name: string): Pipe => ({
    id,
    name,
    capacity: 100,
    volume: 100,
  })

  return {
    pipes: {
      left: makePipe('left', 'West feeder'),
      center: makePipe('center', 'Center span'),
      right: makePipe('right', 'East feeder'),
      dropA: makePipe('dropA', 'Consumer A drop'),
      dropB: makePipe('dropB', 'Consumer B drop'),
    },
    producerRate: 30,
    consumerRate: 45,
    transferRate: 300,
    response: 0.7,
    tickSeconds: 1,
    tick: 0,
    stats: { produced: 0, consumed: 0, requested: 0, pipeFlow: emptyFlows() },
  }
}

export function cloneState(state: SimulationState): SimulationState {
  return {
    ...state,
    pipes: Object.fromEntries(
      pipeIds.map((id) => [id, { ...state.pipes[id] }]),
    ) as Record<PipeId, Pipe>,
    stats: { ...state.stats, pipeFlow: { ...state.stats.pipeFlow } },
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function applyEndpoints(state: SimulationState): TickStats {
  const tickMinutes = state.tickSeconds / 60
  const stats: TickStats = {
    produced: 0,
    consumed: 0,
    requested: state.consumerRate * tickMinutes * 2,
    pipeFlow: emptyFlows(),
  }

  for (const [id, direction] of [
    ['left', 1],
    ['right', -1],
  ] as const) {
    const pipe = state.pipes[id]
    const amount = Math.min(
      state.producerRate * tickMinutes,
      state.transferRate * tickMinutes,
      pipe.capacity - pipe.volume,
    )
    pipe.volume += amount
    stats.produced += amount
    stats.pipeFlow[id] = amount * direction
  }

  for (const id of ['dropA', 'dropB'] as const) {
    const pipe = state.pipes[id]
    const amount = Math.min(
      state.consumerRate * tickMinutes,
      state.transferRate * tickMinutes,
      pipe.volume,
    )
    pipe.volume -= amount
    stats.consumed += amount
    stats.pipeFlow[id] = amount
  }

  return stats
}

function proposeTransfers(state: SimulationState): Transfer[] {
  const transfers: Transfer[] = []
  const transferLimit = state.transferRate * state.tickSeconds / 60

  for (const junction of junctions) {
    for (let a = 0; a < junction.length; a += 1) {
      for (let b = a + 1; b < junction.length; b += 1) {
        const first = state.pipes[junction[a]]
        const second = state.pipes[junction[b]]
        const difference = first.volume / first.capacity - second.volume / second.capacity
        if (Math.abs(difference) < 1e-9) continue

        const [from, to] = difference > 0 ? [first, second] : [second, first]
        const equalizingVolume =
          Math.abs(difference) * (from.capacity * to.capacity) / (from.capacity + to.capacity)
        transfers.push({
          from: from.id,
          to: to.id,
          amount: Math.min(
            equalizingVolume * clamp(state.response, 0, 1),
            transferLimit,
          ),
        })
      }
    }
  }

  return transfers
}

function applyTransfers(state: SimulationState, proposed: Transfer[]): void {
  const outgoing = emptyFlows()
  const incoming = emptyFlows()
  for (const transfer of proposed) {
    outgoing[transfer.from] += transfer.amount
    incoming[transfer.to] += transfer.amount
  }

  const sourceScale = Object.fromEntries(
    pipeIds.map((id) => [id, outgoing[id] > 0 ? Math.min(1, state.pipes[id].volume / outgoing[id]) : 1]),
  ) as Record<PipeId, number>
  const destinationScale = Object.fromEntries(
    pipeIds.map((id) => [
      id,
      incoming[id] > 0
        ? Math.min(1, (state.pipes[id].capacity - state.pipes[id].volume) / incoming[id])
        : 1,
    ]),
  ) as Record<PipeId, number>

  for (const transfer of proposed) {
    const amount = transfer.amount * Math.min(sourceScale[transfer.from], destinationScale[transfer.to])
    state.pipes[transfer.from].volume -= amount
    state.pipes[transfer.to].volume += amount
  }
}

export function tick(input: SimulationState): SimulationState {
  const next = cloneState(input)
  next.stats = applyEndpoints(next)
  applyTransfers(next, proposeTransfers(next))

  for (const id of pipeIds) {
    const change = next.pipes[id].volume - input.pipes[id].volume
    if (id === 'center') next.stats.pipeFlow[id] = change
  }
  next.tick += 1
  return next
}

export function totalVolume(state: SimulationState): number {
  return pipeIds.reduce((total, id) => total + state.pipes[id].volume, 0)
}

export const allPipeIds = pipeIds
