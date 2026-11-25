// Call enter() inside an accepted entry / resume gesture, and quiet() on pause or focus.
// After physics, report each accepted jump(number) or momentum slide(), then step with
// the metres actually sprinted on the ground. step(0) also tends the piano at rest.
// The once-per-visit reveal note and its counter live in extras.js.

// A little study in D. Each row gives seconds, MIDI pitch and hammer strength.
// The upper line answers the open fifths below it. Its final E rings into the next D.
const phraseSeconds = 22.4
// Keep already-timed notes on the audio device through a slow museum frame.
// At most four keys fall in any two-second window of this score.
const scoreLookahead = 2
const refillLead = 1.5
const phrase = [
  [0, 50, .84], [.31, 57, .58], [.87, 66, .83], [1.84, 64, .63], [3.08, 69, .86], [4.43, 66, .54],
  [5.57, 49, .76], [5.91, 57, .55], [6.54, 64, .73], [7.46, 73, .80], [8.73, 71, .66],
  [11.12, 47, .81], [11.51, 54, .57], [12.20, 62, .78], [13.66, 69, .84], [14.91, 66, .63],
  [16.80, 52, .74], [17.16, 59, .49], [18.03, 61, .73], [19.11, 66, .78], [20.34, 64, .60],
]

export function createMuseumAudio() {
  let ctx, unlocking, output, strings, grain, wanted = false, playing = false
  let position = -2.3 // Leave the attack and body of the existing reveal note in the clear.
  let origin, scheduledUntil, distance = 0, left = true, lastFoot = -Infinity
  const voices = new Map()

  function discard(source) {
    const nodes = voices.get(source)
    if (!nodes) return
    for (const node of nodes) node.disconnect()
    voices.delete(source)
  }

  function sound(source, filter, t, attack, level, knee, sustain, end) {
    // A burst of synthetic fixed steps or repeated mode changes has a finite voice budget.
    if (voices.size >= 16) {
      const oldest = voices.keys().next().value
      oldest.stop()
      discard(oldest)
    }
    const amp = ctx.createGain()
    const path = filter ? [source, filter, amp] : [source, amp]
    for (let i = 1; i < path.length; i++) path[i - 1].connect(path[i])
    amp.connect(output)
    amp.gain.setValueAtTime(0, t)
    amp.gain.linearRampToValueAtTime(level, t + attack)
    amp.gain.exponentialRampToValueAtTime(sustain, t + knee)
    amp.gain.exponentialRampToValueAtTime(.00003, t + end - .012)
    amp.gain.linearRampToValueAtTime(0, t + end)
    voices.set(source, path)
    source.onended = () => discard(source)
    source.start(t)
    source.stop(t + end)
  }

  function noise(t, kind, from, to, length, level) {
    const brush = ctx.createBufferSource()
    brush.buffer = grain
    const filter = ctx.createBiquadFilter()
    filter.type = kind
    filter.Q.value = .72
    filter.frequency.setValueAtTime(from, t)
    filter.frequency.exponentialRampToValueAtTime(to, t + length)
    sound(brush, filter, t, length * .09, level, length * .42, level * .47, length)
  }

  function bend(t, from, to, length, level) {
    const body = ctx.createOscillator()
    body.frequency.setValueAtTime(from, t)
    body.frequency.exponentialRampToValueAtTime(to, t + length * .80)
    sound(body, null, t, .013, level, length * .41, level * .64, length)
  }

  function piano(t, midi, strength) {
    const hz = 440 * 2 ** ((midi - 69) / 12)
    const length = midi < 60 ? 4.6 : 3.75
    const key = ctx.createOscillator()
    key.setPeriodicWave(strings)
    key.frequency.value = hz
    const felt = ctx.createBiquadFilter()
    felt.Q.value = .55
    felt.frequency.setValueAtTime(hz * (5 + strength * 3), t)
    felt.frequency.exponentialRampToValueAtTime(hz * 1.8, t + .72)
    sound(key, felt, t, .015, .099 * strength, .56, .040 * strength, length)
    // The companion string blooms a little later and beats gently against the first.
    const twin = ctx.createOscillator()
    twin.frequency.value = hz * 1.0014
    sound(twin, null, t, .046, .022 * strength, .92, .013 * strength, length + .26)
  }

  function score(now) {
    const at = now - origin
    if (scheduledUntil > at + refillLead) return
    const from = Math.max(at, scheduledUntil), to = at + scoreLookahead
    for (let pass = Math.max(0, Math.floor(from / phraseSeconds)); pass <= Math.floor(to / phraseSeconds); pass++) {
      for (const [offset, midi, strength] of phrase) {
        const beat = pass * phraseSeconds + offset
        if (beat >= from && beat < to) piano(origin + beat, midi, strength)
      }
    }
    scheduledUntil = to
  }

  function hush() {
    if (!playing) return
    const now = ctx.currentTime
    position = now - origin
    playing = false
    distance = 0
    lastFoot = -Infinity
    output.gain.setTargetAtTime(0, now, .005)
    for (const source of voices.keys()) {
      source.stop(now + .034)
      if (ctx.state !== 'running') discard(source)
    }
  }

  function sync() {
    if (!wanted || ctx.state !== 'running') return hush()
    if (playing) return
    if (!output) {
      strings = ctx.createPeriodicWave(new Float32Array(8), Float32Array.of(0, 1, .43, .21, .14, .068, .034, .019))
      grain = ctx.createBuffer(1, 16384, 24000)
      const samples = grain.getChannelData(0)
      let seed = 4813
      for (let i = 0; i < samples.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        samples[i] = seed / 2147483648 - 1
      }
      output = ctx.createGain()
      output.connect(ctx.destination)
    }
    // A new gesture can arrive during the previous 34 ms release, even at the same audio time.
    for (const source of voices.keys()) discard(source)
    const now = ctx.currentTime
    output.gain.cancelScheduledValues(now)
    output.gain.setValueAtTime(1, now)
    origin = now - position
    scheduledUntil = position
    playing = true
    score(now)
  }

  return {
    enter() {
      wanted = true
      try {
        if (!ctx || ctx.state === 'closed') {
          const Audio = window.AudioContext || window.webkitAudioContext
          if (!Audio) return
          hush()
          ctx = new Audio()
          output = null
          ctx.onstatechange = sync
        }
        sync()
        if (ctx.state !== 'running' && unlocking !== ctx) {
          const device = ctx
          const resumed = device.resume()
          unlocking = device
          resumed.then(sync).catch(() => {}).finally(() => {
            if (unlocking === device) unlocking = null
          })
        }
      } catch { /* An unavailable output device leaves exploration silent. */ }
    },
    quiet() {
      wanted = false
      hush()
    },
    jump(number) {
      if (!playing || ctx.state !== 'running' || (number !== 1 && number !== 2)) return
      const t = ctx.currentTime
      bend(t, number === 1 ? 138 : 185, number === 1 ? 247 : 330, .22, .043)
      noise(t, 'bandpass', 750, 1370, .15, .037)
    },
    slide() {
      if (playing && ctx.state === 'running') noise(ctx.currentTime, 'bandpass', 2100, 360, .52, .14)
    },
    step(sprintMetres) {
      if (!playing || ctx.state !== 'running') return
      const now = ctx.currentTime
      score(now)
      if (!(sprintMetres > 0 && Number.isFinite(sprintMetres))) return
      distance += sprintMetres
      if (distance < 2.05) return
      distance %= 2.05
      // A long frame can span several paces. Voice only the current footfall.
      if (now - lastFoot < .13) return
      lastFoot = now
      left = !left
      bend(now, left ? 127 : 112, left ? 68 : 61, .14, .050)
      noise(now, 'lowpass', left ? 1040 : 860, 280, .105, .085)
    },
  }
}
