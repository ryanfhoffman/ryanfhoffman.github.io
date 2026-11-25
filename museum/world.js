// Interior dimensions in metres, y up. The low, shallow recess at the end of
// the entry bay frames the sheet; the bay opens directly into the full lobby.
export const height = 6.4
export const doorHeight = 4.4
const T = 0.3 // wall / roof thickness
const mm = v => Math.round(v * 1000) / 1000
const rect = (minX, maxX, minZ, maxZ) => ({ minX, maxX, minZ, maxZ })
const cell = (minX, maxX, minZ, maxZ, high = height) => ({ ...rect(minX, maxX, minZ, maxZ), high })
const door = (a, b, c, d) => cell(a, b, c, d, doorHeight)
const recess = cell(-2.85, 2.85, 0, 0.16, 3.25)
const entry = cell(-3.25, 3.25, 0.16, 6.5)
const hall = cell(-9, 9, 6.5, 23)
const east = cell(9.3, 45.3, 10, 29.5)
const west = cell(-22.3, -9.3, 6.5, 30.5)
const atrium = cell(-9, 9, 23.3, 47, 12)
export const doors = [door(9, 9.3, 13.5, 17.5), door(-9.3, -9, 13.5, 17.5), door(-2, 2, 23, 23.3),
  door(9, 9.3, 24.5, 28.5), door(-9.3, -9, 24.5, 28.5)]
const cells = [recess, entry, hall, east, west, atrium, ...doors]
const slab = (r, minY, maxY) => ({ minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ, minY, maxY })
const riser = 0.2, going = 0.44, foot = 26.4
const steps = Array.from({ length: 26 }, (_, i) => ({
  ...slab(rect(-2.2, 2.2, mm(foot + i * going), mm(foot + (i + 1) * going)), 0, mm((i + 1) * riser)), stair: true,
}))
const last = steps.at(-1)
const deck = slab(rect(atrium.minX, atrium.maxX, last.maxZ, atrium.maxZ), mm(last.maxY - T), last.maxY)
export const rooms = [
  ['lobby', 0, 0, 15.5], ['long', 27, 0, 18], ['west', -15.8, 0, 18.5],
  ['broad', 5.4, 0, 32], ['upper', -3.6, deck.maxY, 41],
].map(([id, x, y, z]) => ({ id, stand: { x, y, z } }))

export const wallPages = [
  { id: 'resume', selector: 'main', at: { x: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, height: 3 },
]

// Each panel bounds the air inside its cell. Adjoining cells remove shared
// faces up to their common clear height. Remaining panels are real wall boxes.
function perimeter(floor) {
  const { minX, maxX, minZ, maxZ, high } = floor
  const corners = [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]]
  const opposite = ['maxZ', 'minX', 'minZ', 'maxX']
  const faces = []
  corners.forEach(([x, z], i) => {
    const [bx, bz] = corners[(i + 1) % 4]
    const dx = Math.sign(bx - x), dz = Math.sign(bz - z), length = mm(Math.hypot(bx - x, bz - z))
    const along = (px, pz) => mm((px - x) * dx + (pz - z) * dz)
    const spans = cells.filter(f => f[opposite[i]] === (dx ? z : x)).map(f => {
      const a = along(f.minX, f.minZ), b = along(f.maxX, f.maxZ)
      return { start: Math.max(0, Math.min(a, b)), end: Math.min(length, Math.max(a, b)), high: f.high }
    }).filter(s => s.start < s.end)
    const knots = [...new Set([0, length, ...spans.flatMap(s => [s.start, s.end])])].sort((a, b) => a - b)
    const point = (u, y) => [x + dx * u, y, z + dz * u]
    const edgeTop = u => Math.min(high, ...spans.filter(s => s.start === u || s.end === u).map(s => s.high))
    for (let k = 1; k < knots.length; k++) {
      const start = knots[k - 1], end = knots[k]
      const low = spans.find(s => s.start <= start && s.end >= end)?.high ?? 0
      if (low >= high) continue
      const [ax, , az] = point(start, 0), [ex, , ez] = point(end, 0)
      const xx = [ax, ex, ax + dz * T, ex + dz * T], zz = [az, ez, az - dx * T, ez - dx * T]
      const solid = slab(rect(mm(Math.min(...xx)), mm(Math.max(...xx)), mm(Math.min(...zz)), mm(Math.max(...zz))), low, high)
      faces.push({ point, dx, dz, start, end, low, high, leftTop: edgeTop(start), rightTop: edgeTop(end), solid })
    }
  })
  return faces
}
const panels = new Map(cells.map(c => [c, perimeter(c)]))
export const solids = [...panels.values()].flat().map(p => p.solid)
export const volumes = [...solids, ...steps, deck,
  ...cells.flatMap(c => [slab(c, -T, 0), slab(c, c.high, mm(c.high + T))])]

