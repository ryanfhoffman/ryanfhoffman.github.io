import test from 'node:test'
import assert from 'node:assert/strict'
import { createCharacter } from '../museum/movement.js'
import * as T from '../museum/tuning.js'

const openFloor = { solids: [], height: 10 }

function tap(character, key) {
  character.key(key, true)
  character.key(key, false)
}

test('walking, jumping and steering follow the same path at 30, 60 and 144 Hz', () => {
  function replay(rate) {
    const character = createCharacter(openFloor)
    character.yaw = Math.PI / 2
    character.key('forward', true)
    const path = []
    // Browser frame times are differences between timestamps on a running clock.
    let now = 3_600_000
    for (let frame = 0; frame < rate; frame++) {
      if (frame === rate / 2) {
        tap(character, 'jump')
        character.key('right', true)
      }
      const previous = now
      now += 1000 / rate
      character.advance((now - previous) / 1000)
      if ((frame + 1) % (rate / 6) === 0) path.push({ ...character.position })
    }
    return path
  }

  const path = replay(60)
  assert.ok(path[2].x < -1 && Math.abs(path[2].z) < 1e-9, 'walk follows the camera')
  assert.ok(path[3].y > 0 && path[3].z < -0.01, 'jump turns in the air')
  assert.deepEqual(replay(30), path)
  assert.deepEqual(replay(144), path)
})

test('holding C at rest crouches, and releasing it restores walking', () => {
  const character = createCharacter(openFloor)
  character.key('slide', true)
  assert.deepEqual(character.advance(0.3).events, [])
  assert.equal(character.eyeHeight, T.slideEyeHeight)
  assert.deepEqual(character.position, { x: 0, y: 0, z: 0 })

  character.key('forward', true)
  character.advance(0.3)
  assert.equal(-character.velocity.z, T.crouchSpeed)
  character.key('slide', false)
  character.advance(0.3)
  assert.equal(character.eyeHeight, T.eyeHeight)
  assert.equal(-character.velocity.z, T.walkSpeed)
})

test('a sprint slide carries momentum through two jumps and landing restores the jumps', () => {
  const character = createCharacter(openFloor)
  character.key('forward', true)
  character.key('sprint', true)
  assert.ok(character.advance(0.5).sprintMetres > 0)
  assert.equal(-character.velocity.z, T.sprintSpeed)

  tap(character, 'slide')
  assert.deepEqual(character.advance(0.1), { events: [{ type: 'slide' }], sprintMetres: 0 })
  const slideSpeed = -character.velocity.z
  assert.ok(character.sliding && slideSpeed > T.sprintSpeed)

  tap(character, 'jump')
  assert.deepEqual(character.advance(0.2).events, [{ type: 'jump', number: 1 }])
  tap(character, 'jump')
  assert.deepEqual(character.advance(0.2).events, [{ type: 'jump', number: 2 }])
  assert.ok(character.position.y > T.jumpHeight)
  assert.equal(-character.velocity.z, slideSpeed)

  tap(character, 'jump')
  assert.deepEqual(character.advance(1).events, [])
  assert.ok(character.onGround)
  assert.equal(character.jumpsUsed, 0)
})
