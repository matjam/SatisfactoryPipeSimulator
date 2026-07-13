<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import PipeCanvas from './lib/PipeCanvas.svelte'
  import { canAttach, cloneDocument, componentCapacity, componentFullHead, componentPorts, createDefaultDocument, createId, createSimulation, deleteSelection, makeComponent, moveJunction as moveJunctionEndpoints, pipeCapacity, splitPipeAt, tick, type Attachment, type ComponentKind, type NetworkDocument, type Selection, type SimulationState } from './lib/simulation'
  import { decodeDocument, encodeDocument } from './lib/share'

  let status = $state('')
  let shareUrl = $state('')
  const loaded = loadDocument()
  let document: NetworkDocument = $state(loaded)
  let simulation: SimulationState = $state(createSimulation(loaded))
  let selected: Selection | undefined = $state({ kind: 'pipe', id: 'center' })
  let mode: 'edit' | 'simulate' = $state('edit')
  let playing = $state(false), speed = $state(2)
  let timer: ReturnType<typeof setInterval> | undefined
  const selectedPipe = $derived(selected?.kind === 'pipe' ? document.pipes.find((pipe) => pipe.id === selected?.id) : undefined)
  const selectedComponent = $derived(selected?.kind !== 'pipe' ? document.components.find((component) => component.id === selected?.id) : undefined)
  const satisfaction = $derived(simulation.stats.requested ? simulation.stats.consumed / simulation.stats.requested * 100 : 100)

  function loadDocument(): NetworkDocument { if (!location.hash.startsWith('#network=')) return createDefaultDocument(); try { return decodeDocument(location.hash.slice(9)) } catch (error) { status = error instanceof Error ? error.message : 'Unable to load shared network.'; return createDefaultDocument() } }
  function reset() { setPlaying(false); simulation = createSimulation(document); status = '' }
  function edit(mutator: (next: NetworkDocument) => void) { const next = cloneDocument(document); mutator(next); document = next; if (!playing) simulation = createSimulation(next) }
  function setMode(value: 'edit' | 'simulate') { setPlaying(false); mode = value; if (value === 'simulate') reset() }
  function setPlaying(value: boolean) { playing = value; restartTimer() }
  function restartTimer() { if (timer) clearInterval(timer); timer = playing ? setInterval(() => simulation = tick(simulation), 1000 / speed) : undefined }
  function cascade(index: number): { x: number; y: number } { return { x: 180 + index % 6 * 115, y: 120 + Math.floor(index / 6) % 4 * 105 } }
  function addComponent(kind: ComponentKind) { const position = cascade(document.components.length); const component = makeComponent(kind, undefined, position.x, position.y); edit((next) => next.components.push(component)); selected = { kind, id: component.id }; status = '' }
  function addPipe() { const id = createId('pipe'), position = cascade(document.pipes.length); edit((next) => next.pipes.push({ id, name: 'New pipe', length: 10, tier: next.defaultTier, initialVolume: 0, endpoints: [{ x: position.x - 55, y: position.y, z: 0 }, { x: position.x + 55, y: position.y, z: 0 }] })); selected = { kind: 'pipe', id }; status = '' }
  function removeSelected() { if (!selected) return; document = deleteSelection(document, selected); selected = undefined; reset() }
  function moveComponent(id: string, x: number, y: number) { edit((next) => { const component = next.components.find((item) => item.id === id); if (!component) return; const dx = x - component.x, dy = y - component.y; component.x = x; component.y = y; for (const pipe of next.pipes) for (const endpoint of pipe.endpoints) if (endpoint.attachment?.kind === 'component' && endpoint.attachment.id === id) { endpoint.x += dx; endpoint.y += dy } }); status = '' }
  function moveJunction(id: string, x: number, y: number) { edit((next) => moveJunctionEndpoints(next, id, x, y)); status = '' }
  function attachEndpoint(next: NetworkDocument, pipeId: string, endpointIndex: 0 | 1, x: number, y: number) {
    const pipe = next.pipes.find((item) => item.id === pipeId); if (!pipe) return
    const endpoint = pipe.endpoints[endpointIndex]; endpoint.x = x; endpoint.y = y; delete endpoint.attachment
    const ports = next.components.flatMap((component) => componentPorts(component).map((port) => ({ component, port, x: component.x + (port === 'in' ? -42 : 42), y: component.y }))).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))
    const nearest = ports[0]
    if (nearest && Math.hypot(nearest.x - x, nearest.y - y) <= 36) {
      const attachment: Attachment = { kind: 'component', id: nearest.component.id, port: nearest.port }
      if (!canAttach(next, attachment)) { status = `${nearest.component.name} ${nearest.port} port is already connected.`; return }
      endpoint.x = nearest.x; endpoint.y = nearest.y; endpoint.z = nearest.component.z; endpoint.attachment = attachment; status = ''; return
    }
    for (const otherPipe of next.pipes) for (const candidate of otherPipe.endpoints) {
      if (otherPipe.id === pipeId || candidate === endpoint || Math.hypot(candidate.x - x, candidate.y - y) > 25) continue
      let attachment = candidate.attachment
      if (attachment?.kind === 'component') continue
      if (!attachment) { attachment = { kind: 'junction', id: createId('junction') }; candidate.attachment = attachment }
      if (!canAttach(next, attachment)) { status = 'Junction already has four endpoints; endpoint left disconnected.'; return }
      Object.assign(endpoint, { x: candidate.x, y: candidate.y, z: candidate.z, attachment: { ...attachment } }); status = ''; return
    }
    let bodyMatch: { pipeId: string; fraction: number; distance: number } | undefined, blockedBody = false
    for (const candidate of next.pipes) {
      if (candidate.id === pipeId) continue
      const [start, end] = candidate.endpoints
      const dx = end.x - start.x, dy = end.y - start.y, lengthSquared = dx * dx + dy * dy
      if (!lengthSquared) continue
      const fraction = Math.max(0, Math.min(1, ((x - start.x) * dx + (y - start.y) * dy) / lengthSquared))
      if (fraction <= .02 || fraction >= .98) continue
      const distance = Math.hypot(x - (start.x + dx * fraction), y - (start.y + dy * fraction))
      const minimumFraction = 1 / candidate.length
      if (distance <= 25 && (candidate.length < 2 || fraction < minimumFraction || fraction > 1 - minimumFraction)) { blockedBody = true; continue }
      if (distance <= 25 && (!bodyMatch || distance < bodyMatch.distance)) bodyMatch = { pipeId: candidate.id, fraction, distance }
    }
    if (bodyMatch) {
      const junctionId = createId('junction')
      const second = splitPipeAt(next, bodyMatch.pipeId, bodyMatch.fraction, junctionId)
      if (second) {
        const junction = second.endpoints[0]
        Object.assign(endpoint, { x: junction.x, y: junction.y, z: junction.z, attachment: { kind: 'junction', id: junctionId } })
        status = ''
      }
    } else if (blockedBody) status = 'Cannot split there: both resulting pipe segments must be at least 1m long.'
  }
  function moveEndpoint(pipeId: string, endpoint: 0 | 1, x: number, y: number) { edit((next) => attachEndpoint(next, pipeId, endpoint, x, y)) }
  function updateSelected(field: string, value: string | number | boolean) { if (typeof value === 'number' && !Number.isFinite(value)) return; edit((next) => { const item = selected?.kind === 'pipe' ? next.pipes.find((pipe) => pipe.id === selected?.id) : next.components.find((component) => component.id === selected?.id); if (!item) return; Object.assign(item, { [field]: value }); if ('z' in item && field === 'z' && 'kind' in item) for (const pipe of next.pipes) for (const endpoint of pipe.endpoints) if (endpoint.attachment?.kind === 'component' && endpoint.attachment.id === item.id) endpoint.z = item.z; if ('length' in item) { item.length = Math.max(1, Math.min(56, item.length)); item.initialVolume = Math.min(item.initialVolume, pipeCapacity(item)) } if ('cycleSeconds' in item) { item.cycleSeconds = Math.max(.1, item.cycleSeconds); item.bufferCapacity = Math.max(.001, item.bufferCapacity); item.batchAmount = Math.max(0, item.batchAmount); item.initialBuffer = Math.max(0, Math.min(item.initialBuffer, item.bufferCapacity)) } if ('initialVolume' in item && 'kind' in item) item.initialVolume = Math.max(0, Math.min(item.initialVolume, componentCapacity(item))) }); status = '' }
  function updateEndpoint(index: 0 | 1, z: number) { if (!Number.isFinite(z)) return; edit((next) => { const pipe = next.pipes.find((item) => item.id === selectedPipe?.id); if (!pipe) return; const endpoint = pipe.endpoints[index]; if (endpoint.attachment?.kind === 'component') { const component = next.components.find((item) => item.id === endpoint.attachment?.id); if (component) { component.z = z; for (const candidate of next.pipes.flatMap((item) => item.endpoints)) if (candidate.attachment?.kind === 'component' && candidate.attachment.id === component.id) candidate.z = z } } else endpoint.z = z }) }
  function updateGlobal(field: 'response' | 'tickSeconds' | 'defaultTier', value: number) { if (!Number.isFinite(value)) return; edit((next) => Object.assign(next, { [field]: field === 'defaultTier' ? value === 600 ? 600 : 300 : field === 'response' ? Math.max(0, Math.min(1, value)) : Math.max(.001, value) })); status = '' }
  async function share() { let area: HTMLTextAreaElement | undefined; try { const encoded = encodeDocument(document); const url = `${location.origin}${location.pathname}${location.search}#network=${encoded}`; history.replaceState(null, '', url); shareUrl = ''; try { await navigator.clipboard.writeText(url) } catch { area = window.document.createElement('textarea'); area.value = url; area.style.position = 'fixed'; area.style.opacity = '0'; window.document.body.appendChild(area); area.select(); if (!window.document.execCommand('copy')) { shareUrl = url; throw new Error('Clipboard unavailable. Select the link shown below.') } } status = 'Share link copied.' } catch (error) { status = error instanceof Error ? error.message : 'Could not copy share link.' } finally { area?.remove() } }
  onMount(() => { const handleHash = () => { if (!location.hash.startsWith('#network=')) return; try { const next = decodeDocument(location.hash.slice(9)); setPlaying(false); document = next; simulation = createSimulation(next); selected = undefined; status = 'Shared network loaded.' } catch (error) { status = error instanceof Error ? error.message : 'Unable to load shared network.' } }; window.addEventListener('hashchange', handleHash); return () => window.removeEventListener('hashchange', handleHash) })
  onDestroy(() => { if (timer) clearInterval(timer) })
