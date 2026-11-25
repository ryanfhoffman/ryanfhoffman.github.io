import * as THREE from '../vendor/three.module.js'
import * as world from './world.js'
import * as T from './tuning.js'
import { collisionVolumes, createCharacter } from './movement.js'
import { wallPage } from './wall-page.js'
import { createExtras } from './extras.js'
import { createMuseumAudio } from './audio.js'

export function start(api) {
  const canvas = document.createElement('canvas')
  if (!canvas.requestPointerLock || !document.exitPointerLock) return false
  const gl = canvas.getContext('webgl2', { antialias: false })
  if (!gl) return false
  const renderer = new THREE.WebGLRenderer({ canvas, context: gl, alpha: true })
  renderer.setClearColor(0xffffff, 1)
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:1;display:none'
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(T.pageFov, 1, 0.05, 100)
  scene.add(world.build(THREE))
  const walls = world.wallPages.map(page => wallPage(scene, page))
  const character = createCharacter(world)
  let selected = walls[0], glowing = null, glide = null, ownsMouse = false
  function standAtPage() {
    const { x, y, z } = selected.flatEye
    character.place({ x, y: y - T.eyeHeight, z })
    character.yaw = selected.yaw
  }
  standAtPage()
  let mode = 'page', pausedFrom, pitch = 0, widening = 0, sprint = 0
  const playing = () => mode === 'museum' || mode === 'focusing'
  const pixel = new Uint8Array(4)
  const ray = new THREE.Ray(), intersection = new THREE.Vector3()
  const blockers = collisionVolumes(world).map(b => new THREE.Box3(
    new THREE.Vector3(b.minX, b.minY, b.minZ), new THREE.Vector3(b.maxX, b.maxY, b.maxZ)))

  function aimedWall() {
    ray.origin.copy(camera.position)
    camera.getWorldDirection(ray.direction)
    let nearest = null, distance = Infinity
    for (const wall of walls) {
      const d = wall.hitDistance(ray)
      if (d < distance) { nearest = wall; distance = d }
    }
    if (nearest && blockers.some(b => b.containsPoint(ray.origin) || (ray.intersectBox(b, intersection) &&
        intersection.distanceTo(ray.origin) < distance - 1e-5))) return null
    return nearest
  }

  function resize() {
    const live = playing() || mode === 'paused'
    const w = innerWidth, h = innerHeight
    if (canvas.width !== w || canvas.height !== h) renderer.setSize(w, h, false)
    camera.aspect = w / h
    for (const wall of walls) {
      wall.resize(w, h)
      if (live) wall.capture()
    }
    if (live) draw(false)
  }
  function walkingCamera() {
    camera.position.copy(character.position)
    camera.position.y += character.eyeHeight
    camera.rotation.set(pitch, character.yaw, 0, 'YXZ')
  }
  function draw(sync, dt = 0) {
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld()
    if (mode !== 'paused') glowing = mode === 'museum' ? aimedWall() : null
    if (playing() || mode === 'paused') {
      const aligned = walls.find(wall => wall.aligned(camera))
      for (const wall of walls) wall.project(camera, aligned, wall === glowing, dt)
    }
    renderer.render(scene, camera)
    if (sync) {
      gl.finish()
      // SwiftShader can still have draws queued after finish. Wait for a framebuffer pixel.
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
    }
  }
  function focusFrame(dt, sync) {
    // Only a positive step following a rendered endpoint hands hit-testing to the page.
    if (glide.elapsed === T.focusTime) {
      if (dt === 0) return draw(sync)
      mode = 'focused'
      glide = null
      canvas.style.display = 'none'
      releaseMouse()
      return
    }
    glide.elapsed += dt
    if (glide.elapsed >= T.focusTime - 1e-10) {
      glide.elapsed = T.focusTime
      standAtPage()
      pitch = sprint = 0
      walkingCamera()
      camera.fov = T.pageFov
    } else {
      const t = glideFraction()
      camera.position.lerpVectors(glide.eye, selected.flatEye, t)
      camera.quaternion.slerpQuaternions(glide.rotation, glide.upright, t)
      camera.fov = THREE.MathUtils.lerp(glide.fov, T.pageFov, t)
    }
    draw(sync, dt)
  }
  function glideFraction() {
    return THREE.MathUtils.smoothstep(glide.elapsed, 0, T.focusTime)
  }
  function frame(ms, sync) {
    if (mode === 'page') {
      ageMs += ms
      extras.stepPage(ageMs)
      return
    }
    if (mode === 'paused') {
      if (sync) draw(true)
      return
    }
    const dt = ms / 1000
    if (mode === 'focusing') return focusFrame(dt, sync)
    if (mode !== 'museum') return
    if (dt > 0) {
      const { events, sprintMetres } = character.advance(dt)
      for (const event of events) {
        if (event.type === 'jump') audio.jump(event.number)
        else if (event.type === 'slide') audio.slide()
      }
      audio.step(sprintMetres)
      extras.stepMuseum(dt)
    }
    widening = Math.min(widening + dt, T.fovWidenTime)
    const progress = THREE.MathUtils.smoothstep(widening, 0, T.fovWidenTime)
    const t = THREE.MathUtils.smoothstep(progress, 0, 1)
    const delta = dt / T.sprintFovTime
    sprint += THREE.MathUtils.clamp(Number(character.sprinting) - sprint, -delta, delta)
    camera.fov = T.pageFov + t * (T.museumFov - T.pageFov + sprint * T.sprintFovExtra)
    walkingCamera()
    draw(sync, dt)
  }

  function animate(stamp) {
    const next = Math.max(last, stamp)
    frame(next - last, false)
    last = next
    raf = requestAnimationFrame(animate)
  }
  async function captureMouse() {
    if (!document.pointerLockElement) {
      try { await canvas.requestPointerLock() } catch { /* A click gets another chance. */ }
    }
  }
  function releaseMouse() {
    ownsMouse = false
    if (document.pointerLockElement === canvas) document.exitPointerLock()
  }
  function lockChanged() {
    const previouslyOwned = ownsMouse
    ownsMouse = document.pointerLockElement === canvas
    if (ownsMouse && !playing()) releaseMouse() // A request completed after focus or pause.
    else if (previouslyOwned && !ownsMouse && playing()) pause()
  }
  function enter() {
    const first = mode === 'page'
    if (first) extras.reveal()
    audio.enter()
    widening = 0
    mode = 'museum'
    resize() // Capture the native layout and draw the flat pose before showing the canvas.
    canvas.style.display = 'block'
    captureMouse()
    last = performance.now()
  }
  const keys = { KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right', Space: 'jump',
    KeyC: 'slide', ShiftLeft: 'sprint', ShiftRight: 'sprint' }
  function pause() {
    if (!playing()) return
    pausedFrom = mode
    mode = 'paused'
    audio.quiet()
    character.releaseKeys()
    releaseMouse()
    extras.setPaused(true)
  }
  function click(event) {
    if (!event.isTrusted || event.button !== 0) return
    if (mode === 'paused') {
      event.preventDefault()
      mode = pausedFrom
      extras.setPaused(false)
      if (mode === 'museum') audio.enter()
      captureMouse()
      last = performance.now()
      return
    }
    if (mode !== 'museum') return
    event.preventDefault()
    if (document.pointerLockElement !== canvas) {
      audio.enter()
      captureMouse()
      return
    }
    if (!glowing) return
    audio.quiet()
    extras.finishTitle()
    selected = glowing
    glide = { elapsed: 0, eye: camera.position.clone(), fov: camera.fov, rotation: camera.quaternion.clone(),
      upright: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, selected.yaw, 0, 'YXZ')) }
    character.releaseKeys()
    mode = 'focusing'
    glowing = null
  }
  function key(event) {
    const name = keys[event.code], down = event.type === 'keydown'
    if (!event.isTrusted) return
    if (event.code === 'Escape' && down && playing()) {
      event.preventDefault()
      if (!event.repeat) pause()
      return
    }
    if (!name) return
    if (mode === 'page' || mode === 'focused') {
      const target = event.composedPath()[0]
      if (!down || event.repeat || !/^Key[WASD]$/.test(event.code) ||
          event.ctrlKey || event.altKey || event.metaKey ||
          target.isContentEditable || target.closest?.('input,textarea,select')) return
      enter()
      character.key('sprint', event.shiftKey)
    }
    event.preventDefault()
    if (mode !== 'museum' || event.repeat) return
    if (name !== 'sprint' || down || !event.shiftKey) character.key(name, down)
  }
  const sensitivity = THREE.MathUtils.degToRad(T.mouseSensitivity)
  const pitchLimit = THREE.MathUtils.degToRad(T.pitchLimit)
  function mouse(event) {
    if (mode !== 'museum' || document.pointerLockElement !== canvas) return
    if (!event.movementX && !event.movementY) return
    character.yaw -= event.movementX * sensitivity
    pitch = THREE.MathUtils.clamp(pitch - event.movementY * sensitivity, -pitchLimit, pitchLimit)
    walkingCamera()
    glowing = aimedWall() // A click can arrive between this mouse event and the next draw.
  }
  function place({ position, lookAt }) {
    if (mode !== 'museum') return
    character.place(position)
    const dx = lookAt.x - position.x, dz = lookAt.z - position.z
    character.yaw = Math.atan2(-dx, -dz)
    pitch = Math.atan2(lookAt.y - (character.position.y + character.eyeHeight), Math.hypot(dx, dz))
    sprint = 0
    frame(0)
  }
  function state() {
    const { velocity, onGround, sprinting, sliding, jumpsUsed, yaw } = character
    let { position, eyeHeight } = character
    const heading = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'))
    if (glide) {
      const t = glideFraction()
      heading.slerp(glide.upright, t)
      eyeHeight = THREE.MathUtils.lerp(eyeHeight, T.eyeHeight, t)
      position = { x: camera.position.x, y: camera.position.y - eyeHeight, z: camera.position.z }
    }
    const forward = { ...new THREE.Vector3(0, 0, -1).applyQuaternion(heading) }
    return { mode, position: { ...position }, velocity: { ...velocity }, forward, fov: camera.fov,
      eyeHeight, onGround, sprinting, sliding, jumpsUsed, flip: null,
      glowing: glowing?.id ?? null, hintOpacity: extras.hintOpacity, notesPlayed: extras.notesPlayed }
  }

  resize()
  walkingCamera()
  draw(true) // Compile and upload the scene before the reveal key is accepted.
  if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR) return false
  // performance.now() and the animation timestamp both use the navigation time origin.
  let ageMs = performance.now(), last = ageMs
  const extras = createExtras(ageMs)
  const audio = createMuseumAudio()
  document.body.append(canvas)
  addEventListener('resize', resize)
  addEventListener('keydown', key)
  addEventListener('keyup', key)
  addEventListener('mousemove', mouse, true)
  addEventListener('click', click)
  document.addEventListener('pointerlockchange', lockChanged)
  addEventListener('blur', character.releaseKeys)
  addEventListener('pagehide', pause)
  let raf = requestAnimationFrame(animate)
  if (api) Object.assign(api, { manualClock: () => cancelAnimationFrame(raf), step: ms => frame(ms, true),
    state, place, rooms: () => structuredClone(world.rooms), wallPages: () => walls.map(wall => wall.info()) })
  return true
}
