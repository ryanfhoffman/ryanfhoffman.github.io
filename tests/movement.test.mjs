// Tests for museum/movement.js. Run with: node --test tests/movement.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCharacter } from '../museum/movement.js'
import * as T from '../museum/tuning.js'

const OPEN = { solids: [], height: 100 } // nothing to hit
const FRAME = 1 / 60

const fresh = (world = OPEN) => createCharacter(world)
const down = (c, ...names) => names.forEach(name => c.key(name, true))
const up = (c, ...names) => names.forEach(name => c.key(name, false))
const tap = (c, name) => { c.key(name, true); c.key(name, false) }
const run = (c, seconds, each) => {
  for (let i = 0; i < Math.round(seconds / FRAME); i++) { c.advance(FRAME); each?.(c) }
}
const speed = c => Math.hypot(c.velocity.x, c.velocity.z)
const close = (actual, expected, tolerance, label = '') =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} expected ${expected} ± ${tolerance}, got ${actual}`)
// Distance from the character's centre to the nearest solid.
const clearance = (c, world) => Math.min(...world.solids.map(b => Math.hypot(
  c.position.x - Math.max(b.minX, Math.min(b.maxX, c.position.x)),
  c.position.z - Math.max(b.minZ, Math.min(b.maxZ, c.position.z)))))

// ---------------------------------------------------------------- frame rate

// A walled room with a pillar in the way, so the script also runs into and along solids,
// and a ceiling low enough for the double jump to reach.
const ROOM = {
  height: 3.8,
  solids: [
    { minX: -5, maxX: 5, minZ: -9.7, maxZ: -9.5 },
    { minX: -5, maxX: 5, minZ: 12, maxZ: 12.2 },
    { minX: -5.2, maxX: -5, minZ: -9.5, maxZ: 12 },
    { minX: 5, maxX: 5.2, minZ: -9.5, maxZ: 12 },
    { minX: 0.2, maxX: 1.2, minZ: -4, maxZ: -3 },
  ],
}

// Every event falls on a multiple of 1/6 second; `at` counts sixths.
const SCRIPT = [
  { at: 0, do: c => down(c, 'forward') },
  { at: 4, do: c => down(c, 'sprint') },
  { at: 8, do: c => down(c, 'slide') },
  { at: 10, do: c => up(c, 'slide') },
  { at: 11, do: c => tap(c, 'jump') },
  { at: 12, do: c => { c.yaw = 0.9 } },
  { at: 13, do: c => tap(c, 'jump') },
  { at: 14, do: c => { up(c, 'forward'); down(c, 'left') } },
  { at: 19, do: c => { c.yaw = -2.2; down(c, 'forward') } },
  { at: 22, do: c => tap(c, 'slide') },
  { at: 23, do: c => tap(c, 'jump') },
  { at: 24, do: c => { tap(c, 'jump'); up(c, 'left') } },
  { at: 27, do: c => { up(c, 'sprint'); down(c, 'back', 'right'); up(c, 'forward') } },
  { at: 31, do: c => { c.yaw = 2.5; tap(c, 'jump') } },
  { at: 32, do: c => down(c, 'slide') },
  { at: 34, do: c => { up(c, 'back', 'right', 'slide'); down(c, 'forward', 'sprint') } },
  { at: 40, do: c => { c.yaw = 0.3; tap(c, 'jump'); tap(c, 'jump') } },
  { at: 44, do: c => up(c, 'forward', 'sprint') },
]
const SIXTHS = 54

// Replays SCRIPT with `framesPerSixth` frames in each 1/6 second and records the position at
// every multiple of 1/6 second.
function replay(framesPerSixth, seconds = () => 1 / (6 * framesPerSixth), c = fresh(ROOM)) {
  c.place({ x: 0, y: 0, z: 8 })
  const path = []
  for (let sixth = 0; sixth <= SIXTHS; sixth++) {
    path.push({ ...c.position })
    SCRIPT.filter(event => event.at === sixth).forEach(event => event.do(c))
    for (let i = 0; i < framesPerSixth; i++) c.advance(seconds())
  }
  return path
}
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const pathLength = path => path.slice(1).reduce((sum, point, i) => sum + distance(point, path[i]), 0)
const largestGap = paths => {
  let gap = 0
  for (const a of paths) for (const b of paths) a.forEach((point, i) => { gap = Math.max(gap, distance(point, b[i])) })
  return gap
}

test('one script replayed at 30, 60, and 144 frames per second gives the same path', () => {
  const paths = [replay(5), replay(10), replay(24)]
  const length = pathLength(paths[1]), gap = largestGap(paths)
  console.log(`replay gap ${gap} m over a ${length.toFixed(2)} m path (ratio ${gap / length})`)
  assert.ok(length > 30, `the script should travel a fair way, travelled ${length}`)
  assert.ok(gap <= 1e-9 * length, `gap ${gap} exceeds 1e-9 of path length ${length}`)
})

test('the replay still agrees when frame times arrive as milliseconds, as the engine passes them', () => {
  const paths = [30, 60, 144].map(rate => replay(rate / 6, () => 1000 / rate / 1000))
  assert.ok(largestGap(paths) <= 1e-9 * pathLength(paths[1]))
})

test('the replay still agrees when each frame time is the difference of a running clock', () => {
  // A clock that has been running for an hour, in milliseconds: its differences are not
  // exact frame times, and without the snap to whole ticks some frames run a tick short.
  const paths = [30, 60, 144].map(rate => {
    let now = 3.6e6 + 0.1
    return replay(rate / 6, () => { const before = now; now += 1000 / rate; return (now - before) / 1000 })
  })
  paths.push(replay(10))
  assert.ok(largestGap(paths) <= 1e-9 * pathLength(paths[1]), `gap ${largestGap(paths)}`)
})

test('place() makes the replay exact whatever ragged frames came before it', () => {
  const used = fresh(ROOM)
  down(used, 'forward')
  for (const seconds of [0.0131, 0.0212, 0.0079, 0.0166, 0.0334]) used.advance(seconds)
  tap(used, 'jump')
  up(used, 'forward')
  assert.deepEqual(replay(10, undefined, used), replay(10))
})

test('the script really does walk, sprint, slide, jump, double jump, and touch a solid', () => {
  const c = fresh(ROOM), seen = new Set()
  c.place({ x: 0, y: 0, z: 8 })
  for (let sixth = 0; sixth <= SIXTHS; sixth++) {
    SCRIPT.filter(event => event.at === sixth).forEach(event => event.do(c))
    for (let i = 0; i < 10; i++) {
      c.advance(FRAME)
      if (c.sprinting) seen.add('sprint')
      if (c.sliding) seen.add('slide')
      if (c.jumpsUsed === 1) seen.add('jump')
      if (c.jumpsUsed === 2) seen.add('double jump')
      assert.equal(c.flip, null)
      if (c.onGround && !c.sliding && speed(c) > 0 && !c.sprinting) seen.add('walk')
      if (clearance(c, ROOM) < T.bodyRadius + 1e-6) seen.add(c.onGround ? 'solid on the ground' : 'solid in the air')
      if (c.position.y > ROOM.height - T.bodyHeight - 0.01) seen.add('ceiling')
      assert.ok(clearance(c, ROOM) > T.bodyRadius - 0.03, 'stays out of the solids')
      assert.ok(c.position.y <= ROOM.height - T.bodyHeight + 1e-9, 'and under the ceiling')
    }
  }
  const moves = ['walk', 'sprint', 'slide', 'jump', 'double jump', 'solid on the ground', 'solid in the air', 'ceiling']
  for (const move of moves) assert.ok(seen.has(move), `never saw ${move}`)
})

test('144 frames of 1/144 second run exactly 720 ticks, the same as one second in any other frames', () => {
  const after = (frames, seconds) => {
    const c = fresh()
    down(c, 'forward', 'right')
    tap(c, 'jump')
    for (let i = 0; i < frames; i++) c.advance(seconds)
    return { position: { ...c.position }, velocity: { ...c.velocity } }
  }
  const whole = after(1, 1)
  assert.deepEqual(after(144, 1 / 144), whole)
  assert.deepEqual(after(60, 1 / 60), whole)
  assert.deepEqual(after(30, 1 / 30), whole)
  assert.deepEqual(after(720, 1 / 720), whole)
  // One tick fewer or more would be visible: the walk covers 6 mm per tick.
  assert.notDeepEqual(after(719, 1 / 720), whole)
})

test('whole-tick frames stay exact for an hour of 144 Hz frames', () => {
  const c = fresh()
  down(c, 'forward')
  for (let i = 0; i < 144 * 3600; i++) c.advance(1 / 144)
  // 5 ticks a frame at a steady walk, bar the 0.15 s of acceleration at the start.
  const expected = T.walkSpeed * 3600 - T.walkSpeed ** 2 / (2 * T.groundAcceleration)
  close(-c.position.z, expected, 0.02)
})

test('between ticks the reported position runs smoothly ahead; on a tick it is the tick state', () => {
  const c = fresh()
  down(c, 'forward')
  run(c, 1)
  const z = c.position.z
  c.advance(0.4 / 720)
  close(c.position.z, z - T.walkSpeed * 0.4 / 720, 1e-12, 'ahead by 0.4 tick')
  c.advance(0.6 / 720)
  close(c.position.z, z - T.walkSpeed / 720, 1e-12, 'one whole tick')

  // Irregular frames end up where regular ones do.
  const regular = fresh(), ragged = fresh()
  down(regular, 'forward', 'sprint')
  down(ragged, 'forward', 'sprint')
  run(regular, 2)
  let left = 2
  for (const seconds of [0.0131, 0.0212, 0.0079, 0.0166, 0.0334]) { ragged.advance(seconds); left -= seconds }
  while (left > 0.02) { ragged.advance(0.0173); left -= 0.0173 }
  ragged.advance(left)
  close(ragged.position.z, regular.position.z, 1e-9)

  // And the report never moves backwards or jumps while the frames are ragged.
  const smooth = fresh()
  down(smooth, 'forward')
  run(smooth, 1)
  let last = smooth.position.z
  for (let i = 0; i < 200; i++) {
    const seconds = 0.003 + 0.02 * ((i * 7919) % 13) / 13
    smooth.advance(seconds)
    close(last - smooth.position.z, T.walkSpeed * seconds, 1e-9, 'distance in one ragged frame')
    last = smooth.position.z
  }
})

test('a frame with no usable duration changes nothing', () => {
  const c = fresh()
  down(c, 'forward')
  c.advance(NaN)
  c.advance(undefined)
  c.advance(0)
  assert.deepEqual(c.position, { x: 0, y: 0, z: 0 })
  run(c, 1)
  assert.ok(c.position.z < -3)
})

// ---------------------------------------------------------------- the surface

test('a new character is at rest with exactly the movement fields of state()', () => {
  const c = fresh()
  assert.deepEqual(c.position, { x: 0, y: 0, z: 0 })
  assert.deepEqual(c.velocity, { x: 0, y: 0, z: 0 })
  assert.equal(c.eyeHeight, T.eyeHeight)
  assert.equal(c.eyeHeight, 1.6)
  assert.equal(c.onGround, true)
  assert.equal(c.sprinting, false)
  assert.equal(c.sliding, false)
  assert.equal(c.jumpsUsed, 0)
  assert.equal(c.flip, null)
  assert.equal(c.yaw, 0)
  const fields = Object.keys(c).filter(name => typeof c[name] !== 'function').sort()
  assert.deepEqual(fields, ['eyeHeight', 'flip', 'jumpsUsed', 'onGround', 'position', 'sliding', 'sprinting', 'velocity', 'yaw'])
  run(c, 1)
  assert.deepEqual(c.position, { x: 0, y: 0, z: 0 })
})

test('place() puts the character at rest, standing, on the ground, jumps and flip reset', () => {
  const c = fresh()
  const position = c.position, velocity = c.velocity
  down(c, 'forward', 'sprint')
  run(c, 0.5)
  tap(c, 'slide')
  run(c, 0.1)
  tap(c, 'jump')
  run(c, 0.1)
  tap(c, 'jump')
  c.advance(0.0123)
  tap(c, 'jump')
  up(c, 'forward', 'sprint')
  c.place({ x: 3, y: 0, z: -4 })
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(c.position, { x: 3, y: 0, z: -4 })
    assert.deepEqual(c.velocity, { x: 0, y: 0, z: 0 })
    assert.equal(c.eyeHeight, T.eyeHeight)
    assert.deepEqual([c.onGround, c.sprinting, c.sliding, c.jumpsUsed, c.flip], [true, false, false, 0, null])
    run(c, 0.5) // the queued jump was dropped, so nothing happens
  }
  assert.equal(c.position, position, 'position stays the same object')
  assert.equal(c.velocity, velocity, 'velocity stays the same object')
})

// ---------------------------------------------------------------- walking

test('W, A, S, D walk relative to yaw and settle at the walk speed', () => {
  const cases = [
    ['forward', 0, 0, -1], ['back', 0, 0, 1], ['left', 0, -1, 0], ['right', 0, 1, 0],
    ['forward', Math.PI / 2, -1, 0], ['right', Math.PI / 2, 0, -1], ['forward', Math.PI, 0, 1],
  ]
  for (const [name, yaw, x, z] of cases) {
    const c = fresh()
    c.yaw = yaw
    down(c, name)
    run(c, 1)
    close(c.velocity.x, x * T.walkSpeed, 1e-9, `${name} at yaw ${yaw}: x`)
    close(c.velocity.z, z * T.walkSpeed, 1e-9, `${name} at yaw ${yaw}: z`)
    assert.equal(c.velocity.y, 0)
    assert.equal(c.sprinting, false)
    const z0 = c.position.z, x0 = c.position.x
    run(c, 1)
    close(Math.hypot(c.position.x - x0, c.position.z - z0), T.walkSpeed, 1e-9, 'metres covered in a second')
  }
})

test('diagonals are no faster, opposite keys cancel, and releasing the keys comes to rest', () => {
  const c = fresh()
  down(c, 'forward', 'right')
  run(c, 1)
  close(speed(c), T.walkSpeed, 1e-9)
  close(c.velocity.x, -c.velocity.z, 1e-9)
  down(c, 'back', 'left')
  run(c, 1)
  assert.equal(speed(c), 0)
  up(c, 'back', 'left', 'right')
  run(c, 1)
  close(speed(c), T.walkSpeed, 1e-9)
  up(c, 'forward')
  c.advance(FRAME)
  assert.ok(speed(c) > 0 && speed(c) < T.walkSpeed, 'slows down, does not stop dead')
  run(c, 1)
  assert.equal(speed(c), 0)
})

test('Shift sprints at the sprint speed, only while moving on the ground', () => {
  const c = fresh()
  down(c, 'sprint')
  run(c, 0.5)
  assert.equal(c.sprinting, false, 'standing still is not sprinting')
  down(c, 'forward')
  run(c, 1)
  close(speed(c), T.sprintSpeed, 1e-9)
  assert.equal(c.sprinting, true)
  assert.ok(T.sprintSpeed > T.walkSpeed)
  tap(c, 'jump')
  c.advance(FRAME)
  assert.equal(c.sprinting, false, 'not sprinting in the air')
  close(speed(c), T.sprintSpeed, 1e-9, 'the jump keeps the sprint speed')
  run(c, 1)
  assert.equal(c.sprinting, true)
  up(c, 'sprint')
  run(c, 1)
  assert.equal(c.sprinting, false)
  close(speed(c), T.walkSpeed, 1e-9)
})

// ---------------------------------------------------------------- jumping

// Advances frame by frame until landing; returns the highest point and the time in the air.
function flight(c) {
  let apex = 0, seconds = 0
  do { c.advance(1 / 720); seconds += 1 / 720; apex = Math.max(apex, c.position.y) } while (!c.onGround && seconds < 10)
  return { apex, seconds }
}

test('a jump rises to the tuning height', () => {
  const c = fresh()
  tap(c, 'jump')
  c.advance(FRAME)
  assert.equal(c.onGround, false)
  assert.equal(c.jumpsUsed, 1)
  assert.ok(c.velocity.y > 0)
  const { apex, seconds } = flight(c)
  close(apex, T.jumpHeight, 1e-4, 'apex')
  close(seconds + FRAME, 2 * Math.sqrt(2 * T.jumpHeight / T.gravity), 2 / 720, 'time in the air')
  assert.equal(c.position.y, 0)
  assert.equal(c.velocity.y, 0)
})

test('the apex is the same at 30, 60, and 144 frames per second', () => {
  for (const rate of [30, 60, 144]) {
    const c = fresh()
    tap(c, 'jump')
    let apex = 0
    for (let i = 0; i < rate; i++) { c.advance(1 / rate); apex = Math.max(apex, c.position.y) }
    // Sampled only on frames, so the highest sample sits a little under the true apex.
    assert.ok(apex <= T.jumpHeight + 1e-9 && apex > T.jumpHeight - T.gravity / (8 * rate * rate) - 1e-6, `${rate}: ${apex}`)
  }
})

test('no more than two jumps before landing, and jumpsUsed resets on landing', () => {
  const c = fresh()
  assert.equal(c.jumpsUsed, 0)
  tap(c, 'jump')
  run(c, 0.2)
  assert.equal(c.jumpsUsed, 1)
  tap(c, 'jump')
  c.advance(FRAME)
  assert.equal(c.jumpsUsed, 2)
  const rising = c.velocity.y
  assert.ok(rising > 0)
  for (let i = 0; i < 3; i++) {
    tap(c, 'jump')
    c.advance(FRAME)
    assert.equal(c.jumpsUsed, 2)
    assert.ok(c.velocity.y < rising, 'a third press gives no lift')
  }
  const { apex } = flight(c)
  assert.ok(apex > T.jumpHeight && apex < 2 * T.jumpHeight + 1e-6, `double jump apex ${apex}`)
  assert.equal(c.onGround, true)
  assert.equal(c.jumpsUsed, 0)
  run(c, 0.5)
  assert.equal(c.onGround, true, 'presses dropped in the air do not fire on landing')
  tap(c, 'jump')
  c.advance(FRAME)
  assert.equal(c.jumpsUsed, 1, 'and the jumps are available again')
})

test('a double jump at the apex reaches twice the jump height', () => {
  const c = fresh()
  tap(c, 'jump')
  c.advance(Math.sqrt(2 * T.jumpHeight / T.gravity))
  tap(c, 'jump')
  close(flight(c).apex, 2 * T.jumpHeight, 1e-3)
})

test('a tap of jump between two long frames still jumps, and two taps double jump', () => {
  const c = fresh()
  c.advance(0.25)
  tap(c, 'jump')
  c.advance(0.25)
  assert.equal(c.onGround, false)
  assert.equal(c.jumpsUsed, 1)
  assert.ok(c.position.y > 0.5)

  const twice = fresh()
  tap(twice, 'jump')
  tap(twice, 'jump')
  twice.advance(0.25)
  assert.equal(twice.jumpsUsed, 2)
  assert.equal(twice.flip, null)
})

test('holding jump, or key auto-repeat, is one press', () => {
  const c = fresh()
  for (let i = 0; i < 30; i++) { c.key('jump', true); c.advance(FRAME) }
  assert.equal(c.jumpsUsed, 1)
  c.key('jump', false)
  flight(c)
  run(c, 0.3)
  assert.equal(c.onGround, true)
})

test('the head stops at the ceiling', () => {
  const c = fresh({ solids: [], height: T.bodyHeight + 0.5 })
  tap(c, 'jump')
  const { apex, seconds } = flight(c)
  close(apex, 0.5, 1e-9)
  assert.ok(seconds < 2 * Math.sqrt(2 * T.jumpHeight / T.gravity), 'and the fall starts from there')
})

test('advance returns both accepted impulses in order within a single frame', () => {
  for (const key of [null, 'forward', 'back', 'left', 'right']) {
    const c = fresh()
    if (key) down(c, key)
    c.advance(1)
    tap(c, 'jump'); tap(c, 'jump'); tap(c, 'jump')
    const result = c.advance(0.15)
    assert.deepEqual(result, { events: [{ type: 'jump', number: 1 }, { type: 'jump', number: 2 }], sprintMetres: 0 })
    assert.equal(c.flip, null)
    assert.deepEqual(c.advance(1).events, [])
    assert.equal(c.onGround, true)
  }
})

// ---------------------------------------------------------------- sliding

test('a slide gives a burst above walk speed that decays, with the view dropped low', () => {
  const c = fresh()
  down(c, 'forward')
  run(c, 1)
  down(c, 'slide')
  c.advance(FRAME)
  assert.equal(c.sliding, true)
  close(speed(c), T.walkSpeed + T.slideBurst - T.slideFriction * FRAME, 1e-9, 'burst')
  assert.ok(speed(c) > T.walkSpeed)
  assert.ok(c.velocity.z < 0 && Math.abs(c.velocity.x) < 1e-9, 'the burst is along the motion')
  assert.ok(c.eyeHeight < T.eyeHeight && c.eyeHeight > T.slideEyeHeight, 'the view drops smoothly, not at once')

  let last = speed(c), lastEye = c.eyeHeight, slideSeconds = FRAME, lowest = c.eyeHeight
  const start = c.position.z + T.walkSpeed * FRAME
  while (c.sliding && slideSeconds < 10) {
    c.advance(FRAME)
    slideSeconds += FRAME
    if (!c.sliding) break
    assert.ok(speed(c) < last, 'the slide decays')
    assert.ok(c.eyeHeight <= lastEye)
    last = speed(c)
    lastEye = lowest = c.eyeHeight
  }
  assert.equal(lowest, T.slideEyeHeight)
  const expected = (T.walkSpeed + T.slideBurst - T.slideEndSpeed) / T.slideFriction
  close(slideSeconds, expected, 2 * FRAME, 'slide time')
  close(start - c.position.z, (T.walkSpeed + T.slideBurst + T.slideEndSpeed) / 2 * expected, 0.3, 'slide distance')
  assert.ok(speed(c) > 0, 'the end of the slide does not zero the speed')
  run(c, 1)
  assert.equal(c.sliding, false, 'holding the key does not start a second slide')
  assert.equal(c.eyeHeight, T.slideEyeHeight)
  up(c, 'slide'); run(c, 0.5)
  close(speed(c), T.walkSpeed, 1e-9, 'back to walking')
})

test('a slide from a sprint starts at the top speed, and a tap is enough', () => {
  const c = fresh()
  down(c, 'forward', 'sprint')
  run(c, 1)
  tap(c, 'slide')
  c.advance(0.1)
  assert.equal(c.sliding, true)
  assert.equal(c.sprinting, false)
  close(speed(c), Math.min(T.sprintSpeed + T.slideBurst, T.slideTopSpeed) - T.slideFriction * 0.1, 1e-9)
  run(c, 0.5)
  assert.equal(c.sliding, true, 'the slide runs on after the key is released')
})

test('at rest or with low incoming Shift speed, C crouches until released', () => {
  for (const low of [false, true]) {
    const c = fresh()
    if (low) { down(c, 'sprint', 'forward'); c.advance(0.04) }
    down(c, 'slide'); const result = c.advance(0.08)
    assert.deepEqual(result, { events: [], sprintMetres: 0 })
    assert.ok(c.eyeHeight < T.eyeHeight && c.eyeHeight > T.slideEyeHeight)
    for (let i = 0; i < 30; i++) { down(c, 'slide'); assert.deepEqual(c.advance(FRAME).events, []) }
    assert.equal(c.eyeHeight, T.slideEyeHeight); assert.equal(c.sliding, false); assert.equal(c.sprinting, false)
    assert.equal(speed(c), low ? T.crouchSpeed : 0)
    up(c, 'slide'); run(c, 0.3); assert.equal(c.eyeHeight, T.eyeHeight)
  }
})

test('quick coasting C taps choose by speed and releaseKeys discards pending impulses', () => {
  const c = fresh()
  down(c, 'forward', 'sprint'); c.advance(1); up(c, 'forward', 'sprint'); c.advance(30 / 720)
  assert.ok(speed(c) > T.slideStartSpeed)
  down(c, 'slide'); down(c, 'slide'); up(c, 'slide'); c.advance(0.2 / 720)
  assert.deepEqual(c.advance(FRAME).events, [{ type: 'slide' }]); assert.equal(c.sliding, true)
  tap(c, 'slide'); assert.deepEqual(c.advance(2).events, [])
  down(c, 'forward', 'sprint'); c.advance(1); tap(c, 'slide'); tap(c, 'jump'); c.releaseKeys()
  assert.deepEqual(c.advance(1), { events: [], sprintMetres: 0 })
})

test('a jump out of a slide keeps its speed', () => {
  const c = fresh()
  down(c, 'forward', 'sprint')
  run(c, 1)
  down(c, 'slide')
  run(c, 0.2)
  const sliding = speed(c)
  assert.ok(sliding > T.sprintSpeed)
  tap(c, 'jump')
  c.advance(FRAME)
  assert.equal(c.sliding, false)
  assert.equal(c.onGround, false)
  close(speed(c), sliding, 1e-9, 'speed just after the jump')
  run(c, 0.3)
  close(speed(c), sliding, 1e-9, 'speed held through the air')
  assert.ok(c.eyeHeight > T.slideEyeHeight, 'the view rises again')
  up(c, 'forward', 'sprint')
  run(c, 0.2)
  close(speed(c), sliding, 1e-9, 'and with the keys released')
})

test('a C press in the air cannot start a slide on landing', () => {
  const c = fresh()
  down(c, 'forward'); c.advance(1); tap(c, 'jump'); c.advance(0.2); tap(c, 'slide')
  assert.deepEqual(c.advance(1).events, []); assert.equal(c.sliding, false); assert.equal(c.onGround, true)
})

test('momentum carries through sprint, slide, jump, double jump, and landing', () => {
  const c = fresh()
  down(c, 'forward', 'sprint')
  run(c, 1)
  let slowest = Infinity
  const watch = () => { slowest = Math.min(slowest, speed(c)) }
  tap(c, 'slide')
  run(c, 0.3, watch)
  tap(c, 'jump')
  run(c, 0.3, watch)
  tap(c, 'jump')
  run(c, 1.5, watch)
  assert.equal(c.onGround, true)
  assert.ok(slowest >= T.sprintSpeed - 1e-9, `speed fell to ${slowest}`)
})

// ---------------------------------------------------------------- air steering

test('the keys steer in mid-air without adding or shedding speed', () => {
  const c = fresh()
  down(c, 'forward')
  run(c, 1)
  tap(c, 'jump')
  c.advance(FRAME)
  up(c, 'forward')
  down(c, 'right')
  const before = { ...c.velocity }
  run(c, 0.25)
  assert.equal(c.onGround, false)
  assert.ok(c.velocity.x > 1, `should have turned right, vx ${c.velocity.x}`)
  assert.ok(c.velocity.z > before.z + 1, 'and lost forward speed')
  assert.ok(speed(c) <= T.walkSpeed + 1e-9)

  // From a standing jump the keys build speed in the air, more gently than on the ground.
  const still = fresh()
  tap(still, 'jump')
  still.advance(FRAME)
  down(still, 'forward')
  still.advance(0.1)
  close(-still.velocity.z, T.airAcceleration * 0.1, 1e-9)
  assert.ok(T.airAcceleration < T.groundAcceleration)
})

// ---------------------------------------------------------------- solids

const WALL = { solids: [{ minX: -50, maxX: 50, minZ: -5.5, maxZ: -5 }], height: 4 }

test('a solid stops the character from passing through', () => {
  const c = fresh(WALL)
  down(c, 'forward', 'sprint')
  run(c, 3)
  close(c.position.z, -5 + T.bodyRadius, 1e-6)
  assert.ok(Math.abs(c.velocity.z) < T.groundAcceleration / 720 + 1e-9, 'no speed into the wall')
  tap(c, 'slide')
  tap(c, 'jump')
  run(c, 1)
  assert.ok(c.position.z >= -5 + T.bodyRadius - 1e-6, 'nor by sliding or jumping at it')
})

test('the character slides along a solid instead of stopping dead', () => {
  const c = fresh(WALL)
  c.yaw = -Math.PI / 4 // facing forward and to the right, into the wall at 45 degrees
  down(c, 'forward')
  run(c, 3)
  const x = c.position.x
  run(c, 1)
  close(c.position.z, -5 + T.bodyRadius, 1e-6)
  close(c.position.x - x, T.walkSpeed * Math.SQRT1_2, 1e-6, 'metres along the wall in a second')
})

test('the character rounds the corner of a solid', () => {
  // The pillar's corner overlaps the character's path by 0.2 m.
  const pillar = { solids: [{ minX: -1, maxX: -0.1, minZ: -3, maxZ: -2 }], height: 4 }
  const c = fresh(pillar)
  down(c, 'forward')
  let nearest = Infinity
  run(c, 2, () => { nearest = Math.min(nearest, clearance(c, pillar)) })
  assert.ok(nearest >= T.bodyRadius - 0.02, `came within ${nearest} of the pillar`)
  assert.ok(c.position.z < -3.5, 'and got past it')
  assert.ok(c.position.x > -0.1 + T.bodyRadius - 0.02 && c.position.x < 0.5, 'by going round the corner')
})

// ---------------------------------------------------------------- the tuning table

test('the tuning table carries the entries the engine and the floor plan rely on', () => {
  assert.equal(T.eyeHeight, 1.6)
  assert.ok(T.pageFov < T.museumFov && T.museumFov + T.sprintFovExtra < 180)
  assert.ok(T.sprintFovExtra > 0)
  assert.ok(T.fovWidenTime > 0)
  for (const [name, value] of Object.entries(T)) assert.ok(Number.isFinite(value) && value > 0, name)
  assert.ok(T.crouchSpeed < T.slideStartSpeed && T.slideStartSpeed <= T.walkSpeed)
})


test('sprint metres follow actual grounded displacement along a wall and stop at a blocker', () => {
  for (const rate of [30, 60, 144]) {
    const c = fresh(WALL); c.yaw = -Math.PI / 4; down(c, 'forward', 'sprint')
    let sum = 0
    for (let i = 0; i < 3 * rate; i++) sum += c.advance(1 / rate).sprintMetres
    const edge = 5 - T.bodyRadius
    close(sum, edge * Math.SQRT2 + c.position.x - edge, 0.001, 'contact and tangential travel')
    c.place({ x: c.position.x, y: 0, z: -edge }); c.yaw = 0
    assert.deepEqual(c.advance(1), { events: [], sprintMetres: 0 }); assert.equal(c.sprinting, false)
    c.place({ x: 0, y: 0, z: 20 }); assert.equal(c.advance(0).sprintMetres, 0)
    tap(c, 'jump'); assert.equal(c.advance(0.5).sprintMetres, 0)
    c.advance(1); tap(c, 'slide'); assert.deepEqual(c.advance(0.1), { events: [{ type: 'slide' }], sprintMetres: 0 })
  }
})


test('one large advance delivers a slide and two jumps in physical order, with the same sprint metres as split frames', () => {
  function replay(rate) {
    const c = fresh(); down(c, 'forward', 'sprint'); c.advance(0.5)
    tap(c, 'slide'); tap(c, 'jump'); tap(c, 'jump')
    const events = []; let metres = 0
    for (let i = 0; i < rate; i++) {
      const result = c.advance(1 / rate); events.push(...result.events); metres += result.sprintMetres
    }
    return { events, metres, position: c.position }
  }
  const whole = replay(1)
  assert.deepEqual(whole.events, [{ type: 'slide' }, { type: 'jump', number: 1 }, { type: 'jump', number: 2 }])
  assert.ok(whole.metres > 2 && whole.metres < 4)
  for (const rate of [30, 60, 144]) {
    const split = replay(rate)
    assert.deepEqual(split.events, whole.events); assert.deepEqual(split.position, whole.position)
    close(split.metres, whole.metres, 1e-12, 'eligible distance')
  }
})
