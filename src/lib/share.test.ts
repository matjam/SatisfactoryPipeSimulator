import { describe, expect, it } from 'vitest'
import { createDefaultDocument, type NetworkDocument } from './simulation'
import { decodeDocument, encodeDocument } from './share'

const rawPayload = (value: unknown): string => btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')

describe('network sharing', () => {
  it('round trips a configured v2 document without transient state', () => {
    const document = createDefaultDocument(); document.pipes[0].length = 42; document.pipes[0].initialVolume = 42; document.pipes[0].tier = 600
    expect(decodeDocument(encodeDocument(document))).toEqual(document)
    expect(encodeDocument(document)).not.toContain('elapsedSeconds')
  })
  it('migrates a valid v1 graph', () => {
    const v1 = { version: 1, name: 'Old', transferTier: 300, response: .7, tickSeconds: 1, nodes: [{ id: 'p', kind: 'producer', name: 'P', rate: 30, x: 0, y: 0 }], pipes: [{ id: 'a', name: 'A', capacity: 10, initialVolume: 5, endpoints: [{ x: 0, y: 0, attachment: { kind: 'node', id: 'p' } }, { x: 1, y: 1 }] }] }
    const migrated = decodeDocument(rawPayload(v1)); expect(migrated.version).toBe(2); expect(migrated.components[0].kind).toBe('producer'); expect(migrated.pipes[0].initialVolume).toBe(5)
  })
  it('rejects malformed and unsupported payloads', () => {
    expect(() => decodeDocument('not-json')).toThrow(/Malformed/)
    expect(() => decodeDocument(rawPayload({ ...createDefaultDocument(), version: 99 }))).toThrow(/Unsupported/)
  })
  it('rejects invalid values, references, and cardinality', () => {
    const invalid = createDefaultDocument(); invalid.pipes[0].length = Number.NaN; expect(() => decodeDocument(rawPayload(invalid))).toThrow(/[Ii]nvalid/)
    const full = createDefaultDocument(); for (let index = 0; index < 5; index++) full.pipes.push({ id: `extra-${index}`, name: 'x', length: 1, tier: 300, initialVolume: 0, endpoints: [{ x: 0, y: 0, z: 0, attachment: { kind: 'junction', id: 'too-many' } }, { x: 1, y: 0, z: 0 }] }); expect(() => decodeDocument(encodeDocument(full))).toThrow(/cardinality/)
  })
  it('sanitizes unknown fields and accepts reordered attachment properties', () => {
    const raw = createDefaultDocument() as NetworkDocument & { ignored?: string }; raw.ignored = 'discard'; const endpoint = raw.pipes[0].endpoints[0]; endpoint.attachment = { port: 'out', id: 'producer-west', kind: 'component' }
    const decoded = decodeDocument(rawPayload(raw)); expect('ignored' in decoded).toBe(false); expect(decoded.pipes[0].endpoints[0].attachment).toEqual({ kind: 'component', id: 'producer-west', port: 'out' })
  })
  it('rejects malformed or unrepresentable v1 migration and oversized encode', () => {
    const malformed = { version: 1, name: 'Old', transferTier: 300, response: .7, tickSeconds: 1, nodes: [], pipes: [{ id: 'p', name: 'p', capacity: 100, initialVolume: 90, endpoints: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }] }
    expect(() => decodeDocument(rawPayload(malformed))).toThrow(/cannot be represented/)
    const huge = createDefaultDocument(); huge.components = []; huge.pipes = Array.from({ length: 500 }, (_, index) => ({ id: `pipe-${index}`, name: 'x'.repeat(100), length: 56, tier: 300 as const, initialVolume: 0, endpoints: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }] })); expect(() => encodeDocument(huge)).toThrow(/too large/)
  })
  it('rejects excessive simulation work and inconsistent attachment geometry', () => {
    const fast = createDefaultDocument(); const machine = fast.components[0]; if (machine.kind !== 'producer') throw new Error('Fixture changed.'); machine.cycleSeconds = .01
    expect(() => decodeDocument(rawPayload(fast))).toThrow(/cyclic machine/)
    const longTick = createDefaultDocument(); longTick.tickSeconds = 60
    expect(() => decodeDocument(rawPayload(longTick))).toThrow(/settings/)
    const distant = createDefaultDocument(); distant.pipes[0].endpoints[0].x = 900
    expect(() => decodeDocument(rawPayload(distant))).toThrow(/geometry/)
    const splitJunction = createDefaultDocument(); splitJunction.pipes[0].endpoints[1].z = 4
    expect(() => decodeDocument(rawPayload(splitJunction))).toThrow(/junction/)
  })
})
