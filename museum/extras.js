async function playNote(rest, onStart) {
  const Audio = window.AudioContext || window.webkitAudioContext
  if (!Audio) return
  const context = new Audio()
  try {
    if (context.state !== 'running') {
      const resumed = await Promise.race([context.resume().then(() => true), rest])
      if (!resumed) return
    }
    if (context.state !== 'running') return

    // A single E4 with a few quiet overtones, reflected once off the room.
    const string = context.createOscillator()
    string.frequency.value = 329.63
    const partials = new Float32Array([0, 1, 0.32, 0.14, 0.06, 0.025])
    string.setPeriodicWave(context.createPeriodicWave(new Float32Array(partials.length), partials))
    const damper = context.createBiquadFilter()
    damper.Q.value = 0.5
    const envelope = context.createGain()
    const delay = context.createDelay()
    const reflection = context.createGain()
    delay.delayTime.value = 0.057
    reflection.gain.value = 0.12
    const output = context.createGain()
    string.connect(damper).connect(envelope).connect(output)
    envelope.connect(delay).connect(reflection).connect(output)
    output.connect(context.destination)

    const t = context.currentTime
    // Let the bright strike recede into the fundamental as the string rings out.
    damper.frequency.setValueAtTime(2600, t)
    damper.frequency.exponentialRampToValueAtTime(520, t + 0.85)
    envelope.gain.setValueAtTime(0, t)
    envelope.gain.linearRampToValueAtTime(0.18, t + 0.032)
    envelope.gain.exponentialRampToValueAtTime(0.075, t + 0.38)
    envelope.gain.exponentialRampToValueAtTime(0.0004, t + 2.6)
    envelope.gain.linearRampToValueAtTime(0, t + 2.7)
    const ended = new Promise(resolve => { string.onended = () => resolve(true) })
    string.start(t)
    onStart()
    string.stop(t + 2.8) // Keep the output open through the last reflection.
    const rangOut = await Promise.race([ended, rest])
    if (!rangOut && context.state === 'running') {
      const now = context.currentTime
      output.gain.setValueAtTime(1, now)
      output.gain.linearRampToValueAtTime(0, now + 0.04)
      string.stop(now + 0.05)
      await ended
    }
  } finally {
    await context.close()
  }
}

export function createExtras(readyAgeMs) {
  const hint = document.createElement('div')
  hint.inert = true
  hint.setAttribute('aria-hidden', 'true')
  hint.style.cssText = `position:fixed;left:18px;bottom:18px;z-index:2;opacity:0;
    display:grid;gap:3px;pointer-events:none;user-select:none;color:#555;
    font:600 18px/1 system-ui,sans-serif`
  for (const letter of 'WASD') {
    const key = document.createElement('kbd')
    key.textContent = letter
    key.style.cssText = `display:grid;place-items:center;width:32px;height:31px;font:inherit;
      background:#f5f5f5;border:1px solid #aaa;border-bottom-width:2px;border-radius:4px`
    if (letter === 'W') key.style.gridArea = '1 / 2'
    else key.style.gridRow = '2'
    hint.append(key)
  }
  document.body.append(hint)

  const title = document.createElement('div')
  title.textContent = 'The Hoffman Museum. (under construction)'
  title.inert = true
  title.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
    z-index:2;opacity:0;pointer-events:none;user-select:none;white-space:nowrap;
    font:400 clamp(24px,4vw,48px)/1.2 Georgia,serif;color:#222;
    padding:.12em .45em;background:rgba(255,255,255,.94)`

  const prompt = document.createElement('div')
  prompt.textContent = 'click to continue'
  prompt.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
    z-index:2;pointer-events:none;user-select:none;color:#555;font:13px/1.4 system-ui,sans-serif`

  const fadeStart = Math.max(3000, readyAgeMs)
  let revealed = false, paused = false, titleAge = 0
  let notesPlayed = 0, dampNote
  function restNote() { dampNote?.(false) }
  return {
    stepPage(ageMs) {
      if (revealed) return
      const elapsed = Math.max(0, ageMs - fadeStart)
      hint.style.opacity = 0.5 - 0.5 * Math.cos(2 * Math.PI * elapsed / 4200)
    },
    reveal() {
      if (revealed) return
      revealed = true
      hint.remove()
      document.body.append(title)
      const rest = new Promise(resolve => { dampNote = resolve })
      playNote(rest, () => { notesPlayed++ }).catch(() => {}) // Entry also works without audio.
    },
    stepMuseum(dtSeconds) {
      if (paused || !title.isConnected || dtSeconds <= 0) return
      titleAge += dtSeconds
      if (titleAge >= 4) title.remove()
      else {
        // Rise over one second, hold until 2.5 s, then ease back to transparent.
        const t = Math.min(titleAge, 1, (4 - titleAge) / 1.5)
        title.style.opacity = t * t * (3 - 2 * t)
      }
    },
    finishTitle() {
      // Called when focus starts, before the wall gives way to native HTML.
      title.remove()
      restNote()
    },
    setPaused(visible) {
      paused = visible
      if (visible) {
        restNote()
        document.body.append(prompt)
      } else prompt.remove()
    },
    restNote,
    get hintOpacity() { return revealed ? 0 : Number(hint.style.opacity) },
    get notesPlayed() { return notesPlayed },
  }
}
