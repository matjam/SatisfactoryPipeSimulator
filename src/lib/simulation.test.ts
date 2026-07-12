import { describe, expect, it } from 'vitest'
import { createInitialState, tick, totalVolume } from './simulation'

describe('tick', () => {
  it('conserves fluid apart from measured production and consumption', () => {
    const initial = createInitialState()
    initial.pipes.dropA.volume = 40
    initial.pipes.dropB.volume = 40
    const before = totalVolume(initial)

    const next = tick(initial)

    expect(totalVolume(next)).toBeCloseTo(before + next.stats.produced - next.stats.consumed)
  })

  it('never exceeds pipe capacity or drains below zero', () => {
    let state = createInitialState()
    state.producerRate = 500
    state.consumerRate = 500

    for (let index = 0; index < 30; index += 1) state = tick(state)

    for (const pipe of Object.values(state.pipes)) {
      expect(pipe.volume).toBeGreaterThanOrEqual(0)
      expect(pipe.volume).toBeLessThanOrEqual(pipe.capacity)
    }
  })

  it('feeds identical branches symmetrically', () => {
    const initial = createInitialState()
    const next = tick(initial)

    expect(next.pipes.dropA.volume).toBeCloseTo(next.pipes.dropB.volume)
    expect(next.pipes.left.volume).toBeCloseTo(next.pipes.right.volume)
  })

  it('limits endpoints by configured pipe throughput', () => {
    const initial = createInitialState()
    initial.consumerRate = 500
    initial.transferRate = 300
    initial.tickSeconds = 60
    initial.pipes.dropA.capacity = 1000
    initial.pipes.dropA.volume = 1000
    initial.pipes.dropB.capacity = 1000
    initial.pipes.dropB.volume = 1000

    const next = tick(initial)

    expect(next.stats.consumed).toBe(600)
  })

  it('does not mutate the previous snapshot', () => {
    const initial = createInitialState()
    const volumes = Object.values(initial.pipes).map((pipe) => pipe.volume)

    tick(initial)

    expect(Object.values(initial.pipes).map((pipe) => pipe.volume)).toEqual(volumes)
  })
})
