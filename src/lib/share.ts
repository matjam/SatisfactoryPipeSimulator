import { CAPACITY_PER_METRE, attachmentKey, componentPorts, makeComponent, type Attachment, type Component, type Endpoint, type NetworkDocument, type PipeDocument } from './simulation'

const finite = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
const text = (value: unknown, max = 100): value is string => typeof value === 'string' && value.length > 0 && value.length <= max
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const coordinate = (value: unknown): number => { if (!finite(value, -10000, 10000)) throw new Error('Invalid coordinate.'); return value }

function sanitizeComponent(value: unknown): Component {
  if (!record(value) || !text(value.id) || !text(value.name) || typeof value.powered !== 'boolean') throw new Error('Invalid component.')
  const base = { id: value.id, name: value.name, x: coordinate(value.x), y: coordinate(value.y), z: coordinate(value.z), powered: value.powered }
  if (value.kind === 'producer' || value.kind === 'consumer') {
    if (!finite(value.bufferCapacity, .001, 100000) || !finite(value.initialBuffer, 0, value.bufferCapacity) || !finite(value.cycleSeconds, .1, 86400) || !finite(value.batchAmount, 0, 100000) || !finite(value.headLift, 0, 10000)) throw new Error('Invalid cyclic machine.')
    return { ...base, kind: value.kind, bufferCapacity: value.bufferCapacity, initialBuffer: value.initialBuffer, cycleSeconds: value.cycleSeconds, batchAmount: value.batchAmount, headLift: value.headLift }
  }
  if (value.kind === 'pump') { if ((value.tier !== 1 && value.tier !== 2) || (value.direction !== 'in-to-out' && value.direction !== 'out-to-in')) throw new Error('Invalid pump.'); return { ...base, kind: 'pump', tier: value.tier, direction: value.direction } }
  if (value.kind === 'valve') { if (!finite(value.cap, 0, 600) || (value.direction !== 'in-to-out' && value.direction !== 'out-to-in')) throw new Error('Invalid valve.'); return { ...base, kind: 'valve', cap: value.cap, direction: value.direction } }
  if (value.kind === 'buffer' || value.kind === 'industrialBuffer') { const capacity = value.kind === 'buffer' ? 400 : 2400; if (!finite(value.initialVolume, 0, capacity)) throw new Error('Invalid buffer.'); return { ...base, kind: value.kind, initialVolume: value.initialVolume } }
  throw new Error('Invalid component kind.')
}

function sanitizeAttachment(value: unknown, components: Map<string, Component>): Attachment {
  if (!record(value) || !text(value.id)) throw new Error('Invalid attachment.')
  if (value.kind === 'junction') return { kind: 'junction', id: value.id }
  if (value.kind !== 'component' || !text(value.port)) throw new Error('Invalid attachment.')
  const component = components.get(value.id)
  if (!component || !componentPorts(component).includes(value.port)) throw new Error('Invalid component port reference.')
  return { kind: 'component', id: value.id, port: value.port }
}
function sanitizeEndpoint(value: unknown, components: Map<string, Component>): Endpoint {
  if (!record(value)) throw new Error('Invalid endpoint.')
  const endpoint: Endpoint = { x: coordinate(value.x), y: coordinate(value.y), z: coordinate(value.z) }
  if (value.attachment !== undefined) endpoint.attachment = sanitizeAttachment(value.attachment, components)
  return endpoint
}
function sanitizePipe(value: unknown, components: Map<string, Component>): PipeDocument {
  if (!record(value) || !text(value.id) || !text(value.name) || !finite(value.length, 1, 56) || (value.tier !== 300 && value.tier !== 600) || !finite(value.initialVolume, 0, value.length * CAPACITY_PER_METRE) || !Array.isArray(value.endpoints) || value.endpoints.length !== 2) throw new Error('Invalid pipe.')
  return { id: value.id, name: value.name, length: value.length, tier: value.tier, initialVolume: value.initialVolume, endpoints: [sanitizeEndpoint(value.endpoints[0], components), sanitizeEndpoint(value.endpoints[1], components)] }
}

function verifyTopology(document: NetworkDocument): NetworkDocument {
  const componentIds = new Set(document.components.map((component) => component.id)), pipeIds = new Set(document.pipes.map((pipe) => pipe.id))
  if (componentIds.size !== document.components.length || pipeIds.size !== document.pipes.length) throw new Error('Shared network contains duplicate IDs.')
  const counts = new Map<string, number>()
  const junctionPositions = new Map<string, Endpoint>()
  for (const pipe of document.pipes) for (const endpoint of pipe.endpoints) if (endpoint.attachment) {
    const key = attachmentKey(endpoint.attachment); counts.set(key, (counts.get(key) ?? 0) + 1)
    if (endpoint.attachment.kind === 'junction') {
      const position = junctionPositions.get(key)
      if (position && (position.x !== endpoint.x || position.y !== endpoint.y || position.z !== endpoint.z)) throw new Error('Shared junction endpoints must occupy the same position and elevation.')
      junctionPositions.set(key, endpoint)
    } else {
      const component = document.components.find((item) => item.id === endpoint.attachment?.id)
      if (!component || Math.hypot(component.x - endpoint.x, component.y - endpoint.y) > 60 || component.z !== endpoint.z) throw new Error('Shared component attachment geometry is inconsistent.')
    }
  }
  for (const [key, count] of counts) if ((key.startsWith('junction:') && count > 4) || (key.startsWith('component:') && count > 1)) throw new Error('Shared network exceeds port or junction cardinality.')
  return document
}

