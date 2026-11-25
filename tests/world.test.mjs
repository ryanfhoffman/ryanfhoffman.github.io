import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from '../vendor/three.module.js'
import * as world from '../museum/world.js'
import { createCharacter } from '../museum/movement.js'
import { bodyRadius, eyeHeight, sprintSpeed } from '../museum/tuning.js'

const stairs = world.volumes.filter(box => box.stair)
const upper = world.rooms.find(room => room.id === 'upper').stand

test('a sprint through the lobby doorway stops at the visible gallery wall', () => {
  const lobby = world.rooms[0].stand
  const gallery = world.rooms.find(room => room.id === 'long').stand
  const mesh = world.build(THREE).getObjectByName('plaster')
  mesh.updateWorldMatrix(true, false)
  const ray = new THREE.Raycaster(
    new THREE.Vector3(lobby.x, lobby.y + eyeHeight, lobby.z), new THREE.Vector3(1, 0, 0))
  const [wall] = ray.intersectObject(mesh)
  assert.ok(wall && wall.point.x > gallery.x, 'the doorway opens into the gallery')

  const character = createCharacter(world)
  character.place(lobby)
  character.key('right', true)
  character.key('sprint', true)
  character.advance(wall.distance / sprintSpeed + 0.5)
  assert.ok(character.onGround)
  assert.ok(Math.abs(character.position.x + bodyRadius - wall.point.x) < 1e-5)
  assert.equal(character.advance(1 / 30).sprintMetres, 0, 'no footsteps into a wall')
})

test('walking up and down the staircase keeps the visitor grounded', () => {
  const character = createCharacter(world)
  character.place({ x: 0, z: stairs[0].minZ - 1 })

  function walk(key, seconds) {
    character.key(key, true)
    for (let frame = 0; frame < seconds * 30; frame++) {
      character.advance(1 / 30)
      assert.ok(character.onGround, `lost footing at z=${character.position.z}`)
    }
    character.key(key, false)
  }

  walk('back', 4)
  assert.ok(character.position.z > stairs.at(-1).maxZ)
  assert.equal(character.position.y, upper.y)
  walk('forward', 4.6)
  assert.ok(character.position.z < stairs[0].minZ)
  assert.equal(character.position.y, 0)
})

test('walking off the upper landing falls to the lower gallery floor', () => {
  const character = createCharacter(world)
  character.place(upper)
  assert.ok(character.onGround)
  character.key('forward', true)
  character.advance(1)
  assert.ok(!character.onGround && character.position.y > 0 && character.position.y < upper.y)
  character.advance(1)
  assert.ok(character.onGround)
  assert.equal(character.position.y, 0)
})