// Contact shading is baked at a few distances from each join. Broad white fields
// use the same material as the penumbra, with no shadow maps or screen-space pass.
const reach = 0.65;
const contact = d => Math.max(0, 1 - d / reach) ** 2;
function stations(lo, hi, joins) {
  const values = new Set([lo, hi]);
  for (const join of joins) for (const d of [-reach, -0.28, -0.09, 0, 0.09, 0.28, reach]) {
    const v = mm(join + d);
    if (v > lo && v < hi) values.add(v);
  }
  return [...values].sort((a, b) => a - b);
}

export function build(THREE) {
  const positions = [], shades = [], indices = [];
  function patch(us, vs, point, shade, reverse = false) {
    const base = shades.length, cols = us.length;
    for (const v of vs) for (const u of us) {
      positions.push(...point(u, v));
      shades.push(shade(u, v) / 255);
    }
    for (let j = 1; j < vs.length; j++) for (let i = 1; i < cols; i++) {
      const d = base + j * cols + i, a = d - cols - 1, b = a + 1, c = d - 1;
      if (reverse) indices.push(a, d, b, a, c, d);
      else indices.push(a, b, d, a, d, c);
    }
  }

  // A ribbon follows each architectural edge. Width and displacement are in
  // metres, so the marks stay anchored as the visitor moves.
  const ink = [], radii = [], tangents = [], inkIndices = [];
  function stroke(length, point, weight) {
    const first = radii.length, steps = Math.ceil(length / 0.14);
    const [x, y, z] = point(0, 0), phase = 2 * x + 3 * y - z;
    const [ex, ey, ez] = point(length, 0);
    for (let i = 0; i <= steps; i++) {
      const t = length * i / steps;
      const drift = 0.004 * Math.sin(t * 7 + phase) + 0.002 * Math.sin(t * 17 - phase);
      const radius = weight * (1 + 0.23 * Math.sin(t * 4 - phase) + 0.12 * Math.cos(t * 11));
      const center = point(t, drift);
      ink.push(...center, ...center);
      tangents.push(ex - x, ey - y, ez - z, ex - x, ey - y, ez - z);
      radii.push(-radius, radius);
      if (i) {
        const a = first + 2 * (i - 1);
        inkIndices.push(a, a + 1, a + 3, a, a + 3, a + 2);
      }
    }
  }

  for (const floor of cells) {
    const faces = panels.get(floor), inDoor = doors.includes(floor);
    const corners = faces.flatMap(f => [f.point(f.start, 0), f.point(f.end, 0)]);
    if (floor === atrium) corners.push([last.minX, 0, foot], [last.maxX, 0, deck.minZ]);
    const xs = stations(floor.minX, floor.maxX, corners.map(p => p[0]));
    const zs = stations(floor.minZ, floor.maxZ, corners.map(p => p[2]));
    for (const y of [0, floor.high]) {
      const contacts = solids.filter(s => (y === 0 ? s.minY === 0 : s.minY < y) && s.maxY >= y);
      if (!y && floor === atrium) contacts.push(...steps);
      patch(xs, zs, (x, z) => [x, y, z], (x, z) => {
        const d = Math.min(...contacts.map(s => Math.hypot(Math.max(s.minX - x, x - s.maxX, 0),
          Math.max(s.minZ - z, z - s.maxZ, 0))));
        return (y === 0 ? 248 : inDoor ? 226 : 252) - 29 * contact(d);
      }, y === 0);
    }
    for (const { point, dx, dz, start, end, low, high, leftTop, rightTop } of faces) {
      const [x, , z] = point(start, 0);
      const paper = wallPages.some(({ at, normal }) => {
        const u = (at.x - x) * dx + (at.z - z) * dz;
        return normal.x === -dz && normal.z === dx && (x - at.x) * normal.x + (z - at.z) * normal.z === 0 &&
          u >= 0 && u <= end - start;
      });
      const us = paper ? [start, end] : stations(start, end, [start, end]);
      const ys = paper ? [low, high] : stations(low, high, [low, high, leftTop, rightTop]);
      patch(us, ys, point, (u, y) => {
        const corner = Math.min(Math.hypot(u - start, Math.max(0, y - leftTop)),
          Math.hypot(end - u, Math.max(0, y - rightTop)));
        // A header and the adjacent wall share the same colour above their jamb.
        return paper ? 255 : (dx ? 254 : 249) - 20 * contact(corner) - 15 * contact(y) - 10 * contact(high - y);
      });
      stroke(end - start, (t, w) => point(start + t, low + w), low ? 0.016 : 0.014);
      stroke(end - start, (t, w) => point(start + t, high - w), 0.011);
      if (low === 0) {
        stroke(Math.min(high, leftTop), (t, w) => point(start + w, t), 0.013);
        stroke(Math.min(high, rightTop), (t, w) => point(end - w, t), 0.013);
      }
    }
  }

  // The stair is solid right down to the hall floor. Only exposed risers,
  // treads and sides are drawn. Coplanar side faces share a continuous field.
  const line = (a, b, weight = 0.012) => {
    const diff = b.map((n, i) => n - a[i]), length = Math.hypot(...diff);
    const wobble = diff[1] ? 0 : 1;
    stroke(length, (t, w) => a.map((n, i) => n + diff[i] * t / length + (i === wobble ? w : 0)), weight);
  };
  for (const b of steps) {
    const { minX: l, maxX: r, minZ: front, maxZ: back, maxY: y } = b, prev = mm(y - riser);
    patch([l, r], [front, back], (x, z) => [x, y, z], (_, z) => b !== last && z === back ? 231 : 248, true);
    patch([l, r], [prev, y], (x, h) => [x, h, front], (_, h) => h === prev ? 219 : 241, true);
    line([l, y, front], [r, y, front], 0.010);
    for (const x of [l, r]) {
      patch([front, back], stations(0, y, [0]), (z, h) => [x, h, z], (_, h) => 246 - 23 * contact(h), x === r);
      line([x, y, front], [x, y, back]);
      line([x, prev, front], [x, y, front]);
    }
  }
  line([last.minX, 0, foot], [last.maxX, 0, foot]);
  for (const x of [last.minX, last.maxX]) line([x, 0, foot], [x, 0, last.maxZ]);
  const { minX: l, maxX: r, minZ: front, maxZ: back, minY: under, maxY: top } = deck;
  const xs = stations(l, r, [l, r, last.minX, last.maxX]), zs = stations(front, back, [front, back]);
  for (const y of [under, top]) {
    patch(xs, zs, (x, z) => [x, y, z], (x, z) => (y === top ? 248 : 234) -
      22 * contact(Math.min(x - l, r - x, back - z)), y === top);
    line([l, y, front], [l, y, back]); line([r, y, front], [r, y, back]); line([l, y, back], [r, y, back]);
  }
  // From the lower passage the back of the stair meets the soffit overhead.
  patch([last.minX, last.maxX], stations(0, under, [0, under]), (x, y) => [x, y, front],
    (_, y) => 247 - 18 * contact(y) - 14 * contact(under - y));
  for (const y of [0, under]) line([last.minX, y, front], [last.maxX, y, front]);
  for (const x of [last.minX, last.maxX]) line([x, 0, front], [x, under, front]);
  for (const [a, b] of [[l, last.minX], [last.maxX, r]]) {
    patch([a, b], [under, top], (x, h) => [x, h, front], (_, h) => h === under ? 228 : 244, true);
    line([a, under, front], [b, under, front]); line([a, top, front], [b, top, front]);
  }

  // Opaque panels write depth. The ink hugs them, and the coplanar DOM aperture
  // can still clear alpha in front of the white support. Fog is in camera metres.
  function batch(name, coords, tones, triangles, isInk) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
    g.setAttribute('tone', new THREE.Float32BufferAttribute(tones, 1));
    if (isInk) g.setAttribute('along', new THREE.Float32BufferAttribute(tangents, 3));
    g.setIndex(triangles);
    const material = new THREE.ShaderMaterial({
      defines: isInk ? { INK: 1 } : {}, uniforms: { viewportHeight: { value: 1 } },
      vertexShader: `
        attribute float tone;
        varying float value, depth;
        #ifdef INK
          attribute vec3 along;
          uniform float viewportHeight;
          varying float across;
        #endif
        void main() {
          vec4 p = modelViewMatrix * vec4(position, 1.);
          depth = -p.z;
          value = tone;
          #ifdef INK
            vec3 a = mat3(modelViewMatrix) * along;
            vec2 tangent = a.xy * depth + p.xy * a.z;
            float pixel = 2. * max(.05, depth) / (viewportHeight * projectionMatrix[1][1]);
            value = abs(tone) / pixel;
            // Cover half a pixel beyond the nib on each side for subpixel strokes.
            across = sign(tone) * (value + .5);
            p.xy += vec2(-tangent.y, tangent.x) / max(length(tangent), .00001) * across * pixel;
          #endif
          gl_Position = projectionMatrix * p;
        }`,
      fragmentShader: `
        varying float value, depth;
        #ifdef INK
          varying float across;
        #endif
        void main() {
          float fog = smoothstep(2., 42., depth);
          #ifdef INK
            float cover = clamp(value + .5 - abs(across), 0., min(1., 2. * value));
            gl_FragColor = vec4(vec3(fog), cover);
          #else
            gl_FragColor = vec4(vec3(mix(value, 1., fog)), 1.);
          #endif
        }`,
      side: isInk ? THREE.DoubleSide : THREE.FrontSide, transparent: isInk, depthWrite: !isInk,
      polygonOffset: true, polygonOffsetFactor: isInk ? -1 : 1, polygonOffsetUnits: isInk ? -1 : 1,
    });
    material.forceSinglePass = true;
    const mesh = new THREE.Mesh(g, material);
    if (isInk) mesh.onBeforeRender = r => { material.uniforms.viewportHeight.value = r.domElement.height; };
    mesh.name = name;
    return mesh;
  }
  const group = new THREE.Group();
  group.name = 'museum';
  group.add(batch('plaster', positions, shades, indices, false), batch('ink', ink, radii, inkIndices, true));
  return group;
}
