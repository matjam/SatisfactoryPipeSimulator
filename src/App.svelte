<script lang="ts">
  import { onDestroy } from 'svelte'
  import PipeCanvas from './lib/PipeCanvas.svelte'
  import { allPipeIds, cloneState, createInitialState, tick, type PipeId, type SimulationState } from './lib/simulation'

  let initial = createInitialState()
  let simulation: SimulationState = $state(cloneState(initial))
  let selected: PipeId = $state('center')
  let playing = $state(false)
  let speed = $state(2)
  let timer: ReturnType<typeof setInterval> | undefined

  const selectedPipe = $derived(simulation.pipes[selected])
  const satisfaction = $derived(
    simulation.stats.requested > 0 ? (simulation.stats.consumed / simulation.stats.requested) * 100 : 100,
  )

  function step() {
    simulation = tick(simulation)
  }

  function setPlaying(value: boolean) {
    playing = value
    restartTimer()
  }

  function restartTimer() {
    if (timer) clearInterval(timer)
    timer = playing ? setInterval(step, 1000 / speed) : undefined
  }

  function reset() {
    setPlaying(false)
    simulation = cloneState(initial)
  }

  function updatePipe(field: 'capacity' | 'volume', value: number) {
    const next = cloneState(simulation)
    next.pipes[selected][field] = value
    next.pipes[selected].volume = Math.min(next.pipes[selected].volume, next.pipes[selected].capacity)
    simulation = next
    initial = cloneState(next)
  }

  function updateSetting(field: 'producerRate' | 'consumerRate' | 'response', value: number) {
    simulation = { ...simulation, [field]: value }
    initial = cloneState(simulation)
  }

  function setTransferRate(value: number) {
    simulation = { ...simulation, transferRate: value === 600 ? 600 : 300 }
    initial = cloneState(simulation)
  }

  onDestroy(() => {
    if (timer) clearInterval(timer)
  })
</script>

<svelte:head>
  <title>Pipeworks | Satisfactory Pipe Simulator</title>
  <meta name="description" content="Step through demand-driven pipe flow and watch fluid deficits propagate." />
</svelte:head>

<main>
  <header class="masthead">
    <div class="brand-mark"><span></span><span></span><span></span></div>
    <div>
      <p class="eyebrow">FICSIT FLUID DYNAMICS DIVISION</p>
      <h1>PIPE<span>WORKS</span></h1>
    </div>
    <div class="status"><i class:live={playing}></i>{playing ? 'SIMULATION ACTIVE' : 'SIMULATION HALTED'}</div>
  </header>

  <section class="workspace">
    <div class="stage-panel">
      <div class="panel-heading">
        <div>
          <span>NETWORK 01</span>
          <strong>DUAL-FEED MANIFOLD</strong>
        </div>
        <div class="tick-readout">TICK <b>{simulation.tick.toString().padStart(4, '0')}</b></div>
      </div>
      <div class="stage">
        <PipeCanvas state={simulation} {selected} onselect={(id) => (selected = id)} />
      </div>
      <div class="transport">
        <button class="reset" onclick={reset}>RESET</button>
        <button class="primary" onclick={step} disabled={playing}>STEP ONE TICK</button>
        <button class="play" onclick={() => setPlaying(!playing)}>{playing ? 'PAUSE' : 'RUN'}</button>
        <label class="speed">SPEED
          <select bind:value={speed} onchange={restartTimer}>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
            <option value={4}>4×</option>
            <option value={8}>8×</option>
          </select>
        </label>
      </div>
    </div>

    <aside>
      <section class="metrics">
        <p class="eyebrow">SYSTEM TELEMETRY</p>
        <div class="metric"><span>Produced</span><strong>{simulation.stats.produced.toFixed(1)}</strong><small>m³ / tick</small></div>
        <div class="metric"><span>Consumed</span><strong>{simulation.stats.consumed.toFixed(1)}</strong><small>m³ / tick</small></div>
        <div class="metric satisfaction"><span>Demand met</span><strong>{satisfaction.toFixed(0)}%</strong><div><i style={`width:${Math.min(100, satisfaction)}%`}></i></div></div>
      </section>

      <section class="inspector">
        <p class="eyebrow">SELECTED PIPE</p>
        <select class="pipe-select" bind:value={selected}>
          {#each allPipeIds as id (id)}
            <option value={id}>{simulation.pipes[id].name}</option>
          {/each}
        </select>

        <label>CAPACITY <span>{selectedPipe.capacity} m³</span>
          <input type="range" min="10" max="600" step="10" value={selectedPipe.capacity} oninput={(event) => updatePipe('capacity', +event.currentTarget.value)} />
        </label>
        <label>CURRENT VOLUME <span>{selectedPipe.volume.toFixed(0)} m³</span>
          <input type="range" min="0" max={selectedPipe.capacity} step="1" value={selectedPipe.volume} oninput={(event) => updatePipe('volume', +event.currentTarget.value)} />
        </label>
      </section>

      <section class="inspector system">
        <p class="eyebrow">SYSTEM PARAMETERS</p>
        <label>PIPE TIER <span>{simulation.transferRate} m³/min</span>
          <select class="capacity-select" value={simulation.transferRate} onchange={(event) => setTransferRate(+event.currentTarget.value)}>
            <option value={300}>Mk.1 · 300 m³/min</option>
            <option value={600}>Mk.2 · 600 m³/min</option>
          </select>
        </label>
        <label>PRODUCER RATE <span>{simulation.producerRate} m³/min each</span>
          <input type="range" min="0" max="100" step="5" value={simulation.producerRate} oninput={(event) => updateSetting('producerRate', +event.currentTarget.value)} />
        </label>
        <label>CONSUMER RATE <span>{simulation.consumerRate} m³/min each</span>
          <input type="range" min="0" max="100" step="5" value={simulation.consumerRate} oninput={(event) => updateSetting('consumerRate', +event.currentTarget.value)} />
        </label>
        <label>FLOW RESPONSE <span>{Math.round(simulation.response * 100)}%</span>
          <input type="range" min="0.1" max="1" step="0.05" value={simulation.response} oninput={(event) => updateSetting('response', +event.currentTarget.value)} />
        </label>
      </section>
    </aside>
  </section>

  <footer>
    <span>EDUCATIONAL TRANSIENT-FLOW MODEL</span>
    <p>Pipes store fluid. Consumers create space. Adjacent segments respond on the next tick.</p>
    <span>BUILD 0.1.0</span>
  </footer>
</main>
