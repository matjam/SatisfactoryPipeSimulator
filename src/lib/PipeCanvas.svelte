<script lang="ts">
  import { onMount } from 'svelte'
  import { Application, Container, Graphics, Rectangle, Text, TextStyle, type FederatedPointerEvent } from 'pixi.js'
  import { pipeCapacity, type NetworkDocument, type Selection, type SimulationState } from './simulation'

  const FLOW_EPSILON = 1e-6
  let { document, state, mode, selected, onselect, onmovenode, onmoveendpoint, onerror }: {
    document: NetworkDocument
    state: SimulationState
    mode: 'edit' | 'simulate'
    selected?: Selection
    onselect: (selection: Selection) => void
    onmovenode: (id: string, x: number, y: number) => void
    onmoveendpoint: (pipeId: string, endpoint: 0 | 1, x: number, y: number) => void
    onerror: (message: string) => void
  } = $props()

  let host: HTMLDivElement
  let renderer: PipeRenderer | undefined

  onMount(() => {
    let disposed = false
    const instance = new PipeRenderer(host)
    void instance.initialize().then(() => {
      if (disposed) instance.destroy()
      else { renderer = instance; renderer.draw(document, state, mode, selected, onselect, onmovenode, onmoveendpoint) }
    }).catch((error: unknown) => onerror(error instanceof Error ? `Renderer failed: ${error.message}` : 'Renderer failed to initialize.'))
    return () => { disposed = true; renderer?.destroy() }
  })

  $effect(() => renderer?.draw(document, state, mode, selected, onselect, onmovenode, onmoveendpoint))

  class PipeRenderer {
    private app = new Application()
    private network = new Container()
    private observer: ResizeObserver
    private element: HTMLDivElement
    private viewportInitialized = false
    private grid?: Graphics
    private panPointer?: number
    private readonly wheel = (event: WheelEvent) => {
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) {
        const bounds = this.element.getBoundingClientRect()
        const pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
        const oldScale = this.network.scale.x
        const nextScale = Math.max(.2, Math.min(3, oldScale * Math.exp(-event.deltaY * .002)))
        const world = {
          x: (pointer.x - this.network.position.x) / oldScale,
          y: (pointer.y - this.network.position.y) / oldScale,
        }
        this.network.scale.set(nextScale)
        this.network.position.set(pointer.x - world.x * nextScale, pointer.y - world.y * nextScale)
      } else {
        const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? this.element.clientHeight : 1
        this.network.position.x -= event.deltaX * unit
        this.network.position.y -= event.deltaY * unit
      }
      this.drawGrid()
    }
    constructor(element: HTMLDivElement) { this.element = element; this.observer = new ResizeObserver(() => this.fit()) }

    async initialize() {
      await this.app.init({ antialias: true, backgroundAlpha: 0, resizeTo: this.element, resolution: window.devicePixelRatio, autoDensity: true })
      this.element.appendChild(this.app.canvas)
      this.app.stage.addChild(this.network)
      this.observer.observe(this.element)
      this.element.addEventListener('wheel', this.wheel, { passive: false })
      this.app.stage.eventMode = 'static'
      this.app.stage.on('pointerdown', (event: FederatedPointerEvent) => {
        if (event.target !== this.app.stage || this.panPointer !== undefined) return
        this.panPointer = event.pointerId
        const start = event.global.clone()
        const origin = this.network.position.clone()
        const move = (next: FederatedPointerEvent) => {
          if (next.pointerId !== this.panPointer) return
          this.network.position.set(origin.x + next.global.x - start.x, origin.y + next.global.y - start.y)
          this.drawGrid()
        }
        const up = (next: FederatedPointerEvent) => {
          if (next.pointerId !== this.panPointer) return
          this.panPointer = undefined
          this.app.stage.off('globalpointermove', move).off('pointerup', up).off('pointerupoutside', up)
        }
        this.app.stage.on('globalpointermove', move).on('pointerup', up).on('pointerupoutside', up)
      })
      this.fit()
    }

    private draggable(target: Container, enabled: boolean, done: (x: number, y: number) => void, preview?: (x: number, y: number, graphics: Graphics) => void) {
      if (!enabled) return
      target.eventMode = 'static'
      target.cursor = 'move'
      target.on('pointerdown', (event: FederatedPointerEvent) => {
        event.stopPropagation()
        const overlay = new Graphics()
        this.network.addChild(overlay)
        const move = (next: FederatedPointerEvent) => {
          const point = this.network.toLocal(next.global)
          target.position.set(point.x, point.y)
          preview?.(point.x, point.y, overlay)
        }
        const up = (next: FederatedPointerEvent) => {
          this.app.stage.off('globalpointermove', move).off('pointerup', up).off('pointerupoutside', up)
          overlay.destroy()
          const point = this.network.toLocal(next.global)
          done(Math.round(point.x), Math.round(point.y))
        }
        this.app.stage.on('globalpointermove', move).on('pointerup', up).on('pointerupoutside', up)
      })
    }

    draw(document: NetworkDocument, state: SimulationState, mode: 'edit' | 'simulate', selected: Selection | undefined, select: (selection: Selection) => void, moveNode: (id: string, x: number, y: number) => void, moveEndpoint: (pipeId: string, endpoint: 0 | 1, x: number, y: number) => void) {
      this.network.removeChildren().forEach((child) => child.destroy({ children: true }))
      this.grid = new Graphics()
      this.network.addChild(this.grid)
      this.drawGrid()

      for (const pipe of document.pipes) {
        const [a, b] = pipe.endpoints
        const layer = new Container()
        layer.eventMode = 'static'; layer.cursor = 'pointer'
        const hitPadding = mode === 'edit' ? 28 : 20
        layer.hitArea = { contains: (x: number, y: number) => {
          const dx = b.x - a.x, dy = b.y - a.y, lengthSquared = dx * dx + dy * dy
          const t = lengthSquared ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSquared)) : 0
          return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)) <= hitPadding
        } }
        layer.on('pointertap', () => select({ kind: 'pipe', id: pipe.id }))
        const capacity = pipeCapacity(pipe)
        const fill = capacity ? (state.volumes[pipe.id] ?? pipe.initialVolume) / capacity : 0
        const length = Math.hypot(b.x - a.x, b.y - a.y)
        const local = new Container({ x: a.x, y: a.y, rotation: Math.atan2(b.y - a.y, b.x - a.x) })
        const active = selected?.kind === 'pipe' && selected.id === pipe.id
        const flow = state.stats.pipes[pipe.id]?.through ?? 0
        const fluidHeight = 20 * Math.max(0, Math.min(1, fill))
        local.addChild(new Graphics().roundRect(0, -15, length, 30, 11).fill(0x0b1115).stroke({ color: active ? 0xffcf5c : 0x4a5b64, width: active ? 4 : 2 }))
        if (fluidHeight > 0) local.addChild(new Graphics().roundRect(5, 10 - fluidHeight, Math.max(0, length - 10), fluidHeight, Math.min(7, fluidHeight / 2)).fill(fill < .25 ? 0xef5b5b : fill < .6 ? 0xf5a524 : 0x20b8cd))
        const direction = Math.abs(flow) > FLOW_EPSILON ? Math.sign(flow) : 0
        if (direction) {
          const arrow = new Graphics().poly([-9, -7, 5, 0, -9, 7, -5, 0]).fill(0xf4fbfc).stroke({ color: 0x0b1115, width: 1 })
          arrow.position.set(length / 2, 0)
          if (direction < 0) arrow.rotation = Math.PI
          local.addChild(arrow)
        } else {
          local.addChild(new Graphics().circle(length / 2, 0, 3).fill({ color: 0xd3dde0, alpha: .55 }))
        }
        layer.addChild(local)
        const flowDirection = flow > FLOW_EPSILON ? 'A>B' : flow < -FLOW_EPSILON ? 'B>A' : 'IDLE'
        const label = new Text({ text: `${pipe.name}  ${Math.round(fill * 100)}%  ${flowDirection} ${Math.abs(flow).toFixed(2)} m3/tick`, style: new TextStyle({ fontFamily: 'monospace', fontSize: 12, fill: 0xe9f0f2 }) })
        label.anchor.set(.5); label.position.set((a.x + b.x) / 2, (a.y + b.y) / 2 - 27); layer.addChild(label)
        this.network.addChild(layer)
        if (mode === 'edit') pipe.endpoints.forEach((endpoint, index) => {
          const handle = new Container({ x: endpoint.x, y: endpoint.y })
          handle.addChild(new Graphics().circle(0, 0, 16).fill(endpoint.attachment ? 0xf5a524 : 0x172129).stroke({ color: 0xffcf5c, width: 3 }))
          const other = pipe.endpoints[index === 0 ? 1 : 0]
          this.draggable(handle, true, (x, y) => moveEndpoint(pipe.id, index as 0 | 1, x, y), (x, y, graphics) => graphics.clear().moveTo(other.x, other.y).lineTo(x, y).stroke({ color: 0xffcf5c, width: 6, alpha: .8 }))
          this.network.addChild(handle)
        })
      }

      for (const node of document.components) {
        const machine = new Container({ x: node.x, y: node.y })
        const colors = { producer: 0xf5a524, consumer: 0xf06449, pump: 0x20b8cd, valve: 0x9b8cff, buffer: 0x57d18b, industrialBuffer: 0x43a96e }
        const icons = { producer: 'P', consumer: 'C', pump: '>>', valve: 'V', buffer: 'B', industrialBuffer: 'IB' }
        const color = colors[node.kind]
        const active = selected?.kind === node.kind && selected.id === node.id
        const width = node.kind === 'industrialBuffer' ? 104 : node.kind === 'buffer' ? 92 : 80
        machine.addChild(new Graphics().roundRect(-width / 2, -40, width, 80, node.kind.includes('Buffer') || node.kind === 'buffer' ? 24 : 13).fill(0x172129).stroke({ color: active ? 0xffffff : color, width: active ? 5 : 3 }))
        const icon = new Text({ text: icons[node.kind], style: new TextStyle({ fontFamily: 'Arial Black', fontSize: node.kind === 'industrialBuffer' ? 20 : 28, fill: color }) })
        icon.anchor.set(.5); machine.addChild(icon)
        const caption = new Text({ text: node.name.toUpperCase(), style: new TextStyle({ fontFamily: 'monospace', fontSize: 11, fill: 0xaab7bd }) })
        caption.anchor.set(.5, 0); caption.y = 48; machine.addChild(caption)
        machine.eventMode = 'static'; machine.cursor = mode === 'edit' ? 'move' : 'pointer'
        machine.on('pointertap', () => select({ kind: node.kind, id: node.id }))
        this.draggable(machine, mode === 'edit', (x, y) => moveNode(node.id, x, y), (x, y, graphics) => {
          graphics.clear()
          for (const pipe of document.pipes) for (const [index, endpoint] of pipe.endpoints.entries()) if (endpoint.attachment?.kind === 'component' && endpoint.attachment.id === node.id) {
            const other = pipe.endpoints[index === 0 ? 1 : 0]
            graphics.moveTo(other.x, other.y).lineTo(x + (endpoint.x - node.x), y + (endpoint.y - node.y))
          }
          graphics.stroke({ color: 0xffcf5c, width: 6, alpha: .8 })
        })
        this.network.addChild(machine)
      }
    }

    private fit() {
      this.app.stage.hitArea = new Rectangle(0, 0, this.element.clientWidth, this.element.clientHeight)
      if (!this.viewportInitialized && this.element.clientWidth && this.element.clientHeight) {
        const scale = Math.min(this.element.clientWidth / 1000, this.element.clientHeight / 570)
        this.network.scale.set(scale)
        this.network.position.set((this.element.clientWidth - 1000 * scale) / 2, (this.element.clientHeight - 570 * scale) / 2)
        this.viewportInitialized = true
      }
      this.drawGrid()
    }
    private drawGrid() {
      if (!this.grid || !this.element.clientWidth || !this.element.clientHeight) return
      const scale = this.network.scale.x || 1
      const left = -this.network.position.x / scale
      const top = -this.network.position.y / scale
      const right = left + this.element.clientWidth / scale
      const bottom = top + this.element.clientHeight / scale
      const step = 50
      this.grid.clear()
      for (let x = Math.floor(left / step) * step; x <= right; x += step) this.grid.moveTo(x, top).lineTo(x, bottom)
      for (let y = Math.floor(top / step) * step; y <= bottom; y += step) this.grid.moveTo(left, y).lineTo(right, y)
      this.grid.stroke({ color: 0x25313a, width: 1 / scale, alpha: 0.42 })
    }
    destroy() { this.observer.disconnect(); this.element.removeEventListener('wheel', this.wheel); this.app.destroy(true, { children: true }) }
  }
</script>

<div class="canvas" bind:this={host} aria-label="Interactive pipe network"></div>

<style>
  .canvas { width: 100%; height: 100%; min-height: 460px; overflow: hidden; touch-action: none; }
  .canvas :global(canvas) { display: block; }
  @media (max-width: 760px) { .canvas { min-height: 340px; } }
</style>
