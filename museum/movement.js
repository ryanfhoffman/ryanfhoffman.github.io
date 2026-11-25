// Fixed-tick, feet-first cylinder controller. All dimensions are in metres.
import * as T from './tuning.js'

const RATE = 720
const TICK = 1 / RATE
const EPS = 1e-9 // geometric tolerance at touching faces
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// A stacked world supplies every solid, including the ground and the roof. The
// original single-level fixture describes infinite planes and full-height walls.
export function collisionVolumes(world) {
  if (world.volumes) return world.volumes
  const plane = { minX: -Infinity, maxX: Infinity, minZ: -Infinity, maxZ: Infinity }
  return [{ ...plane, minY: -Infinity, maxY: 0 }, { ...plane, minY: world.height, maxY: Infinity },
    ...world.solids.map(b => ({ minY: 0, maxY: world.height, ...b })),
    ...(world.doors || []).map(b => ({ minY: world.doorHeight, maxY: world.height, ...b }))]
}

function overlaps(p, b) {
  const dx = Math.max(b.minX - p.x, 0, p.x - b.maxX), dz = Math.max(b.minZ - p.z, 0, p.z - b.maxZ)
  return dx * dx + dz * dz < T.bodyRadius ** 2 - EPS
}

export function createCharacter(world) {
  const boxes = collisionVolumes(world)
  const p = { x: 0, y: 0, z: 0 }, v = { x: 0, y: 0, z: 0 }
  const held = new Set(), presses = []
  let clock = 0, ticks = 0

  function supportAt(feet, limit) {
    let support = null
    for (const b of boxes) {
      if (b.maxY <= limit + EPS && (!support || b.maxY > support.maxY) && overlaps(feet, b)) support = b
    }
    return support
  }
  function overhead(feet) {
    let y = Infinity
    for (const b of boxes) {
      if (b.minY >= feet.y + T.bodyHeight - EPS && b.minY < y && overlaps(feet, b)) y = b.minY
    }
    return y
  }
  function stopAtSides(feet, velocity) {
    for (const b of boxes) {
      if (b.maxY <= feet.y + EPS || b.minY >= feet.y + T.bodyHeight - EPS || !overlaps(feet, b)) continue
      const dx = feet.x - clamp(feet.x, b.minX, b.maxX), dz = feet.z - clamp(feet.z, b.minZ, b.maxZ)
      const d = Math.hypot(dx, dz)
      // Each tick travels less than a radius; ordinary motion contacts a face
      // from outside. A harness position inside a box exits by its nearest face.
      let nx, nz, penetration
      if (d > 0) {
        nx = dx / d; nz = dz / d; penetration = T.bodyRadius - d
      } else {
        const sides = [feet.x - b.minX, b.maxX - feet.x, feet.z - b.minZ, b.maxZ - feet.z]
        const nearest = sides.indexOf(Math.min(...sides))
        nx = [-1, 1, 0, 0][nearest]; nz = [0, 0, -1, 1][nearest]
        penetration = T.bodyRadius + sides[nearest]
      }
      feet.x += nx * penetration; feet.z += nz * penetration
      const into = Math.min(0, velocity.x * nx + velocity.z * nz)
      velocity.x -= nx * into; velocity.z -= nz * into
    }
  }

  function move(feet, velocity, grounded, dt) {
    const before = feet.y
    const oldSupport = grounded && supportAt(feet, before)
    feet.x += velocity.x * dt; feet.z += velocity.z * dt
    if (grounded) {
      const next = supportAt(feet, before + T.stepHeight)
      if (next?.stair && next.maxY > before && next.maxY + T.bodyHeight <= overhead(feet)) feet.y = next.maxY
    }
    stopAtSides(feet, velocity)
    const support = supportAt(feet, feet.y), floor = support?.maxY ?? -Infinity
    // Follow the next tread on descent. An exposed landing or balcony edge is
    // a drop: integrate gravity until the feet cross a solid top from above.
    if (grounded && (floor === feet.y || ((oldSupport?.stair || support?.stair) && before - floor <= T.stepHeight + EPS))) {
      feet.y = floor
      return true
    }
    const top = velocity.y > 0 ? overhead(feet) - T.bodyHeight : Infinity
    const y = feet.y + velocity.y * dt - T.gravity * dt * dt / 2
    velocity.y -= T.gravity * dt
    if (y <= floor) { feet.y = floor; velocity.y = 0; return true }
    feet.y = Math.min(y, top)
    if (y >= top) velocity.y = Math.min(0, velocity.y)
    return false
  }

  function tick(result) {
    const sin = Math.sin(c.yaw), cos = Math.cos(c.yaw)
    const f = held.has('forward') - held.has('back'), s = held.has('right') - held.has('left')
    const n = Math.hypot(f, s) || 1, wx = (s * cos - f * sin) / n, wz = (-f * cos - s * sin) / n
    let h = Math.hypot(v.x, v.z)
    const press = presses.shift()
    if (press === 'jump' && c.jumpsUsed < T.jumpLimit) {
      result.events.push({ type: 'jump', number: ++c.jumpsUsed })
      v.y = Math.sqrt(2 * T.gravity * T.jumpHeight)
      c.onGround = c.sliding = false
    }
    if (press === 'slide' && c.onGround && !c.sliding && h >= T.slideStartSpeed) {
      const burst = Math.min(h + T.slideBurst, Math.max(h, T.slideTopSpeed))
      v.x *= burst / h; v.z *= burst / h; h = burst
      c.sliding = true
      result.events.push({ type: 'slide' })
    }
    if (h < T.slideEndSpeed) c.sliding = false
    const crouched = c.onGround && held.has('slide') && !c.sliding
    const sprint = c.onGround && !crouched && !c.sliding && held.has('sprint') && !!(f || s)
    const speed = crouched ? T.crouchSpeed : held.has('sprint') ? T.sprintSpeed : T.walkSpeed
    const goal = c.sliding ? 0 : c.onGround ? speed : Math.max(h, speed)
    const air = f || s ? T.airAcceleration : 0
    const rate = c.sliding ? T.slideFriction : c.onGround ? T.groundAcceleration : air
    const dx = wx * goal - v.x, dz = wz * goal - v.z
    const k = Math.min(1, rate * TICK / (Math.hypot(dx, dz) || 1))
    v.x += dx * k; v.z += dz * k
    const x = p.x, z = p.z
    c.onGround = move(p, v, c.onGround, TICK)
    if (c.onGround) c.jumpsUsed = 0
    else c.sliding = false
    const metres = Math.hypot(p.x - x, p.z - z)
    c.sprinting = sprint && c.onGround && metres > EPS
    if (c.sprinting) result.sprintMetres += metres
    const eye = c.onGround && (c.sliding || crouched) ? T.slideEyeHeight : T.eyeHeight
    c.eyeHeight += clamp(eye - c.eyeHeight, -T.eyeSpeed * TICK, T.eyeSpeed * TICK)
  }

  const c = {
    position: {}, velocity: v, yaw: 0, flip: null,
    key(name, down) {
      if (!down) { held.delete(name); return }
      if (held.has(name)) return
      held.add(name)
      if (name === 'jump' && c.jumpsUsed + presses.filter(p => p === 'jump').length < T.jumpLimit) presses.push(name)
      if (name === 'slide' && c.onGround && !c.sliding && !presses.includes(name) &&
          Math.hypot(v.x, v.z) >= T.slideStartSpeed) presses.push(name)
    },
    releaseKeys() { held.clear(); presses.length = 0 },
    // Ordered accepted impulses and post-collision horizontal sprint distance for this frame.
    advance(seconds) {
      const result = { events: [], sprintMetres: 0 }
      if (Number.isFinite(seconds) && seconds > 0) clock += seconds * RATE
      if (Math.abs(clock - Math.round(clock)) < 1e-6) clock = Math.round(clock)
      for (; ticks < Math.floor(clock); ticks++) tick(result)
      Object.assign(c.position, p)
      if (clock > ticks) move(c.position, { ...v }, c.onGround, (clock - ticks) * TICK)
      return result
    },
    place({ x, y = 0, z }) {
      Object.assign(p, { x, y, z }); Object.assign(c.position, p)
      Object.assign(v, { x: 0, y: 0, z: 0 })
      c.eyeHeight = T.eyeHeight; c.onGround = supportAt(p, y)?.maxY === y
      c.sprinting = c.sliding = false; c.jumpsUsed = 0
      clock = ticks = presses.length = 0
    },
  }
  c.place(p)
  return c
}