</script>

<svelte:head><title>Pipeworks | Network Editor</title><meta name="description" content="Build, share, and simulate elevation-aware liquid pipe networks." /></svelte:head>
<main>
  <header class="masthead"><div class="brand-mark"><span></span><span></span><span></span></div><div><p class="eyebrow">FICSIT FLUID DYNAMICS DIVISION</p><h1>PIPE<span>WORKS</span></h1></div><div class="status"><i class:live={playing}></i>{mode.toUpperCase()} / LIQUID</div></header>
  {#if status}<div class="notice" role="status">{status}{#if shareUrl}<input class="share-url" readonly value={shareUrl} onclick={(event) => event.currentTarget.select()} />{/if}</div>{/if}
  <section class="workspace"><div class="stage-panel">
    <div class="panel-heading"><div><span>NETWORK DOCUMENT V{document.version}</span><strong>{document.name.toUpperCase()}</strong></div><div class="mode-switch"><button class:active={mode === 'edit'} onclick={() => setMode('edit')}>EDIT</button><button class:active={mode === 'simulate'} onclick={() => setMode('simulate')}>SIMULATE</button></div><div class="tick-readout">TICK <b>{simulation.tick.toString().padStart(4, '0')}</b></div></div>
    <div class="stage"><PipeCanvas {document} state={simulation} {mode} {selected} onselect={(value) => selected = value} onmovenode={moveComponent} onmoveendpoint={moveEndpoint} onmovejunction={moveJunction} onerror={(message) => status = message} /></div>
    <div class="transport">{#if mode === 'edit'}<button onclick={() => addComponent('producer')}>+ PRODUCER</button><button onclick={() => addComponent('consumer')}>+ CONSUMER</button><button onclick={() => addComponent('pump')}>+ PUMP</button><button onclick={() => addComponent('valve')}>+ VALVE</button><button onclick={() => addComponent('buffer')}>+ BUFFER</button><button onclick={() => addComponent('industrialBuffer')}>+ INDUSTRIAL</button><button onclick={addPipe}>+ PIPE</button><button class="danger" onclick={removeSelected} disabled={!selected}>DELETE</button>{:else}<button onclick={reset}>RESET</button><button class="primary" onclick={() => simulation = tick(simulation)} disabled={playing}>STEP</button><button onclick={() => setPlaying(!playing)}>{playing ? 'PAUSE' : 'RUN'}</button><label class="speed">SPEED <select bind:value={speed} onchange={restartTimer}><option value={1}>1x</option><option value={2}>2x</option><option value={4}>4x</option><option value={8}>8x</option></select></label>{/if}</div>
  </div><aside>
    <section class="metrics"><p class="eyebrow">SYSTEM TELEMETRY</p><div class="metric"><span>Produced</span><strong>{simulation.stats.produced.toFixed(1)}</strong><small>m3 / tick</small></div><div class="metric"><span>Consumed</span><strong>{simulation.stats.consumed.toFixed(1)}</strong><small>m3 / tick</small></div><div class="metric satisfaction"><span>Cycle demand met</span><strong>{satisfaction.toFixed(0)}%</strong><div><i style={`width:${Math.min(100, satisfaction)}%`}></i></div></div></section>
    <section class="inspector"><p class="eyebrow">SELECTION</p><fieldset disabled={mode === 'simulate'}>
      {#if selectedPipe}<label>NAME<input class="text-input" value={selectedPipe.name} oninput={(event) => updateSelected('name', event.currentTarget.value)} /></label><label>PHYSICAL LENGTH <span>{selectedPipe.length.toFixed(1)}m</span><input type="range" min="1" max="56" step=".5" value={selectedPipe.length} oninput={(event) => updateSelected('length', +event.currentTarget.value)} /></label><p class="current">CAPACITY: {pipeCapacity(selectedPipe).toFixed(2)} m3 (1.327 m3/m)</p><label>PIPE TIER<select class="capacity-select" value={selectedPipe.tier} onchange={(event) => updateSelected('tier', +event.currentTarget.value)}><option value={300}>Mk.1 - 300 m3/min</option><option value={600}>Mk.2 - 600 m3/min</option></select></label><label>INITIAL VOLUME <span>{selectedPipe.initialVolume.toFixed(1)} m3</span><input type="range" min="0" max={pipeCapacity(selectedPipe)} step=".1" value={selectedPipe.initialVolume} oninput={(event) => updateSelected('initialVolume', +event.currentTarget.value)} /></label><label>END A ELEVATION <span>{selectedPipe.endpoints[0].z}m</span><input type="number" value={selectedPipe.endpoints[0].z} oninput={(event) => updateEndpoint(0, +event.currentTarget.value)} /></label><label>END B ELEVATION <span>{selectedPipe.endpoints[1].z}m</span><input type="number" value={selectedPipe.endpoints[1].z} oninput={(event) => updateEndpoint(1, +event.currentTarget.value)} /></label>{@const telemetry = simulation.stats.pipes[selectedPipe.id]}<p class="current">CURRENT {(simulation.volumes[selectedPipe.id] ?? 0).toFixed(2)} m3<br />A fill/drain {telemetry?.ends[0].fill.toFixed(2) ?? 0}/{telemetry?.ends[0].drain.toFixed(2) ?? 0}<br />B fill/drain {telemetry?.ends[1].fill.toFixed(2) ?? 0}/{telemetry?.ends[1].drain.toFixed(2) ?? 0}<br />SIGNED THROUGH {telemetry?.through.toFixed(2) ?? 0} m3</p>
      {:else if selectedComponent}<label>NAME<input class="text-input" value={selectedComponent.name} oninput={(event) => updateSelected('name', event.currentTarget.value)} /></label><label>ELEVATION Z <span>{selectedComponent.z}m</span><input type="number" value={selectedComponent.z} oninput={(event) => updateSelected('z', +event.currentTarget.value)} /></label><label class="toggle"><input type="checkbox" checked={selectedComponent.powered} onchange={(event) => updateSelected('powered', event.currentTarget.checked)} /> POWERED / ENABLED</label>
        {#if selectedComponent.kind === 'producer' || selectedComponent.kind === 'consumer'}<label>CYCLE DURATION <span>{selectedComponent.cycleSeconds}s</span><input type="number" min=".1" value={selectedComponent.cycleSeconds} oninput={(event) => updateSelected('cycleSeconds', +event.currentTarget.value)} /></label><label>BATCH AMOUNT <span>{selectedComponent.batchAmount}m3</span><input type="number" min="0" value={selectedComponent.batchAmount} oninput={(event) => updateSelected('batchAmount', +event.currentTarget.value)} /></label><label>INTERNAL CAPACITY <span>{selectedComponent.bufferCapacity}m3</span><input type="number" min=".1" value={selectedComponent.bufferCapacity} oninput={(event) => updateSelected('bufferCapacity', +event.currentTarget.value)} /></label><label>INITIAL INTERNAL FLUID <span>{selectedComponent.initialBuffer}m3</span><input type="number" min="0" max={selectedComponent.bufferCapacity} value={selectedComponent.initialBuffer} oninput={(event) => updateSelected('initialBuffer', +event.currentTarget.value)} /></label>{#if selectedComponent.kind === 'producer'}<label>HEAD LIFT <span>{selectedComponent.headLift}m</span><input type="number" min="0" value={selectedComponent.headLift} oninput={(event) => updateSelected('headLift', +event.currentTarget.value)} /></label>{/if}
        {:else if selectedComponent.kind === 'pump'}<label>PUMP MARK<select class="capacity-select" value={selectedComponent.tier} onchange={(event) => updateSelected('tier', +event.currentTarget.value)}><option value={1}>Mk.1 - 20m head</option><option value={2}>Mk.2 - 50m head</option></select></label><label>DIRECTION<select class="capacity-select" value={selectedComponent.direction} onchange={(event) => updateSelected('direction', event.currentTarget.value)}><option value="in-to-out">IN to OUT</option><option value="out-to-in">OUT to IN</option></select></label>
        {:else if selectedComponent.kind === 'valve'}<label>FORWARD CAP <span>{selectedComponent.cap}m3/min</span><input type="range" min="0" max="600" value={selectedComponent.cap} oninput={(event) => updateSelected('cap', +event.currentTarget.value)} /></label><label>DIRECTION<select class="capacity-select" value={selectedComponent.direction} onchange={(event) => updateSelected('direction', event.currentTarget.value)}><option value="in-to-out">IN to OUT</option><option value="out-to-in">OUT to IN</option></select></label>
        {:else if selectedComponent.kind === 'buffer' || selectedComponent.kind === 'industrialBuffer'}<p class="current">CAPACITY {componentCapacity(selectedComponent)} m3<br />FULL STORED HEAD {componentFullHead(selectedComponent)}m<br />CURRENT {(simulation.componentVolumes[selectedComponent.id] ?? 0).toFixed(1)} m3</p><label>INITIAL VOLUME <span>{selectedComponent.initialVolume}m3</span><input type="range" min="0" max={componentCapacity(selectedComponent)} value={selectedComponent.initialVolume} oninput={(event) => updateSelected('initialVolume', +event.currentTarget.value)} /></label>{/if}
      {:else}<p class="empty">Select a component or pipe.</p>{/if}
    </fieldset></section>
    <section class="inspector system"><p class="eyebrow">MODEL SETTINGS</p><fieldset disabled={mode === 'simulate'}><label>DEFAULT NEW-PIPE TIER<select class="capacity-select" value={document.defaultTier} onchange={(event) => updateGlobal('defaultTier', +event.currentTarget.value)}><option value={300}>Mk.1</option><option value={600}>Mk.2</option></select></label><label>JUNCTION RESPONSE <span>{Math.round(document.response * 100)}%</span><input type="range" min="0" max="1" step=".05" value={document.response} oninput={(event) => updateGlobal('response', +event.currentTarget.value)} /></label><label>USER TICK <span>{document.tickSeconds}s</span><input type="range" min=".1" max="10" step=".1" value={document.tickSeconds} oninput={(event) => updateGlobal('tickSeconds', +event.currentTarget.value)} /></label></fieldset><button class="share" onclick={share}>SHARE LINK</button></section>
    <section class="model-info"><p class="eyebrow">FIDELITY / MODEL INFO</p><p><b>Official values:</b> 1.327 m3/m pipe capacity, 300/600 m3/min tiers, 20/50m pump head, 400/2400m3 buffers, and 8/12m full-buffer head.</p><p><b>Approximation:</b> liquid-only, finite-box storage, 0.1s hydraulic relaxation, fill-derived local head, and deterministic simultaneous allocation. This is behavioral calibration, not the proprietary game solver.</p></section>
  </aside></section>
  <footer><span>LIQUID MODEL / V2</span><p>Canvas geometry is layout only; length and elevation are explicit physical settings.</p><span>BUILD 0.3.0</span></footer>
</main>
