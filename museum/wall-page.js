import * as THREE from '../vendor/three.module.js'
import { eyeHeight, pageFov } from './tuning.js'

const padding = 10 // native CSS pixels
const reach = 3.6 // metres along the aiming ray

function measureText(page, width, height, bounds) {
  const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let left = width, top = height, right = 0, bottom = 0
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.data.trim()
    if (!text || !node.parentElement.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue
    const start = node.data.indexOf(text)
    range.setStart(node, start)
    range.setEnd(node, start + text.length)
    for (const r of range.getClientRects()) {
      if (!r.width || !r.height || r.right <= 0 || r.left >= width || r.bottom <= 0 || r.top >= height) continue
      left = Math.min(left, r.left)
      top = Math.min(top, r.top)
      right = Math.max(right, r.right)
      bottom = Math.max(bottom, r.bottom)
    }
  }
  if (right <= left || bottom <= top) return bounds.set(1, 1, 0, 0)
  return bounds.set(Math.max(0, left - padding), Math.max(0, top - padding),
    Math.min(width, right + padding), Math.min(height, bottom + padding))
}

// Reparenting a subtree collapses a native selection inside it.
function movePage(page, move) {
  const selection = getSelection()
  const { anchorNode, anchorOffset, focusNode, focusOffset } = selection
  move()
  if (anchorNode && focusNode && (page.contains(anchorNode) || page.contains(focusNode)))
    selection.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset)
}

// The canvas is opaque except where this front-sided plane wins the depth test.
// Through it the browser paints the original HTML, including private visited-link colors.
export function wallPage(scene, { id, selector, at, normal, height }) {
  const center = new THREE.Vector3(at.x, eyeHeight, at.z), n = new THREE.Vector3().copy(normal).normalize()
  const yaw = Math.atan2(n.x, n.z)
  const right = new THREE.Vector3(n.z, 0, -n.x), offset = new THREE.Vector3()
  const distance = height / (2 * Math.tan(THREE.MathUtils.degToRad(pageFov) / 2))
  const flatEye = center.clone().addScaledVector(n, distance)
  const glow = { value: 0 }, size = { value: new THREE.Vector2() }
  const bounds = new THREE.Vector4(1, 1, 0, 0)
  const hole = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.ShaderMaterial({
    uniforms: { glow, size, bounds: { value: bounds } },
    vertexShader: `varying vec2 point;
      void main() {
        point = vec2(uv.x, 1.0 - uv.y);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `uniform float glow;
      uniform vec2 size;
      uniform vec4 bounds;
      varying vec2 point;
      void main() {
        vec2 p = point * size;
        vec2 edges = min(p - bounds.xy, bounds.zw - p);
        float d = min(edges.x, edges.y);
        float alpha = glow * 0.62 * smoothstep(0.0, 2.0, d) * (1.0 - smoothstep(2.0, 9.0, d));
        gl_FragColor = vec4(vec3(0.28, 0.57, 0.96) * alpha, alpha);
      }`, blending: THREE.NoBlending,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }))
  hole.position.copy(center)
  hole.rotation.y = yaw
  scene.add(hole)

  const surface = document.createElement('div'), column = document.createElement('div')
  surface.style.cssText = 'position:fixed;top:0;left:0;overflow:clip;transform-origin:0 0'
  column.style.position = 'absolute'
  surface.append(column)
  const viewport = new THREE.Matrix4(), pixels = new THREE.Matrix4(), matrix = new THREE.Matrix4()
  let page, rect, x, y, dirty = false
  const changes = new MutationObserver(records => {
    if (!page.isConnected || records.some(r => page.contains(r.target))) dirty = true
  })
  function watchPage() {
    changes.observe(page, { subtree: true, childList: true, characterData: true, attributes: true })
    changes.observe(page.parentNode, { childList: true })
  }

  function resize(w, h) {
    hole.scale.set(height * w / h, height, 1)
    size.value.set(w, h)
    hole.updateMatrixWorld()
    pixels.makeScale(1 / w, -1 / h, 1).setPosition(-0.5, 0.5, 0)
    viewport.makeScale(w / 2, -h / 2, 1).setPosition(w / 2, h / 2, 0)
    surface.style.width = `${w}px`
    surface.style.height = `${h}px`
  }
  // On resize, briefly lay this page out in its own slot, at its own saved scroll.
  // Other pages can stay projected while we measure this one.
  function capture() {
    const mounted = surface.isConnected, nativeX = scrollX, nativeY = scrollY
    changes.disconnect()
    if (mounted) restore()
    page = document.querySelector(selector)
    rect = page.getBoundingClientRect()
    x = scrollX
    y = scrollY
    measureText(page, size.value.x, size.value.y, bounds)
    dirty = false
    column.style.width = getComputedStyle(page.parentElement).width
    if (mounted) {
      mount()
      window.scrollTo(nativeX, nativeY)
    } else watchPage()
  }
  function restore() {
    if (!surface.isConnected) return
    changes.disconnect()
    page = column.firstElementChild ?? page
    movePage(page, () => surface.replaceWith(page))
    surface.hidden = false
    window.scrollTo(x, y)
    watchPage()
  }
  function hitDistance(ray) {
    if (dirty) capture()
    const facing = -ray.direction.dot(n)
    if (facing <= 0) return Infinity
    offset.subVectors(ray.origin, center)
    const d = offset.dot(n) / facing
    if (d < 0.05 || d > reach) return Infinity
    offset.addScaledVector(ray.direction, d)
    const px = (0.5 + offset.dot(right) / hole.scale.x) * size.value.x
    const py = (0.5 - offset.y / height) * size.value.y
    return px >= bounds.x && px <= bounds.z && py >= bounds.y && py <= bounds.w ? d : Infinity
  }
  function aligned(camera) {
    return camera.fov === pageFov && camera.position.equals(flatEye) &&
      camera.rotation.y === yaw && !camera.rotation.x && !camera.rotation.z
  }
  function mount() {
    changes.disconnect()
    surface.style.transform = 'none'
    column.style.left = column.style.top = '0px'
    page.before(surface)
    movePage(page, () => column.append(page))
    const local = page.getBoundingClientRect()
    column.style.left = `${rect.left - local.left}px`
    column.style.top = `${rect.top - local.top}px`
    watchPage()
  }
  function project(camera, alignedWall, aimed, dt) {
    if (dirty) capture()
    // At either identity frame even layer promotion of the original glyphs is visible.
    glow.value = alignedWall ? 0 : THREE.MathUtils.clamp(glow.value + (aimed ? dt : -dt) / 0.18, 0, 1)
    if (alignedWall?.id === id) return restore()
    if (!surface.isConnected) mount()
    surface.hidden = !!alignedWall || camera.position.dot(n) <= center.dot(n)
    if (surface.hidden) return
    // Keep homogeneous w for perspective. CSS owns the depth of the DOM layer.
    matrix.copy(viewport).multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse)
      .multiply(hole.matrixWorld).multiply(pixels)
    const e = matrix.elements
    e[2] = e[6] = e[8] = e[9] = e[11] = e[14] = 0
    e[10] = 1
    surface.style.transform = `matrix3d(${e.join(',')})`
  }
  const info = () => ({ id, center: { ...center }, normal: { ...normal }, width: hole.scale.x, height })
  return { id, flatEye, yaw, resize, capture, project, restore, info, aligned, hitDistance }
}
