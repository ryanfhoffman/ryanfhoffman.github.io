import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import * as world from '../museum/world.js'
import { collisionVolumes, createCharacter } from '../museum/movement.js'
import * as T from '../museum/tuning.js'

const { rooms, volumes, doors, doorHeight, wallPages } = world
const near = (a, b, label, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${label}: ${a} vs ${b}`)
const covers = (b, x, z) => b.minX <= x && x <= b.maxX && b.minZ <= z && z <= b.maxZ
const footprint = b => (b.maxX - b.minX) * (b.maxZ - b.minZ)
const stairs = volumes.filter(b => b.stair), deck = volumes.find(b => b.minY > 0 && b.maxY === stairs.at(-1).maxY)
const area = boxes => boxes.reduce((sum, b) => sum + footprint(b), 0)
const at = (x, y, z) => ({ x, y, z })
const tap = (c, key) => { c.key(key, true); c.key(key, false) }

// Measure the finished walking surfaces. Exclude portal thresholds and the
// footprint of the stair from the lower gallery. Count the upper floor once.
test('all four rooms gained usable area and clear height; five larger portals connect them', () => {
  assert.equal(rooms[0].id, 'lobby'); assert.equal(new Set(rooms.map(r => r.id)).size, rooms.length)
  assert.equal(wallPages.length, 1); assert.equal(wallPages[0].selector, 'main')
  for (const b of volumes) assert.ok(b.maxX > b.minX && b.maxY > b.minY && b.maxZ > b.minZ)
  const floors = volumes.filter(b => b.maxY === 0 && !doors.some(d =>
    d.minX === b.minX && d.maxX === b.maxX && d.minZ === b.minZ && d.maxZ === b.maxZ))
  const old = { lobby: 6.2 * 8.2 + 12 * 8.8, long: 30 * 6, broad: 10 * 12, west: 8 * 18, upper: 0 }
  assert.equal(rooms.length, 5)
  for (const { id, stand: s } of rooms) {
    const c = createCharacter(world); c.place(s); c.advance(1)
    assert.deepEqual(c.position, s); assert.ok(c.onGround, id)
    const cross = volumes.filter(b => covers(b, s.x, s.z))
    assert.ok(cross.some(b => b.maxY === s.y), `${id} stands on a surface`)
    const clear = Math.min(...cross.filter(b => b.minY > s.y).map(b => b.minY)) - s.y
    assert.ok(clear > 4.2 && clear > T.bodyHeight + 2 * T.jumpHeight)
    let usable = area(floors.filter(b => covers(b, s.x, s.z)))
    if (id === 'lobby') usable = area(floors.filter(b => b.maxX <= 9 && b.minX >= -9 && b.maxZ <= 23))
    if (id === 'broad') usable -= area(stairs)
    if (id === 'upper') usable = footprint(deck)
    assert.ok(usable > old[id], id)
    console.log(`${id}: ${old[id].toFixed(2)} → ${usable.toFixed(2)} m² level floor, ${clear.toFixed(1)} m clear at stand`)
  }
  for (const d of doors) {
    near(Math.max(d.maxX - d.minX, d.maxZ - d.minZ), 4, 'opening width')
    const x = (d.minX + d.maxX) / 2, z = (d.minZ + d.maxZ) / 2
    near(Math.min(...volumes.filter(b => covers(b, x, z) && b.minY > 0).map(b => b.minY)), doorHeight, 'opening height')
  }
  assert.equal(doorHeight, 4.4)
})

test('held W reveals the recessed end wall at 4:3 while the entry bay and lobby clear a double jump', () => {
  const page = wallPages[0], distance = page.height / (2 * Math.tan(T.pageFov * Math.PI / 360))
  const c = createCharacter(world); c.place(at(0, 0, distance)); c.key('forward', true); c.advance(0.5)
  assert.ok(c.onGround && c.position.z < distance - 1.8)
  const half = c.position.z * Math.tan(T.museumFov * Math.PI / 360)
  assert.ok(half * 4 / 3 > 2.85 && half > 3.25 - T.eyeHeight && half > T.eyeHeight)
  const support = volumes.find(b => b.maxZ === 0 && b.minY === 0 && b.minX <= -page.height * 16 / 18 && b.maxX >= page.height * 16 / 18)
  assert.ok(support && support.maxY >= T.eyeHeight + page.height / 2)
  for (const z of [1.2, c.position.z, distance, rooms[0].stand.z]) {
    for (const dx of [-T.bodyRadius, 0, T.bodyRadius]) {
      const over = Math.min(...volumes.filter(b => b.minY > 0 && covers(b, dx, z)).map(b => b.minY))
      assert.ok(over >= T.bodyHeight + 2 * T.jumpHeight)
    }
  }
})

test('the cylinder follows every tread in both directions without leaving the ground', () => {
  const c = createCharacter(world); c.place(at(0, 0, 24)); c.key('back', true)
  function walk(seconds) {
    const visited = new Set()
    for (let i = 0; i < seconds * 720; i++) {
      c.advance(1 / 720); visited.add(c.position.y)
      assert.ok(c.onGround); assert.equal(c.jumpsUsed, 0)
    }
    return [...visited]
  }
  const heights = [0, ...stairs.map(b => b.maxY)]
  assert.deepEqual(walk(4), heights); assert.ok(c.position.z > deck.minZ + 2)
  c.key('back', false); c.key('forward', true)
  assert.deepEqual(walk(4.6), heights.reverse()); assert.ok(c.position.z < stairs[0].minZ)
})

test('real stair sides and gallery walls block the body on both levels', () => {
  const c = createCharacter(world)
  for (const [from, key, wallX] of [
    [at(-5, 0, 35), 'right', -2.2 - T.bodyRadius], [at(5, 0, 35), 'left', 2.2 + T.bodyRadius],
    [at(5, 0, 42), 'right', 9 - T.bodyRadius], [at(5, deck.maxY, 42), 'right', 9 - T.bodyRadius],
  ]) {
    c.releaseKeys(); c.place(from); c.key(key, true); c.advance(2)
    near(c.position.x, wallX, 'contact'); near(c.position.y, from.y, 'stays on same level'); assert.ok(c.onGround)
  }
})

test('overhead surfaces arrest ascent, underside approach blocks laterally, exposed landing drops by gravity', () => {
  const c = createCharacter(world)
  for (const [from, underside] of [[at(5, 2, 42), deck.minY], [at(9.15, 2, 15.5), doorHeight]]) {
    c.place(from); assert.equal(c.onGround, false); tap(c, 'jump'); c.advance(0.18)
    assert.ok(c.position.y > from.y && c.position.y <= underside - T.bodyHeight + 1e-9)
    tap(c, 'jump'); let peak = 0
    for (let i = 0; i < 1000; i++) { c.advance(1 / 720); peak = Math.max(peak, c.position.y) }
    near(peak, underside - T.bodyHeight, 'local head stop', 2e-5); assert.ok(c.onGround); assert.equal(c.position.y, 0)
  }
  // An airborne body whose head overlaps the deck edge cannot enter the slab.
  c.place(at(5, deck.minY - 1.1, deck.minZ - 0.36)); c.key('back', true); tap(c, 'jump'); c.advance(0.3)
  near(c.position.z, deck.minZ - T.bodyRadius, 'slab front'); assert.ok(c.position.y < deck.maxY)
  c.releaseKeys(); c.place(at(5, deck.maxY, deck.minZ + 1)); c.key('forward', true)
  let airborne = 0, firstDrop, prior = deck.maxY
  for (let i = 0; i < 1000; i++) {
    c.advance(1 / 720)
    if (!c.onGround) { airborne++; firstDrop ??= prior - c.position.y; assert.ok(c.position.y < prior) }
    prior = c.position.y
  }
  assert.ok(airborne > 400 && firstDrop < 0.001); assert.ok(c.onGround); assert.equal(c.position.y, 0)
  c.releaseKeys(); c.place(at(5, deck.maxY + 0.7, 42)); tap(c, 'jump'); c.advance(1.5)
  assert.equal(c.position.y, deck.maxY); assert.ok(c.onGround); assert.equal(c.jumpsUsed, 0)
})

test('mesh intersections match tread tops, risers, sides, landing, soffits, walls and sight blockers',
  { skip: !process.env.THREE_MODULE }, async () => {
    const THREE = await import(pathToFileURL(process.env.THREE_MODULE).href)
    const group = world.build(THREE); group.updateMatrixWorld()
    assert.equal(group.children.length, 2)
    const mesh = group.getObjectByName('plaster')
    const boxes = collisionVolumes(world).map(b => new THREE.Box3(new THREE.Vector3(b.minX, b.minY, b.minZ),
      new THREE.Vector3(b.maxX, b.maxY, b.maxZ)))
    function probe(origin, direction, distance, label) {
      const ray = new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...direction))
      const hit = ray.intersectObject(mesh)[0]
      assert.ok(hit, label)
      if (distance !== undefined) near(hit.distance, distance, `mesh ${label}`, 1e-5)
      const hits = boxes.map(b => ray.ray.intersectBox(b, new THREE.Vector3())).filter(Boolean)
      near(Math.min(...hits.map(p => p.distanceTo(ray.ray.origin))), hit.distance, `ray blocker ${label}`, 1e-5)
      return hit.distance
    }
    for (const { id, stand: s } of rooms) {
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4, direction = [Math.sin(angle), 0, -Math.cos(angle)]
        const origin = [s.x, s.y + T.eyeHeight, s.z]
        assert.ok(probe(origin, direction, undefined, `${id} at ${i * 45}°`) > T.bodyRadius)
      }
    }
    for (const b of stairs) {
      const z = (b.minZ + b.maxZ) / 2
      probe([0, 8, z], [0, -1, 0], 8 - b.maxY, 'tread')
      probe([0, b.maxY - 0.1, b.minZ - 0.15], [0, 0, 1], 0.15, 'riser')
      for (const sign of [-1, 1]) probe([sign * 3.2, b.maxY - 0.1, z], [-sign, 0, 0], 1, 'stair side')
    }
    for (const z of [deck.minZ + 0.01, deck.maxZ - 0.01]) {
      probe([5, 2, z], [0, 1, 0], deck.minY - 2, 'underside'); probe([5, 8, z], [0, -1, 0], 8 - deck.maxY, 'landing')
      for (const eye of [1.6, deck.maxY + 1.6]) probe([5, eye, z], [1, 0, 0], 4, 'atrium wall')
    }
    probe([0, 1.6, deck.minZ + 1], [0, 0, -1], 1, 'back of stair under landing')
    probe([5, 5, deck.minZ - 1], [0, 0, 1], 1, 'deck face')
    probe([9.15, 1.6, 15.5], [0, 1, 0], doorHeight - 1.6, 'portal soffit')
    probe([9, 1.6, 15.5], [1, 0, 0], 45.3 - 9, 'open portal into long gallery')
  })