function migrateV1(value: Record<string, unknown>): NetworkDocument {
  if (!text(value.name) || !Array.isArray(value.nodes) || value.nodes.length > 200 || !Array.isArray(value.pipes) || value.pipes.length > 500 || (value.transferTier !== 300 && value.transferTier !== 600) || !finite(value.response, 0, 1) || !finite(value.tickSeconds, .1, 10)) throw new Error('Invalid version 1 network.')
  const components = value.nodes.map((item) => {
    if (!record(item) || !text(item.id) || !text(item.name) || (item.kind !== 'producer' && item.kind !== 'consumer') || !finite(item.rate, 0, 100000)) throw new Error('Invalid version 1 node.')
    const component = makeComponent(item.kind, item.id, coordinate(item.x), coordinate(item.y)); component.name = item.name
    if (component.kind === 'producer' || component.kind === 'consumer') component.batchAmount = item.rate
    return component
  })
  const componentMap = new Map(components.map((component) => [component.id, component]))
  const pipes = value.pipes.map((item) => {
    if (!record(item) || !text(item.id) || !text(item.name) || !finite(item.capacity, CAPACITY_PER_METRE, 56 * CAPACITY_PER_METRE) || !finite(item.initialVolume, 0, item.capacity) || !Array.isArray(item.endpoints) || item.endpoints.length !== 2) throw new Error('Version 1 pipe capacity cannot be represented by the 1-56m v2 length range.')
    const legacyEndpoint = (raw: unknown): Endpoint => {
      if (!record(raw)) throw new Error('Invalid version 1 endpoint.')
      const endpoint: Endpoint = { x: coordinate(raw.x), y: coordinate(raw.y), z: 0 }
      if (raw.attachment !== undefined) {
        if (!record(raw.attachment) || !text(raw.attachment.id)) throw new Error('Invalid version 1 attachment.')
        endpoint.attachment = raw.attachment.kind === 'junction' ? { kind: 'junction', id: raw.attachment.id } : sanitizeAttachment({ kind: 'component', id: raw.attachment.id, port: componentMap.get(raw.attachment.id)?.kind === 'producer' ? 'out' : 'in' }, componentMap)
      }
      return endpoint
    }
    return { id: item.id, name: item.name, length: item.capacity / CAPACITY_PER_METRE, tier: value.transferTier as 300 | 600, initialVolume: item.initialVolume, endpoints: [legacyEndpoint(item.endpoints[0]), legacyEndpoint(item.endpoints[1])] as [Endpoint, Endpoint] }
  })
  return verifyTopology({ version: 2, name: value.name, components, pipes, defaultTier: value.transferTier, response: value.response, tickSeconds: value.tickSeconds, fluid: 'liquid' })
}

export function validateDocument(value: unknown): NetworkDocument {
  if (!record(value)) throw new Error('Shared network is not an object.')
  if (value.version === 1) return migrateV1(value)
  if (value.version !== 2) throw new Error(`Unsupported network version ${String(value.version)}.`)
  if (!text(value.name) || !Array.isArray(value.components) || value.components.length > 200 || !Array.isArray(value.pipes) || value.pipes.length > 500 || (value.defaultTier !== 300 && value.defaultTier !== 600) || !finite(value.response, 0, 1) || !finite(value.tickSeconds, .1, 10) || value.fluid !== 'liquid') throw new Error('Shared network has invalid settings.')
  const components = value.components.map(sanitizeComponent), componentMap = new Map(components.map((component) => [component.id, component]))
  return verifyTopology({ version: 2, name: value.name, components, pipes: value.pipes.map((pipe) => sanitizePipe(pipe, componentMap)), defaultTier: value.defaultTier, response: value.response, tickSeconds: value.tickSeconds, fluid: 'liquid' })
}

export function encodeDocument(document: NetworkDocument): string {
  const sanitized = validateDocument(document), bytes = new TextEncoder().encode(JSON.stringify(sanitized))
  if (bytes.length > 75000) throw new Error('Network is too large to share in a URL.')
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}
export function decodeDocument(payload: string): NetworkDocument {
  if (!payload || payload.length > 100000 || !/^[A-Za-z0-9_-]+$/.test(payload)) throw new Error('Malformed share payload.')
  let parsed: unknown
  try { const base64 = payload.replaceAll('-', '+').replaceAll('_', '/'); const binary = atob(base64 + '='.repeat((4 - base64.length % 4) % 4)); parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)))) }
  catch (error) { throw new Error('Malformed share payload.', { cause: error }) }
  return validateDocument(parsed)
}
