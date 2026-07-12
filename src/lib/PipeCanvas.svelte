<script lang="ts">
  import { onMount } from 'svelte'
  import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js'
  import type { PipeId, SimulationState } from './simulation'

  let {
    state,
    selected,
    onselect,
  }: {
    state: SimulationState
    selected: PipeId
    onselect: (id: PipeId) => void
  } = $props()

  let host: HTMLDivElement
  let renderer: PipeRenderer | undefined

  onMount(() => {
    let disposed = false
    const instance = new PipeRenderer(host, onselect)
    instance.initialize().then(() => {
      if (disposed) instance.destroy()
      else {
        renderer = instance
        renderer.draw(state, selected)
      }
    })

    return () => {
      disposed = true
      renderer?.destroy()
    }
  })

  $effect(() => {
    renderer?.draw(state, selected)
  })

  interface PipeView {
    id: PipeId
    x1: number
    y1: number
    x2: number
    y2: number
  }

  const views: PipeView[] = [
    { id: 'left', x1: 145, y1: 230, x2: 350, y2: 230 },
    { id: 'center', x1: 350, y1: 230, x2: 650, y2: 230 },
    { id: 'right', x1: 650, y1: 230, x2: 855, y2: 230 },
    { id: 'dropA', x1: 350, y1: 230, x2: 350, y2: 430 },
    { id: 'dropB', x1: 650, y1: 230, x2: 650, y2: 430 },
  ]

  class PipeRenderer {
    private app = new Application()
    private network = new Container()
    private pipeLayers = new Map<PipeId, Container>()
    private resizeObserver: ResizeObserver
    private element: HTMLDivElement
    private selectPipe: (id: PipeId) => void

    constructor(
      element: HTMLDivElement,
      selectPipe: (id: PipeId) => void,
    ) {
      this.element = element
      this.selectPipe = selectPipe
      this.resizeObserver = new ResizeObserver(() => this.fit())
    }

    async initialize() {
      await this.app.init({
        antialias: true,
        backgroundAlpha: 0,
        resizeTo: this.element,
        resolution: window.devicePixelRatio,
        autoDensity: true,
      })
      this.element.appendChild(this.app.canvas)
      this.app.stage.addChild(this.network)
      this.resizeObserver.observe(this.element)
      this.createScene()
      this.fit()
    }

    private createScene() {
      const grid = new Graphics()
      for (let x = 50; x <= 950; x += 50) grid.moveTo(x, 80).lineTo(x, 500)
      for (let y = 80; y <= 500; y += 50) grid.moveTo(50, y).lineTo(950, y)
      grid.stroke({ color: 0x25313a, width: 1, alpha: 0.42 })
      this.network.addChild(grid)

      this.addMachine(80, 230, 'P', 'WEST\nPRODUCER', 0xf5a524)
      this.addMachine(920, 230, 'P', 'EAST\nPRODUCER', 0xf5a524)
      this.addMachine(350, 475, 'C', 'CONSUMER A', 0xf06449)
      this.addMachine(650, 475, 'C', 'CONSUMER B', 0xf06449)

      for (const view of views) {
        const layer = new Container()
        layer.eventMode = 'static'
        layer.cursor = 'pointer'
        layer.hitArea = this.hitArea(view)
        layer.on('pointertap', () => this.selectPipe(view.id))
        this.pipeLayers.set(view.id, layer)
        this.network.addChild(layer)
      }

      for (const [x, y] of [[350, 230], [650, 230]]) {
        this.network.addChild(new Graphics().circle(x, y, 18).fill(0x121a20).stroke({ color: 0xf5a524, width: 4 }))
      }
    }

    private hitArea(view: PipeView) {
      const padding = 22
      return {
        contains: (x: number, y: number) =>
          x >= Math.min(view.x1, view.x2) - padding &&
          x <= Math.max(view.x1, view.x2) + padding &&
          y >= Math.min(view.y1, view.y2) - padding &&
          y <= Math.max(view.y1, view.y2) + padding,
      }
    }

    private addMachine(x: number, y: number, icon: string, label: string, color: number) {
      const machine = new Container()
      machine.addChild(new Graphics().roundRect(-43, -43, 86, 86, 14).fill(0x172129).stroke({ color, width: 3 }))
      const iconText = new Text({
        text: icon,
        style: new TextStyle({ fontFamily: 'Arial Black', fontSize: 30, fill: color }),
      })
      iconText.anchor.set(0.5)
      machine.addChild(iconText)
      const caption = new Text({
        text: label,
        style: new TextStyle({ fontFamily: 'monospace', fontSize: 12, fill: 0xaab7bd, align: 'center', letterSpacing: 1 }),
      })
      caption.anchor.set(0.5, 0)
      caption.y = 54
      machine.addChild(caption)
      machine.position.set(x, y)
      this.network.addChild(machine)
    }

    draw(state: SimulationState, selected: PipeId) {
      if (!this.pipeLayers.size) return
      for (const view of views) {
        const layer = this.pipeLayers.get(view.id)!
        layer.removeChildren().forEach((child) => child.destroy())
        const pipe = state.pipes[view.id]
        const fill = pipe.capacity > 0 ? pipe.volume / pipe.capacity : 0
        const horizontal = view.y1 === view.y2
        const length = Math.hypot(view.x2 - view.x1, view.y2 - view.y1)
        const angle = Math.atan2(view.y2 - view.y1, view.x2 - view.x1)
        const local = new Container({ x: view.x1, y: view.y1, rotation: angle })

        local.addChild(new Graphics().roundRect(0, -16, length, 32, 12).fill(0x0b1115).stroke({ color: selected === view.id ? 0xffcf5c : 0x4a5b64, width: selected === view.id ? 4 : 2 }))
        local.addChild(new Graphics().roundRect(5, -11, Math.max(0, (length - 10) * fill), 22, 8).fill({ color: this.fillColor(fill), alpha: 0.94 }))

        const markerOffset = state.tick === 0 ? 0.5 : ((state.tick * 0.17) % 0.8) + 0.1
        const direction = state.stats.pipeFlow[view.id] < 0 ? 1 - markerOffset : markerOffset
        const marker = new Graphics().poly([0, -6, 11, 0, 0, 6]).fill(0xe8fbff)
        marker.position.set(8 + (length - 16) * direction, 0)
        marker.alpha = Math.abs(state.stats.pipeFlow[view.id]) > 0.01 ? 0.9 : 0.18
        local.addChild(marker)
        layer.addChild(local)

        const label = new Text({
          text: `${Math.round(fill * 100)}%  ${pipe.volume.toFixed(1)} m³`,
          style: new TextStyle({ fontFamily: 'monospace', fontSize: 13, fontWeight: 'bold', fill: 0xe9f0f2 }),
        })
        label.anchor.set(0.5)
        label.position.set(
          (view.x1 + view.x2) / 2 + (horizontal ? 0 : 48),
          (view.y1 + view.y2) / 2 + (horizontal ? -34 : 0),
        )
        layer.addChild(label)
      }
    }

    private fillColor(fill: number): number {
      if (fill < 0.25) return 0xef5b5b
      if (fill < 0.6) return 0xf5a524
      return 0x20b8cd
    }

    private fit() {
      const scale = Math.min(this.element.clientWidth / 1000, this.element.clientHeight / 560)
      this.network.scale.set(scale)
      this.network.position.set(
        (this.element.clientWidth - 1000 * scale) / 2,
        (this.element.clientHeight - 560 * scale) / 2,
      )
    }

    destroy() {
      this.resizeObserver.disconnect()
      this.app.destroy(true, { children: true })
    }
  }
</script>

<div class="canvas" bind:this={host} aria-label="Interactive pipe network"></div>

<style>
  .canvas {
    width: 100%;
    height: 100%;
    min-height: 460px;
    overflow: hidden;
  }

  .canvas :global(canvas) {
    display: block;
  }

  @media (max-width: 760px) {
    .canvas {
      min-height: 340px;
    }
  }
</style>
