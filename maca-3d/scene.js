// MAÇA matcha bar — procedural 3D reconstruction of the VIA interior renders.
// Units are metres. The shop runs from the glass facade (z = 0) to the back wall (z = -9).
// Looking in from the terrace: walnut cabinetry on the left (x = -1.2), plaster wall with
// arch on the right (x = 1.7), stone-clad counter in the middle, terrace outside (z > 0).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const params = new URLSearchParams(location.search);
const RECORD = params.has('record');
if (RECORD) document.body.classList.add('record');
const VW = RECORD ? +(params.get('w') || 1280) : innerWidth;
const VH = RECORD ? +(params.get('h') || 720) : innerHeight;
const PR = RECORD ? 1 : Math.min(devicePixelRatio, 2);

const H = 3.1; // ceiling height
const CAB = -1.2; // front face of the left walnut cabinetry
const RW = 1.7; // right wall

// ---------- deterministic helpers ----------
let seed = 20260107;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = (a) => a[Math.floor(rand() * a.length)];
const range = (a, b) => a + rand() * (b - a);

function hash3(x, y, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const s = (t) => t * t * (3 - 2 * t);
  const u = s(x - xi), v = s(y - yi), w = s(z - zi);
  let r = 0;
  for (let dx = 0; dx < 2; dx++)
    for (let dy = 0; dy < 2; dy++)
      for (let dz = 0; dz < 2; dz++)
        r += hash3(xi + dx, yi + dy, zi + dz) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  return r * 2 - 1;
}
function fbm(x, y, z, oct = 4) {
  let a = 0.5, f = 1, s = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, z * f); a *= 0.5; f *= 2.03; }
  return s;
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function toTex(c, ru = 1, rv = 1) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(ru, rv);
  t.anisotropy = 8;
  return t;
}

// ---------- procedural textures ----------
function woodCanvas(base, { groove = true, lines = 340, contrast = 1 } = {}) {
  const [c, g] = makeCanvas(512, 1024);
  g.fillStyle = base; g.fillRect(0, 0, 512, 1024);
  for (let i = 0; i < 16; i++) {
    g.fillStyle = rand() < 0.5 ? `rgba(40,20,8,${(0.03 + rand() * 0.06) * contrast})` : `rgba(255,225,180,${(0.03 + rand() * 0.05) * contrast})`;
    g.fillRect(rand() * 512, 0, 20 + rand() * 70, 1024);
  }
  for (let i = 0; i < lines; i++) {
    const x = rand() * 512, amp = 1 + rand() * 6, k = 1 + Math.floor(rand() * 3), ph = rand() * 6.28;
    const a = (0.04 + rand() * 0.14) * contrast;
    g.strokeStyle = rand() < 0.65 ? `rgba(30,14,4,${a})` : `rgba(255,222,175,${a * 0.6})`;
    g.lineWidth = 0.5 + rand() * 2.2;
    g.beginPath();
    for (let y = 0; y <= 1024; y += 16) {
      const px = x + amp * Math.sin((y / 1024) * Math.PI * 2 * k + ph);
      y ? g.lineTo(px, y) : g.moveTo(px, y);
    }
    g.stroke();
  }
  if (groove) { g.fillStyle = 'rgba(15,8,3,0.85)'; g.fillRect(0, 0, 3, 1024); }
  return c;
}

function plasterCanvas(base, light, dark, n = 900, size = 1024) {
  const [c, g] = makeCanvas(size, size);
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  for (let i = 0; i < n; i++) {
    const x = rand() * size, y = rand() * size, r = 6 + rand() * 55;
    const col = rand() < 0.5 ? light : dark;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      if (x + ox + r < 0 || x + ox - r > size || y + oy + r < 0 || y + oy - r > size) continue;
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  }
  return c;
}

function tileCanvas(base, grout, tiles = 2, size = 1024) {
  const c = plasterCanvas(base, 'rgba(255,255,255,0.05)', 'rgba(120,100,80,0.05)', 500, size);
  const g = c.getContext('2d');
  const s = size / tiles;
  g.fillStyle = grout;
  for (let i = 0; i < tiles; i++) { g.fillRect(i * s, 0, 2, size); g.fillRect(0, i * s, size, 2); }
  return c;
}

function stoneCanvas() {
  const [c, g] = makeCanvas(512, 512);
  const img = g.createImageData(512, 512);
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    const n = fbm(x / 60, y / 25, 3.3, 5) * 0.5 + fbm(x / 9, y / 9, 7.1, 2) * 0.15;
    const i = (y * 512 + x) * 4;
    img.data[i] = 150 + n * 80; img.data[i + 1] = 146 + n * 78; img.data[i + 2] = 118 + n * 70; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: RECORD, powerPreference: 'high-performance' });
renderer.setPixelRatio(PR);
renderer.setSize(VW, VH);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#dfe3e4');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.2;

const camera = new THREE.PerspectiveCamera(52, VW / VH, 0.05, 300);
camera.rotation.order = 'YXZ';

// ---------- materials ----------
const std = (o) => new THREE.MeshStandardMaterial(o);
const walnutTex = toTex(woodCanvas('#6a4529'), 1 / 0.6, 1 / 1.2);
const walnut = std({ map: walnutTex, roughness: 0.55, color: '#ffffff' });
const oakTex = toTex(woodCanvas('#a8794c', { contrast: 0.8 }), 1 / 0.45, 1 / 1.2);
const oak = std({ map: oakTex, roughness: 0.6 });
const plaster = std({ map: toTex(plasterCanvas('#d8d0c6', 'rgba(255,250,240,0.06)', 'rgba(140,125,110,0.045)', 1400), 0.5, 0.5), roughness: 0.92 });
const concrete = std({ map: toTex(plasterCanvas('#aaa69f', 'rgba(255,255,255,0.05)', 'rgba(70,65,60,0.05)', 1400), 0.5, 0.5), roughness: 0.9 });
const ceilingMat = std({ map: toTex(plasterCanvas('#56623f', 'rgba(150,170,120,0.05)', 'rgba(20,30,15,0.06)', 1400), 0.5, 0.5), roughness: 0.95, side: THREE.DoubleSide });
const floorMat = std({ map: toTex(tileCanvas('#d2c9bb', '#b8ad9d'), 1 / 1.8, 1 / 1.8), roughness: 0.32 });
const nicheMat = std({ color: '#1e1915', roughness: 0.7, side: THREE.BackSide });
const shelfMat = std({ color: '#191512', roughness: 0.5 });
const ledMat = std({ color: '#ffd7a0', emissive: '#ffc985', emissiveIntensity: 4 });
const darkTop = std({ color: '#1c1b1a', roughness: 0.28, metalness: 0.1 });
const bronze = std({ color: '#8a7a64', roughness: 0.38, metalness: 0.75 });
const blackMetal = std({ color: '#1a1a1a', roughness: 0.4, metalness: 0.6 });
const mullionMat = std({ color: '#3a4037', roughness: 0.45, metalness: 0.5 });
const greenMetal = std({ color: '#6f8c64', roughness: 0.45, metalness: 0.4 });
const facadeMat = std({ map: toTex(plasterCanvas('#dcd6cd', 'rgba(255,255,255,0.08)', 'rgba(150,140,130,0.06)'), 0.5, 0.5), roughness: 0.9 });
const glass = new THREE.MeshPhysicalMaterial({ color: '#e4eeea', transparent: true, opacity: 0.1, roughness: 0.04, metalness: 0, depthWrite: false, side: THREE.DoubleSide });
const whitePlastic = std({ color: '#f2f2f0', roughness: 0.35 });

// Boxes get world-space UVs so one texture scale works everywhere (1 uv unit = 1 m).
function box(w, h, d, mat, x, y, z, parent = scene) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const px = p.getX(i) + x, py = p.getY(i) + y, pz = p.getZ(i) + z;
    if (Math.abs(n.getX(i)) > 0.5) uv.setXY(i, -pz, py);
    else if (Math.abs(n.getY(i)) > 0.5) uv.setXY(i, px, -pz);
    else uv.setXY(i, px, py);
  }
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
const bx = (x0, x1, y0, y1, z0, z1, mat, parent) =>
  box(x1 - x0, y1 - y0, z1 - z0, mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, parent);

function cyl(rt, rb, h, mat, x, y, z, seg = 24, parent = scene) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y + h / 2, z);
  parent.add(m);
  return m;
}

// Vertical plane facing +x (on the left wall) or -x (right wall)
function wallPlane(w, h, mat, x, y, z, facing = 1) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z);
  m.rotation.y = facing > 0 ? Math.PI / 2 : -Math.PI / 2;
  scene.add(m);
  return m;
}

// Extruded wall built in (u = -z, v = y) coordinates, sitting between x0 and x0 + depth.
function extrudedWall(shape, depth, mat, x0) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  const m = new THREE.Mesh(geo, mat);
  m.rotation.y = Math.PI / 2;
  m.position.x = x0;
  scene.add(m);
  return m;
}
const rectPath = (u0, u1, v0, v1) => {
  const p = new THREE.Path();
  p.moveTo(u0, v0); p.lineTo(u1, v0); p.lineTo(u1, v1); p.lineTo(u0, v1); p.closePath();
  return p;
};

// ---------- room shell ----------
// floor + ceiling
{
  const f = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 9), floorMat);
  f.rotation.x = -Math.PI / 2; f.position.set(0, 0, -4.5);
  f.geometry.attributes.uv.array.forEach((_, i, a) => { a[i] *= i % 2 ? 9 : 3.4; });
  scene.add(f);
  const c = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 9), ceilingMat);
  c.rotation.x = Math.PI / 2; c.position.set(0, H, -4.5);
  c.geometry.attributes.uv.array.forEach((_, i, a) => { a[i] *= i % 2 ? 9 : 3.4; });
  scene.add(c);
}

// left walnut cabinetry with recessed openings
const NICHE_A = { u0: 0.9, u1: 2.3, v0: 0.62, v1: 2.45 };
const GRILLE_A = { u0: 0.9, u1: 2.3, v0: 0.08, v1: 0.55 };
const NICHE_B = { u0: 3.9, u1: 7.4, v0: 1.12, v1: 1.95 };
{
  const s = new THREE.Shape();
  s.moveTo(0.7, 0); s.lineTo(9, 0); s.lineTo(9, H); s.lineTo(0.7, H); s.closePath();
  for (const r of [NICHE_A, GRILLE_A, NICHE_B]) s.holes.push(rectPath(r.u0, r.u1, r.v0, r.v1));
  extrudedWall(s, 0.5, walnut, -1.7);
  const lining = (r, depth = 0.48) =>
    bx(CAB - depth, CAB + 0.002, r.v0 + 0.002, r.v1 - 0.002, -r.u1 + 0.002, -r.u0 - 0.002, nicheMat);
  lining(NICHE_A); lining(GRILLE_A); lining(NICHE_B);
  // slatted grille under the display
  for (let i = 0; i < 6; i++) {
    const y = GRILLE_A.v0 + 0.03 + i * 0.075;
    bx(CAB - 0.06, CAB - 0.02, y, y + 0.035, -GRILLE_A.u1, -GRILLE_A.u0, walnut);
  }
}

// right plaster wall with an arched opening near the front, oak wainscot below
const ARCH = { u0: 1.5, u1: 2.9, spring: 2.0 };
{
  const r = (ARCH.u1 - ARCH.u0) / 2;
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.lineTo(ARCH.u0, 0); s.lineTo(ARCH.u0, ARCH.spring);
  s.absarc(ARCH.u0 + r, ARCH.spring, r, Math.PI, 0, true);
  s.lineTo(ARCH.u1, 0); s.lineTo(9, 0); s.lineTo(9, H); s.lineTo(0, H); s.closePath();
  extrudedWall(s, 0.25, plaster, RW);
  bx(RW - 0.025, RW, 0, 1.1, -9, -ARCH.u1, oak);
  bx(RW - 0.025, RW, 0, 1.1, -ARCH.u0, -0.03, oak);
}

// back wall: concrete with flush doors and a pillar
{
  const m = new THREE.Mesh(new THREE.PlaneGeometry(3.4, H), concrete);
  m.position.set(0, H / 2, -9);
  m.geometry.attributes.uv.array.forEach((_, i, a) => { a[i] *= i % 2 ? H : 3.4; });
  scene.add(m);
  bx(0.05, 0.45, 0, H, -9, -8.65, concrete);
  const groove = std({ color: '#3b3936', roughness: 0.8 });
  const door = (x0, x1) => {
    bx(x0, x0 + 0.008, 0, 2.35, -9, -8.995, groove);
    bx(x1 - 0.008, x1, 0, 2.35, -9, -8.995, groove);
    bx(x0, x1, 2.342, 2.35, -9, -8.995, groove);
  };
  door(0.6, 1.5);
  door(-0.7, -0.05);
  bx(0.66, 0.68, 0.95, 1.12, -8.99, -8.96, blackMetal);
  bx(0.66, 0.78, 1.0, 1.02, -8.97, -8.94, blackMetal);
}

// ---------- ceiling fixtures ----------
const downlightMat = std({ color: '#0f0f0f', roughness: 0.6 });
const downlightGlow = std({ color: '#fff3e0', emissive: '#ffe2b8', emissiveIntensity: 6 });
function downlight(x, z) {
  for (const dx of [-0.06, 0.06]) {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.01, 20), downlightMat);
    r.position.set(x + dx, H - 0.005, z); scene.add(r);
    const g = new THREE.Mesh(new THREE.CircleGeometry(0.022, 16), downlightGlow);
    g.rotation.x = Math.PI / 2; g.position.set(x + dx, H - 0.011, z); scene.add(g);
  }
}
for (let z = -0.9; z > -9; z -= 1.6) { downlight(-0.55, z); downlight(1.15, z); }
function cassette(x, z) {
  bx(x - 0.42, x + 0.42, H - 0.07, H, z - 0.42, z + 0.42, std({ color: '#2a2622', roughness: 0.55 }));
  const grill = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.27, 48), std({ color: '#141210', roughness: 0.8, side: THREE.DoubleSide }));
  grill.rotation.x = Math.PI / 2; grill.position.set(x, H - 0.072, z); scene.add(grill);
  const led = new THREE.Mesh(new THREE.CircleGeometry(0.008, 10), std({ color: '#f33', emissive: '#f33', emissiveIntensity: 3 }));
  led.rotation.x = Math.PI / 2; led.position.set(x + 0.02, H - 0.073, z + 0.2); scene.add(led);
}
cassette(0.35, -2.8);
cassette(0.35, -6.6);

// ---------- products ----------
const labelCache = new Map();
function labelMat(color, kind) {
  const key = color + kind;
  if (labelCache.has(key)) return labelCache.get(key);
  const [c, g] = makeCanvas(128, 256);
  g.fillStyle = color; g.fillRect(0, 0, 128, 256);
  if (kind !== 'plain') {
    g.fillStyle = kind === 'dark' ? '#1f3d22' : '#fbfaf5';
    g.fillRect(0, 95, 128, 80);
    g.fillStyle = color === '#fbfaf5' ? '#3d7a35' : color;
    g.fillRect(14, 112, 100, 10);
    g.fillRect(24, 132, 80, 6);
    g.fillRect(34, 146, 60, 6);
  }
  const m = std({ map: toTex(c), roughness: kind === 'bottle' ? 0.2 : 0.55 });
  labelCache.set(key, m);
  return m;
}
const PALETTE = ['#f2c230', '#f6d64a', '#fbfaf5', '#2f5fa8', '#7fb24a', '#4d8a3a', '#e46a6a', '#f08a3c', '#c9d8b6', '#f3b6c3', '#9bc9e8', '#3c6e3a', '#e8dcc0'];
const TYPES = {
  carton: () => ({ w: 0.075, h: range(0.15, 0.21), d: 0.07, shape: 'box', kind: 'label' }),
  bottle: () => ({ w: 0.06, h: range(0.18, 0.24), d: 0.06, shape: 'bottle', kind: 'bottle' }),
  can: () => ({ w: 0.066, h: 0.125, d: 0.066, shape: 'cyl', kind: 'label' }),
  bag: () => ({ w: 0.11, h: range(0.15, 0.2), d: 0.06, shape: 'box', kind: 'dark' }),
  pouch: () => ({ w: 0.1, h: 0.13, d: 0.045, shape: 'box', kind: 'label' }),
  jar: () => ({ w: 0.07, h: 0.09, d: 0.07, shape: 'cyl', kind: 'label' }),
};
function product(t, color, x, y, z, parent = scene) {
  const mat = labelMat(color, t.kind);
  let m;
  if (t.shape === 'box') {
    m = new THREE.Mesh(new THREE.BoxGeometry(t.d, t.h, t.w), mat);
    m.position.set(x, y + t.h / 2, z);
  } else if (t.shape === 'cyl') {
    m = new THREE.Mesh(new THREE.CylinderGeometry(t.w / 2, t.w / 2, t.h, 18), mat);
    m.position.set(x, y + t.h / 2, z);
    m.rotation.y = Math.PI / 2;
  } else {
    const pts = [[0, 0], [0.03, 0], [0.03, t.h * 0.62], [0.012, t.h * 0.82], [0.012, t.h], [0, t.h]].map(([a, b]) => new THREE.Vector2(a, b));
    m = new THREE.Mesh(new THREE.LatheGeometry(pts, 18), mat);
    m.position.set(x, y, z);
    m.rotation.y = Math.PI / 2;
  }
  parent.add(m);
  return m;
}
// Fill a shelf running along z on the left wall (items face +x).
function fillShelfZ(zStart, zEnd, y, xFront, maxH) {
  let z = zStart - 0.03;
  while (z - 0.08 > zEnd) {
    const type = pick(Object.keys(TYPES));
    const color = pick(PALETTE);
    const n = 3 + Math.floor(rand() * 5);
    const proto = TYPES[type]();
    if (proto.h > maxH - 0.02) continue;
    for (let k = 0; k < n && z - proto.w > zEnd; k++) {
      product(proto, color, xFront - proto.d / 2 - 0.04, y, z - proto.w / 2);
      z -= proto.w + 0.008;
    }
    z -= 0.035;
  }
}
// Shelf boards + LED strips inside a recessed niche on the left wall.
function stockNiche(r, shelfYs) {
  const z0 = -r.u0, z1 = -r.u1;
  shelfYs.forEach((y, i) => {
    bx(CAB - 0.47, CAB - 0.005, y - 0.022, y, z1, z0, shelfMat);
    const top = shelfYs[i + 1] ?? r.v1;
    bx(CAB - 0.06, CAB - 0.03, top - 0.03, top - 0.022, z1 + 0.03, z0 - 0.03, ledMat);
    fillShelfZ(z0, z1, y, CAB, top - y - 0.03);
  });
  const l = new THREE.PointLight('#ffcf94', 1.4, 2.6, 2);
  l.position.set(CAB - 0.12, (r.v0 + r.v1) / 2, (z0 + z1) / 2);
  scene.add(l);
}
stockNiche(NICHE_A, [0.64, 1.0, 1.36, 1.72, 2.08]);
stockNiche(NICHE_B, [1.14, 1.52]);

// ---------- signage ----------
function textPlane(draw, cw, ch, w, h, emissive = 0) {
  const [c, g] = makeCanvas(cw, ch);
  draw(g, cw, ch);
  const t = toTex(c);
  const m = std({ map: t, transparent: true, alphaTest: 0.02, roughness: 0.6, emissive: emissive ? '#ffffff' : '#000000', emissiveMap: emissive ? t : null, emissiveIntensity: emissive });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
}
{
  const drawSign = (col) => (g, w, h) => {
    g.font = '800 200px Inter, "DejaVu Sans", sans-serif';
    g.letterSpacing = '36px';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = col; g.fillText('MAÇA', w / 2, h / 2 - 10);
  };
  const sign = textPlane(drawSign('#f4ead6'), 1024, 300, 1.45, 0.42, 0.55);
  sign.position.set(CAB + 0.035, 2.62, -5.5); sign.rotation.y = Math.PI / 2; scene.add(sign);
  for (let i = 1; i <= 3; i++) {
    const back = textPlane(drawSign('#c9bfae'), 1024, 300, 1.45, 0.42);
    back.position.set(CAB + 0.035 - i * 0.008, 2.62, -5.5); back.rotation.y = Math.PI / 2; scene.add(back);
  }
  const items = [
    ['Matcha latte', '3.20'], ['Iced matcha', '3.50'], ['Hojicha latte', '3.20'],
    ['Strawberry matcha', '3.90'], ['Coconut cloud', '3.80'], ['Ceremonial', '4.50'],
    ['Espresso', '1.80'], ['Flat white', '2.80'], ['Yuzu tonic', '3.40'],
  ];
  const menu = textPlane((g, w, h) => {
    g.font = 'italic 46px "DejaVu Serif", Georgia, serif';
    g.fillStyle = '#efe6d4'; g.strokeStyle = '#efe6d4'; g.lineWidth = 2;
    for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) {
      const [n, p] = items[col * 3 + row];
      const x = 60 + col * 1000, y = 70 + row * 95;
      g.textAlign = 'left'; g.fillText(n, x, y);
      g.textAlign = 'right'; g.fillText(p, x + 760, y);
      g.beginPath(); g.moveTo(x, y + 14); g.lineTo(x + 420, y + 14); g.stroke();
    }
  }, 3000, 330, 3.3, 0.36, 0.25);
  menu.position.set(CAB + 0.012, 2.17, -5.65); menu.rotation.y = Math.PI / 2; scene.add(menu);
}

// ---------- posters on the right wall ----------
function poster(draw, z) {
  const frame = bx(RW - 0.03, RW, 1.42, 2.3, z - 0.32, z + 0.32, std({ color: '#111', roughness: 0.4 }));
  frame.castShadow = true;
  const p = textPlane(draw, 600, 840, 0.6, 0.84);
  p.material.transparent = false;
  p.position.set(RW - 0.031, 1.86, z); p.rotation.y = -Math.PI / 2; scene.add(p);
}
const drawGlass = (g, x, y, w, h, fill) => {
  g.save();
  g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y); g.lineTo(x + w * 0.9, y + h); g.lineTo(x + w * 0.1, y + h); g.closePath();
  g.clip();
  const gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, '#b9d98a'); gr.addColorStop(1, fill);
  g.fillStyle = gr; g.fillRect(x, y + h * 0.12, w, h);
  g.fillStyle = 'rgba(255,255,255,0.45)';
  for (let i = 0; i < 6; i++) g.fillRect(x + 20 + (i % 3) * w * 0.28, y + 30 + Math.floor(i / 3) * 70, w * 0.22, 55);
  g.restore();
  g.strokeStyle = 'rgba(80,90,80,0.6)'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(x, y); g.lineTo(x + w * 0.1, y + h); g.lineTo(x + w * 0.9, y + h); g.lineTo(x + w, y); g.stroke();
};
poster((g, w, h) => {
  g.fillStyle = '#f3f0e8'; g.fillRect(0, 0, w, h);
  drawGlass(g, 150, 380, 300, 400, '#4f7d2e');
  g.fillStyle = '#2f4a25'; g.font = 'italic 64px "DejaVu Serif", serif'; g.fillText('A cup of', 70, 150);
  g.font = 'italic 130px "DejaVu Serif", serif'; g.fillText('Matcha', 60, 290);
  g.beginPath(); g.arc(500, 80, 60, 0, Math.PI * 2); g.fillStyle = '#2f5a2b'; g.fill();
  g.fillStyle = '#fff'; g.font = 'bold 36px Inter, sans-serif'; g.textAlign = 'center'; g.fillText('NEW', 500, 93);
}, -3.6);
poster((g, w, h) => {
  g.fillStyle = '#eef0e6'; g.fillRect(0, 0, w, h);
  drawGlass(g, 80, 120, 260, 340, '#6b9a3c');
  g.fillStyle = '#2f5fa8'; g.beginPath(); g.ellipse(390, 640, 150, 110, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#9dc36d'; g.beginPath(); g.ellipse(390, 560, 140, 40, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#2f4a25'; g.font = 'bold 54px Inter, sans-serif'; g.fillText('blue', 380, 180); g.fillText('matcha', 360, 240);
}, -4.75);
poster((g, w, h) => {
  g.fillStyle = '#f4f1e9'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#2f4a25'; g.font = 'bold 50px Inter, sans-serif'; g.textAlign = 'center'; g.fillText('MATCHA MENU', w / 2, 90);
  for (let i = 0; i < 6; i++) {
    const x = 110 + (i % 3) * 190, y = 180 + Math.floor(i / 3) * 300;
    drawGlass(g, x - 55, y, 110, 170, ['#4f7d2e', '#6b9a3c', '#86b04f'][i % 3]);
    g.fillStyle = '#2f4a25'; g.font = '26px Inter, sans-serif'; g.fillText(['Classic', 'Iced', 'Oat', 'Berry', 'Yuzu', 'Cloud'][i], x, y + 220);
    g.fillRect(x - 40, y + 240, 80, 3);
  }
}, -5.9);

// ---------- counter ----------
{
  const X0 = -0.15, X1 = 0.5, ZB = -7.2, ZF = -2.75, TOP = 0.98;
  const CASE = { z0: -5.4, z1: -3.8, y0: 0.25, y1: 0.9 };
  bx(X0, X1, 0, TOP, ZB, CASE.z0, bronze);
  bx(X0, X1, 0, TOP, CASE.z1, ZF, bronze);
  bx(X0, X1, 0, CASE.y0, CASE.z0, CASE.z1, bronze);
  bx(X0, X1, CASE.y1, TOP, CASE.z0, CASE.z1, bronze);
  bx(X0, 0.0, CASE.y0, CASE.y1, CASE.z0, CASE.z1, bronze);
  // pastry case
  bx(0.0, X1 - 0.002, CASE.y0, CASE.y1, CASE.z0, CASE.z1, std({ color: '#3a2f27', roughness: 0.6, side: THREE.BackSide }));
  const cg = new THREE.Mesh(new THREE.PlaneGeometry(CASE.z1 - CASE.z0, CASE.y1 - CASE.y0), glass);
  cg.position.set(X1, (CASE.y0 + CASE.y1) / 2, (CASE.z0 + CASE.z1) / 2); cg.rotation.y = Math.PI / 2; scene.add(cg);
  bx(0.4, 0.45, CASE.y1 - 0.02, CASE.y1 - 0.01, CASE.z0, CASE.z1, ledMat);
  const pastel = ['#f4b6c2', '#c9e3a8', '#f7e0a3', '#d9c2ef', '#f6c79c', '#b9dcf0', '#8b5a3c'];
  const macGeo = new THREE.CylinderGeometry(0.024, 0.024, 0.022, 20);
  for (const sy of [CASE.y0 + 0.005, 0.56]) {
    if (sy > CASE.y0 + 0.1) bx(0.02, X1 - 0.02, sy - 0.012, sy, CASE.z0, CASE.z1, std({ color: '#cfc9c0', roughness: 0.3, metalness: 0.4 }));
    for (let z = CASE.z0 + 0.06; z < CASE.z1 - 0.04; z += 0.055)
      for (let row = 0; row < 3; row++) {
        const m = new THREE.Mesh(macGeo, std({ color: pastel[(Math.floor(-z * 18) + row) % pastel.length], roughness: 0.65 }));
        m.position.set(0.18 + row * 0.08, sy + 0.012, z); m.rotation.z = 0.25; scene.add(m);
      }
  }
  const cl = new THREE.PointLight('#ffd7a8', 0.9, 1.6, 2);
  cl.position.set(0.3, 0.75, (CASE.z0 + CASE.z1) / 2); scene.add(cl);

  // worktop + LED under-glow
  bx(X0 - 0.05, X1 + 0.07, TOP, TOP + 0.04, ZB - 0.05, -2.28, darkTop);
  bx(X1 + 0.04, X1 + 0.05, TOP - 0.012, TOP - 0.002, ZB, -2.32, ledMat);
  bx(X0 - 0.02, X1 + 0.04, TOP - 0.012, TOP - 0.002, -2.33, -2.32, ledMat);

  // rough stone block at the front of the counter
  const SW = 0.82, SH = 0.955, SD = 0.46;
  const geo = new THREE.BoxGeometry(SW, SH, SD, 40, 44, 24);
  const p = geo.attributes.position;
  const v = new THREE.Vector3(), nrm = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    nrm.set(Math.abs(v.x) > SW / 2 - 1e-4 ? Math.sign(v.x) : 0, 0, Math.abs(v.z) > SD / 2 - 1e-4 ? Math.sign(v.z) : 0);
    if (nrm.lengthSq() === 0) continue;
    nrm.normalize();
    // sharp vertical crags like split sandstone
    const along = v.x * 9 - v.z * 9;
    const ridges = 1 - Math.abs(fbm(along, v.y * 1.3, 1.7, 4));
    const pits = fbm(v.x * 30, v.y * 30, v.z * 30, 3);
    const d = 0.01 + ridges * ridges * 0.09 + pits * 0.01;
    p.setXYZ(i, v.x + nrm.x * d, v.y, v.z + nrm.z * d);
  }
  geo.computeVertexNormals();
  const stone = new THREE.Mesh(geo, std({ map: toTex(stoneCanvas()), roughness: 0.95 }));
  stone.position.set((X0 + X1) / 2 + 0.04, SH / 2, -2.53);
  scene.add(stone);

  // countertop props
  const y = TOP + 0.04;
  bx(0.05, 0.33, y, y + 0.06, -3.15, -2.92, whitePlastic);
  const screen = new THREE.Group();
  bx(-0.14, 0.14, -0.1, 0.1, -0.01, 0.01, whitePlastic, screen);
  const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.17), std({ color: '#fff', emissive: '#e8eef5', emissiveIntensity: 0.25, roughness: 0.2 }));
  disp.position.z = 0.0105; screen.add(disp);
  screen.position.set(0.19, y + 0.2, -3.0); screen.rotation.set(-0.35, 0.9, 0, 'YXZ'); scene.add(screen);
  cyl(0.012, 0.012, 0.22, blackMetal, 0.32, y, -3.42);
  bx(0.29, 0.35, y + 0.22, y + 0.33, -3.45, -3.39, blackMetal);
  const cupMat = std({ color: '#c9d9b0', roughness: 0.6 });
  cyl(0.045, 0.035, 0.13, cupMat, 0.33, y, -2.55);
  cyl(0.045, 0.035, 0.13, cupMat, 0.2, y, -2.42);
  cyl(0.045, 0.04, 0.012, std({ color: '#e8efe0' }), 0.33, y + 0.13, -2.55);
  cyl(0.035, 0.035, 0.09, std({ color: '#8a5a3a', roughness: 0.7 }), 0.0, y, -3.7);
  for (let i = 0; i < 9; i++) cyl(0.003, 0.003, 0.18, std({ color: '#d8b98f' }), range(-0.02, 0.02), y + 0.02, -3.7 + range(-0.02, 0.02), 4);
  const brownCup = std({ color: '#a86431', roughness: 0.6 });
  cyl(0.05, 0.042, 0.38, brownCup, 0.3, y, -6.85);
  cyl(0.05, 0.042, 0.3, brownCup, 0.3, y, -6.68);
}

// back counter + espresso machine (staff side)
{
  bx(-1.2, -0.72, 0, 0.9, -8.98, -3.6, std({ color: '#2b241f', roughness: 0.6 }));
  bx(-1.2, -0.7, 0.9, 0.93, -8.98, -3.6, darkTop);
  bx(-1.15, -0.75, 0.93, 1.38, -8.4, -7.75, std({ color: '#141414', roughness: 0.35, metalness: 0.5 }));
  for (const z of [-8.25, -7.9]) {
    const gh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.1, 16), std({ color: '#cfcfcf', metalness: 1, roughness: 0.2 }));
    gh.rotation.z = Math.PI / 2; gh.position.set(-0.7, 1.12, z); scene.add(gh);
  }
  for (let i = 0; i < 4; i++) cyl(0.04, 0.035, 0.08, std({ color: '#efe9df' }), -0.95 + (i % 2) * 0.1, 1.38, -8.25 + Math.floor(i / 2) * 0.25);
  cyl(0.05, 0.042, 0.42, std({ color: '#a86431', roughness: 0.6 }), -0.9, 0.93, -7.5);
}

// ---------- front corner: green metal shelf + stools ----------
{
  const X0 = -1.66, X1 = -1.22, Z0 = -0.66, Z1 = -0.12;
  for (const x of [X0, X1]) for (const z of [Z0, Z1]) bx(x - 0.012, x + 0.012, 0, H, z - 0.012, z + 0.012, greenMetal);
  const levels = [0.45, 0.9, 1.35, 1.8, 2.25];
  levels.forEach((y, i) => {
    bx(X0, X1, y - 0.012, y, Z0, Z1, greenMetal);
    const z0 = Z1 - 0.04;
    if (i === 0) {
      for (let k = 0; k < 2; k++) {
        const bag = bx(-1.5, -1.47, 0.08, 0.42, z0 - 0.08 - k * 0.24, z0 - 0.3 - k * 0.24, std({ color: k ? '#7da55a' : '#5f8f45', roughness: 0.9 }));
        bag.rotation.y = 0.15;
      }
    } else if (i % 2) {
      for (let k = 0; k < 3; k++) product({ w: 0.12, h: 0.19, d: 0.07, shape: 'box', kind: 'dark' }, k === 2 ? '#e3c9b2' : '#3f7a3a', -1.42, y, z0 - 0.08 - k * 0.15);
    } else {
      for (let k = 0; k < 5; k++) product({ w: 0.07, h: 0.08, d: 0.07, shape: 'cyl', kind: 'plain' }, '#cfdcc2', -1.4 + (k % 2) * 0.1, y, z0 - 0.05 - k * 0.09);
    }
  });
  const endGrain = (() => {
    const [c, g] = makeCanvas(256, 256);
    g.fillStyle = '#9b8b78'; g.fillRect(0, 0, 256, 256);
    for (let r = 4; r < 180; r += 5 + rand() * 6) { g.strokeStyle = `rgba(60,45,35,${0.2 + rand() * 0.3})`; g.lineWidth = 1 + rand() * 2; g.beginPath(); g.arc(128 + range(-6, 6), 128 + range(-6, 6), r, 0, 7); g.stroke(); }
    g.strokeStyle = 'rgba(40,30,20,0.6)'; g.lineWidth = 3; g.beginPath(); g.moveTo(128, 128); g.lineTo(240, 60); g.stroke();
    return toTex(c);
  })();
  const sideWood = std({ map: toTex(woodCanvas('#8f8273', { groove: false, contrast: 1.4 }), 1 / 0.4, 1 / 0.5), roughness: 0.9 });
  const top = std({ map: endGrain, roughness: 0.9 });
  for (const [x, z, r] of [[-0.85, -0.5, 0.2], [-0.25, -0.95, -0.3]]) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.45, 0.38), [sideWood, sideWood, top, sideWood, sideWood, sideWood]);
    st.position.set(x, 0.225, z); st.rotation.y = r; scene.add(st);
  }
}

// ---------- seating room beyond the arch ----------
// x from 1.95 (back of the arched wall) to 5.6, same depth as the shop, glazed to the terrace.
{
  const X0 = RW + 0.25, X1 = 5.6, RD = 9;
  const plane = (w, h, mat) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.geometry.attributes.uv.array.forEach((_, i, a) => { a[i] *= i % 2 ? h : w; });
    scene.add(m);
    return m;
  };
  const f = plane(X1 - X0, RD, floorMat); f.rotation.x = -Math.PI / 2; f.position.set((X0 + X1) / 2, 0, -RD / 2);
  const c = plane(X1 - X0, RD, ceilingMat); c.rotation.x = Math.PI / 2; c.position.set((X0 + X1) / 2, H, -RD / 2);
  const b = plane(X1 - X0, H, plaster); b.position.set((X0 + X1) / 2, H / 2, -RD);
  bx(X1, X1 + 0.25, 0, H, -RD, 0, plaster);
  // walnut wainscot on the room side of the arched wall
  bx(X0, X0 + 0.025, 0, 1.1, -RD, -ARCH.u1, walnut);
  bx(X0, X0 + 0.025, 0, 1.1, -ARCH.u0, -0.03, walnut);
  cassette(3.8, -4.2);

  // glazing to the terrace with matcha lettering
  for (const x of [X0 + 0.02, 3.15, 4.35, X1 - 0.02]) bx(x - 0.025, x + 0.025, 0, H, -0.03, 0.03, mullionMat);
  bx(X0, X1, 0, 0.05, -0.03, 0.03, mullionMat);
  bx(X0, X1, 2.55, 2.6, -0.03, 0.03, mullionMat);
  for (const [a, bb, y0, y1] of [[X0, X1, 0.05, 2.55], [X0, X1, 2.6, H]]) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(bb - a, y1 - y0), glass);
    g.position.set((a + bb) / 2, (y0 + y1) / 2, 0); scene.add(g);
  }
  const deco = textPlane((g) => {
    g.font = 'italic 64px "DejaVu Serif", serif'; g.fillStyle = '#9cc48a';
    ['1. matcha', '2. oxygen', '3. water'].forEach((t, i) => g.fillText(t, 20, 80 + i * 90));
  }, 512, 320, 0.95, 0.6);
  deco.position.set(4.9, 2.2, -0.012); deco.rotation.y = Math.PI; scene.add(deco);
  const cool = textPlane((g) => {
    g.font = '700 150px Inter, sans-serif'; g.strokeStyle = '#9cc48a'; g.lineWidth = 5; g.strokeText('COOL', 10, 150);
    g.font = '36px Inter, sans-serif'; g.fillStyle = '#9cc48a'; g.fillText('people', 420, 90); g.fillText('drink matcha', 420, 135);
  }, 700, 180, 1.1, 0.28);
  cool.position.set(2.75, 1.2, -0.012); cool.rotation.y = Math.PI; scene.add(cool);

  // floating bench + planter along the far wall, pebble strip below
  const bench = std({ map: plaster.map, color: '#f6f1ea', roughness: 0.85 });
  bx(5.25, X1, 0, 0.4, -8.6, -0.8, bench);
  bx(4.95, X1, 0.4, 0.47, -8.6, -0.8, bench);
  bx(5.22, X1, 0.95, 1.35, -8.6, -0.8, bench);
  const pebbleGeo = new THREE.IcosahedronGeometry(0.025, 1); pebbleGeo.scale(1, 0.55, 0.8);
  const pebbles = new THREE.InstancedMesh(pebbleGeo, std({ color: '#ffffff', roughness: 0.8 }), 1800);
  const o = new THREE.Object3D(), col = new THREE.Color();
  for (let i = 0; i < 1800; i++) {
    o.position.set(range(4.82, 5.25), 0.008, range(-8.55, -0.85));
    o.rotation.set(0, range(0, 6.28), 0); o.scale.setScalar(range(0.6, 1.4)); o.updateMatrix();
    pebbles.setMatrixAt(i, o.matrix);
    pebbles.setColorAt(i, col.setHSL(range(0.07, 0.1), range(0.08, 0.2), range(0.6, 0.8)));
  }
  scene.add(pebbles);
  const cushion = std({ color: '#6f8a4a', roughness: 0.95 });
  for (const z of [-1.6, -4.0, -6.4]) bx(5.0, 5.48, 0.47, 0.52, z - 0.3, z + 0.3, cushion);

  // trailing grasses in the planter
  const blade = new THREE.PlaneGeometry(0.014, 0.2); blade.translate(0, 0.1, 0);
  const N = 7000;
  const grass = new THREE.InstancedMesh(blade, std({ color: '#ffffff', roughness: 0.75, side: THREE.DoubleSide }), N);
  for (let i = 0; i < N; i++) {
    const droop = rand() < 0.3;
    o.position.set(droop ? range(5.18, 5.3) : range(5.25, 5.58), droop ? 1.33 : 1.34, range(-8.55, -0.85));
    o.rotation.set(droop ? range(2.0, 2.8) : range(-0.6, 0.6), range(0, 6.28), droop ? range(-0.3, 0.3) : range(-0.6, 0.6), 'YXZ');
    if (droop) { o.rotation.order = 'XYZ'; o.rotation.set(0, 0, range(1.9, 2.7)); }
    o.scale.set(1, droop ? range(0.8, 1.6) : range(0.5, 1.3), 1); o.updateMatrix();
    grass.setMatrixAt(i, o.matrix);
    grass.setColorAt(i, col.setHSL(range(0.2, 0.28), range(0.3, 0.5), range(0.14, 0.28)));
  }
  scene.add(grass);

  // twisted pine in a rounded-triangle planter, centred in front of the glass
  {
    const PX = 3.75, PZ = -0.95;
    const rounded = (target, pts, r) => {
      pts.forEach((p, i) => {
        const prev = pts[(i + pts.length - 1) % pts.length], next = pts[(i + 1) % pts.length];
        const p1 = p.clone().addScaledVector(prev.clone().sub(p).normalize(), r);
        const p2 = p.clone().addScaledVector(next.clone().sub(p).normalize(), r);
        i ? target.lineTo(p1.x, p1.y) : target.moveTo(p1.x, p1.y);
        target.quadraticCurveTo(p.x, p.y, p2.x, p2.y);
      });
      target.closePath();
      return target;
    };
    const tri = [[0, 0.5], [-0.55, -0.32], [0.55, -0.32]].map(([x, y]) => new THREE.Vector2(x, y));
    const shape = rounded(new THREE.Shape(), tri, 0.18);
    shape.holes.push(rounded(new THREE.Path(), tri.map((v) => v.clone().multiplyScalar(0.84)), 0.13));
    const pg = new THREE.ExtrudeGeometry(shape, { depth: 0.36, bevelEnabled: false });
    const planterBox = new THREE.Mesh(pg, std({ color: '#cfc8bd', roughness: 0.85 }));
    planterBox.rotation.x = -Math.PI / 2; planterBox.position.set(PX, 0, PZ); scene.add(planterBox);
    const fillShape = rounded(new THREE.Shape(), tri.map((v) => v.clone().multiplyScalar(0.84)), 0.13);
    const fill = new THREE.Mesh(new THREE.ShapeGeometry(fillShape), std({ color: '#5d5a56', roughness: 1 }));
    fill.rotation.x = -Math.PI / 2; fill.position.set(PX, 0.28, PZ); scene.add(fill);
    const rockGeo = new THREE.IcosahedronGeometry(0.035, 0);
    const rocks = new THREE.InstancedMesh(rockGeo, std({ color: '#ffffff', roughness: 0.9, flatShading: true }), 420);
    const inTri = (x, y) => {
      const [A, B, C] = tri.map((v) => v.clone().multiplyScalar(0.8));
      const s1 = (B.x - A.x) * (y - A.y) - (B.y - A.y) * (x - A.x);
      const s2 = (C.x - B.x) * (y - B.y) - (C.y - B.y) * (x - B.x);
      const s3 = (A.x - C.x) * (y - C.y) - (A.y - C.y) * (x - C.x);
      return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
    };
    for (let i = 0; i < 420;) {
      const x = range(-0.5, 0.5), y = range(-0.3, 0.45);
      if (!inTri(x, y)) continue;
      o.position.set(PX + x, 0.3, PZ - y);
      o.rotation.set(range(0, 6), range(0, 6), range(0, 6)); o.scale.set(range(0.7, 1.4), range(0.5, 0.9), range(0.7, 1.4)); o.updateMatrix();
      rocks.setMatrixAt(i, o.matrix); rocks.setColorAt(i++, col.setHSL(0.08, 0.03, range(0.25, 0.55)));
    }
    scene.add(rocks);

    const bark = std({ color: '#8a735a', roughness: 0.95 });
    const trunkTop = new THREE.Vector3();
    for (let k = 0; k < 3; k++) {
      const pts = [];
      for (let i = 0; i <= 24; i++) {
        const t = i / 24, ang = k * 2.094 + t * 8, r = 0.05 * (1 - t * 0.45);
        pts.push(new THREE.Vector3(PX + Math.sin(t * 2.4) * 0.2 + Math.cos(ang) * r, 0.28 + t * 1.3, PZ + Math.sin(t * 4.2) * 0.06 + Math.sin(ang) * r));
      }
      scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 0.034 - k * 0.003, 8), bark));
      if (k === 0) trunkTop.copy(pts[pts.length - 1]);
    }
    // cloud-pruned foliage pads on short branches
    const pads = [];
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4 + range(-0.3, 0.3), h = range(1.2, 1.95);
      const d = 0.25 + (1.95 - h) * 0.45 + range(-0.05, 0.1);
      pads.push(new THREE.Vector3(PX + 0.12 + Math.cos(a) * d, h, PZ + Math.sin(a) * d * 0.8));
    }
    pads.push(new THREE.Vector3(PX + 0.2, 2.1, PZ));
    for (const c of pads) {
      const from = new THREE.Vector3(PX + 0.15, Math.min(c.y - 0.1, trunkTop.y), PZ);
      const mid = from.clone().lerp(c, 0.5).add(new THREE.Vector3(0, 0.06, 0));
      scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([from, mid, c]), 12, 0.014, 6), bark));
    }
    const tuftGeo = new THREE.IcosahedronGeometry(0.06, 0);
    const PER = 70;
    const tufts = new THREE.InstancedMesh(tuftGeo, std({ color: '#ffffff', roughness: 0.85, flatShading: true }), pads.length * PER);
    let ti = 0;
    for (const c of pads) {
      const rad = range(0.22, 0.34);
      for (let j = 0; j < PER; j++) {
        const a = range(0, 6.28), rr = Math.sqrt(rand()) * rad;
        o.position.set(c.x + Math.cos(a) * rr, c.y + range(-0.04, 0.09) * (1 - rr / rad + 0.3), c.z + Math.sin(a) * rr);
        o.rotation.set(range(0, 6), range(0, 6), range(0, 6)); o.scale.set(range(0.8, 1.5), range(0.5, 0.9), range(0.8, 1.5)); o.updateMatrix();
        tufts.setMatrixAt(ti, o.matrix);
        tufts.setColorAt(ti++, col.setHSL(range(0.24, 0.3), range(0.3, 0.45), range(0.17, 0.3)));
      }
    }
    scene.add(tufts);
  }

  // glass-fronted cup wall between the window and the arch
  {
    const CX0 = X0, CX1 = X0 + 0.28, CY0 = 0, CY1 = 2.75, CZ0 = -ARCH.u0 + 0.2, CZ1 = -0.35;
    const frame = std({ color: '#56704a', roughness: 0.5 });
    bx(CX0, CX1, CY0, CY0 + 0.05, CZ0, CZ1, frame);
    bx(CX0, CX1, CY1 - 0.05, CY1, CZ0, CZ1, frame);
    bx(CX0, CX1, CY0, CY1, CZ0, CZ0 + 0.04, frame);
    bx(CX0, CX1, CY0, CY1, CZ1 - 0.04, CZ1, frame);
    bx(CX0, CX0 + 0.03, CY0, CY1, CZ0, CZ1, std({ color: '#2d3f27', roughness: 0.7 }));
    const g = new THREE.Mesh(new THREE.PlaneGeometry(CZ1 - CZ0, CY1 - CY0), glass);
    g.position.set(CX1, (CY0 + CY1) / 2, (CZ0 + CZ1) / 2); g.rotation.y = Math.PI / 2; scene.add(g);
    const cupGeo = new THREE.CylinderGeometry(0.044, 0.033, 0.13, 16);
    const N = 380;
    const cups = new THREE.InstancedMesh(cupGeo, std({ color: '#ffffff', roughness: 0.45 }), N);
    const cupCols = ['#2f6b35', '#3f8a3c', '#1f4d27', '#d9d6c8', '#c98a5a', '#8fb85a', '#e9e6dc'];
    for (let i = 0; i < N; i++) {
      o.position.set(range(CX0 + 0.08, CX1 - 0.06), range(CY0 + 0.1, CY1 - 0.12), range(CZ0 + 0.09, CZ1 - 0.09));
      o.rotation.set(range(-1.4, 1.4), range(0, 6.28), range(-1.4, 1.4)); o.scale.setScalar(1); o.updateMatrix();
      cups.setMatrixAt(i, o.matrix); cups.setColorAt(i, col.set(pick(cupCols)));
    }
    scene.add(cups);
  }

  // leaf line drawing on the back wall
  const leaf = textPlane((g) => {
    g.strokeStyle = 'rgba(110,104,96,0.7)'; g.lineWidth = 5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(150, 950); g.bezierCurveTo(250, 600, 500, 250, 900, 80); g.stroke();
    g.beginPath(); g.moveTo(900, 80); g.bezierCurveTo(650, 120, 350, 380, 260, 720); g.stroke();
    g.beginPath(); g.moveTo(900, 80); g.bezierCurveTo(950, 380, 700, 700, 330, 820); g.stroke();
    g.beginPath(); g.moveTo(230, 850); g.bezierCurveTo(330, 820, 470, 560, 560, 480); g.stroke();
  }, 1024, 1024, 2.0, 2.0);
  leaf.position.set(3.9, 1.6, -RD + 0.01); scene.add(leaf);

  // magazine rack on the wainscot wall
  for (const y of [1.45, 1.8]) {
    bx(X0, X0 + 0.12, y, y + 0.012, -7.9, -7.2, blackMetal);
    bx(X0 + 0.1, X0 + 0.12, y, y + 0.06, -7.9, -7.2, blackMetal);
    for (let k = 0; k < 3; k++) {
      const m = bx(X0 + 0.05, X0 + 0.058, y + 0.012, y + 0.28, -7.85 + k * 0.22, -7.65 + k * 0.22, labelMat(pick(['#e8dcc0', '#2b2b2b', '#c9d8b6', '#f3f0e8']), 'label'));
      m.rotation.z = 0.18;
    }
  }

  // tables, chairs and globe pendants
  const woodChair = std({ map: oakTex, color: '#e0c4a0', roughness: 0.55 });
  const velvet = std({ color: '#6b7d3e', roughness: 0.95 });
  const tableWood = std({ map: oakTex, color: '#ead2b0', roughness: 0.45 });
  const potMat = std({ color: '#151515', roughness: 0.6 });
  const shrub = std({ color: '#5a7a35', roughness: 0.85, flatShading: true });
  const backGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.17, 24, 1, true, -0.85, 1.7);
  const chair = (x, z, ry) => {
    const gp = new THREE.Group();
    for (const [a, bb] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.42, 14), woodChair);
      leg.position.set(a, 0.21, bb); gp.add(leg);
    }
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.235, 0.07, 32), velvet);
    seat.position.y = 0.46; gp.add(seat);
    for (const a of [-0.17, 0.17]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.35, 10), woodChair);
      post.position.set(a, 0.62, 0.17); gp.add(post);
    }
    const back = new THREE.Mesh(backGeo, new THREE.MeshStandardMaterial({ map: oakTex, color: '#e0c4a0', roughness: 0.55, side: THREE.DoubleSide }));
    back.position.set(0, 0.74, -0.05); gp.add(back);
    gp.position.set(x, 0, z); gp.rotation.y = ry; scene.add(gp);
  };
  const table = (x, z) => {
    cyl(0.32, 0.32, 0.03, tableWood, x, 0.72, z, 40);
    cyl(0.022, 0.022, 0.72, potMat, x, 0, z, 10);
    cyl(0.22, 0.22, 0.015, potMat, x, 0, z, 32);
    cyl(0.055, 0.045, 0.08, potMat, x + 0.05, 0.75, z - 0.05, 16);
    const sh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 1), shrub);
    sh.position.set(x + 0.05, 0.86, z - 0.05); sh.scale.y = 1.2; scene.add(sh);
  };
  // chair backs face away from the table: back sits on +z of the chair, so ry turns it outward
  for (const z of [-2.3, -3.5, -4.7, -5.9, -7.1]) { table(4.5, z); chair(3.9, z, -Math.PI / 2); }
  for (const z of [-3.6, -5.2, -6.8]) { table(2.75, z); chair(2.75, z + 0.6, 0); chair(2.75, z - 0.6, Math.PI); }
  const glow = std({ color: '#fff4e2', emissive: '#ffdcae', emissiveIntensity: 1.6, roughness: 0.3 });
  const cord = std({ color: '#222', roughness: 0.5 });
  for (const [x, z, y, r] of [[4.4, -2.3, 1.85, 0.13], [4.4, -4.7, 1.9, 0.15], [4.4, -7.1, 1.75, 0.12], [2.75, -3.6, 1.95, 0.13], [2.6, -6.8, 1.85, 0.15]]) {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 20), glow);
    ball.position.set(x, y, z); scene.add(ball);
    cyl(0.004, 0.004, H - y - r, cord, x, y + r, z, 6);
  }
  for (const [x, z] of [[4.2, -2.4], [3.4, -6.2]]) {
    const l = new THREE.PointLight('#ffd8a8', 1.6, 6, 1.8);
    l.position.set(x, 1.9, z); scene.add(l);
  }
}

// ---------- glass facade ----------
{
  const T = 0.05;
  for (const x of [-1.7, -0.2, 0.35, 1.35, 1.7]) bx(x - T / 2, x + T / 2, 0, H, -0.03, 0.03, mullionMat);
  bx(-1.7, 1.7, 2.55, 2.6, -0.03, 0.03, mullionMat);
  bx(-1.7, 0.35, 0, 0.05, -0.03, 0.03, mullionMat);
  bx(1.35, 1.7, 0, 0.05, -0.03, 0.03, mullionMat);
  const pane = (x0, x1, y0, y1) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), glass);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0); scene.add(m);
  };
  pane(-1.7, -0.2, 0.05, 2.55); pane(-0.2, 0.35, 0.05, 2.55); pane(1.35, 1.7, 0.05, 2.55); pane(-1.7, 1.7, 2.6, H);
  // open door leaf, hinged at x = 1.35 and swung out onto the terrace
  const door = new THREE.Group();
  bx(0, 0.04, 0, 2.5, 0, 0.95, mullionMat, door);
  bx(0, 0.04, 0, 0.08, 0, 0.95, mullionMat, door);
  bx(0, 0.04, 2.44, 2.5, 0, 0.95, mullionMat, door);
  bx(0, 0.04, 0, 2.5, 0.91, 0.95, mullionMat, door);
  const dg = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 2.4), glass);
  dg.position.set(0.02, 1.25, 0.475); dg.rotation.y = Math.PI / 2; door.add(dg);
  bx(-0.03, 0.07, 0.8, 1.6, 0.82, 0.84, std({ color: '#c8c8c8', metalness: 1, roughness: 0.25 }), door);
  door.position.set(1.33, 0, 0.02); door.rotation.y = -0.12; scene.add(door);
}

// ---------- building exterior + terrace ----------
{
  bx(-7, -1.7, 0, H + 0.7, -0.35, 0, facadeMat);
  bx(5.85, 9, 0, H + 0.7, -0.35, 0, facadeMat);
  bx(-7, 9, H, H + 0.7, -0.35, 0, facadeMat);
  bx(-7, 9, H + 0.7, H + 0.85, -0.35, 1.0, std({ color: '#d9d4cc', roughness: 0.8 }));
  const sign = textPlane((g, w, h) => {
    g.font = '800 160px Inter, sans-serif'; g.letterSpacing = '30px';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#3b2a1c'; g.fillText('MAÇA', w / 2, h / 2);
  }, 1024, 240, 1.3, 0.3);
  sign.position.set(0, H + 0.36, 0.005); scene.add(sign);

  const deck = std({ map: toTex(tileCanvas('#a8a29a', '#8c867e', 4), 1 / 2.4, 1 / 2.4), roughness: 0.75 });
  bx(-7, 9, -0.06, 0, 0, 7.5, deck);
  // planters + glass balustrade
  const planter = std({ color: '#5b5a55', roughness: 0.8 });
  bx(-7, 9, 0, 0.55, 6.7, 7.3, planter);
  bx(-7, -6.4, 0, 0.55, 0.4, 6.7, planter);
  bx(8.4, 9, 0, 0.55, 0.4, 6.7, planter);
  const bal = new THREE.Mesh(new THREE.PlaneGeometry(16, 1.1), glass);
  bal.position.set(1, 0.55, 7.45); scene.add(bal);

  // bamboo-ish plants (instanced leaves)
  const leafGeo = new THREE.PlaneGeometry(0.04, 0.26); leafGeo.translate(0, 0.13, 0);
  const stemGeo = new THREE.CylinderGeometry(0.007, 0.01, 1, 5); stemGeo.translate(0, 0.5, 0);
  const clumps = [];
  for (let x = -6.8; x < 8.8; x += 0.32) clumps.push([x + range(-0.08, 0.08), 7.0 + range(-0.15, 0.15)]);
  for (let z = 0.8; z < 6.6; z += 0.4) { clumps.push([-6.7, z]); clumps.push([8.7, z]); }
  const LEAVES = 26, STEMS = 3;
  const leaves = new THREE.InstancedMesh(leafGeo, std({ color: '#ffffff', roughness: 0.7, side: THREE.DoubleSide }), clumps.length * LEAVES);
  const stems = new THREE.InstancedMesh(stemGeo, std({ color: '#7d8a4c', roughness: 0.6 }), clumps.length * STEMS);
  const o = new THREE.Object3D(), col = new THREE.Color();
  let li = 0, si = 0;
  for (const [cx, cz] of clumps) {
    const hgt = range(1.1, 1.9);
    for (let s = 0; s < STEMS; s++) {
      o.position.set(cx + range(-0.06, 0.06), 0.55, cz + range(-0.06, 0.06));
      o.rotation.set(range(-0.12, 0.12), 0, range(-0.12, 0.12)); o.scale.set(1, hgt * range(0.75, 1), 1);
      o.updateMatrix(); stems.setMatrixAt(si++, o.matrix);
    }
    for (let l = 0; l < LEAVES; l++) {
      o.position.set(cx + range(-0.12, 0.12), 0.55 + hgt * range(0.35, 1), cz + range(-0.12, 0.12));
      o.rotation.set(range(-1.1, 1.1), range(0, 6.28), range(-1.1, 1.1)); o.scale.setScalar(range(0.7, 1.3));
      o.updateMatrix(); leaves.setMatrixAt(li, o.matrix);
      leaves.setColorAt(li++, col.setHSL(range(0.22, 0.29), range(0.35, 0.55), range(0.22, 0.38)));
    }
  }
  scene.add(leaves, stems);

  // bistro sets
  const chair = (x, z, ry) => {
    const gp = new THREE.Group();
    bx(-0.21, 0.21, 0.44, 0.47, -0.2, 0.2, greenMetal, gp);
    for (const [a, b] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]]) bx(a - 0.012, a + 0.012, 0, 0.45, b - 0.012, b + 0.012, greenMetal, gp);
    for (const a of [-0.19, -0.06, 0.06, 0.19]) bx(a - 0.01, a + 0.01, 0.45, 0.85, 0.17, 0.19, greenMetal, gp);
    bx(-0.21, 0.21, 0.8, 0.86, 0.165, 0.195, greenMetal, gp);
    gp.position.set(x, 0, z); gp.rotation.y = ry; scene.add(gp);
  };
  const table = (x, z) => {
    cyl(0.36, 0.36, 0.025, greenMetal, x, 0.73, z, 32);
    cyl(0.025, 0.025, 0.73, greenMetal, x, 0, z, 12);
    cyl(0.25, 0.25, 0.02, greenMetal, x, 0, z, 24);
  };
  const umbrella = (x, z) => {
    const fabric = std({ color: '#f4f2ec', roughness: 0.9, side: THREE.DoubleSide });
    const can = new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.5, 8, 1, true), fabric);
    can.position.set(x, 2.55, z); scene.add(can);
    const [c, g] = makeCanvas(2048, 128);
    g.fillStyle = '#f4f2ec'; g.fillRect(0, 0, 2048, 128);
    g.fillStyle = '#2b2b2b'; g.font = '700 70px Inter, sans-serif'; g.letterSpacing = '10px'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i < 8; i++) g.fillText('MAÇA', 128 + i * 256, 66);
    const val = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.2, 8, 1, true), std({ map: toTex(c), roughness: 0.9 }));
    val.position.set(x, 2.2, z); scene.add(val);
    cyl(0.03, 0.03, 2.75, std({ color: '#3a3a3a', metalness: 0.6, roughness: 0.4 }), x, 0, z, 12);
    bx(x - 0.3, x + 0.3, 0, 0.08, z - 0.3, z + 0.3, std({ color: '#3a3a3a', roughness: 0.6 }));
  };
  umbrella(-2.8, 3.4); umbrella(4.8, 3.8);
  for (const [tx, tz] of [[-2.0, 3.8], [3.8, 4.1], [-4.4, 2.4], [5.8, 2.2]]) {
    table(tx, tz);
    chair(tx + 0.55, tz, -Math.PI / 2);
    chair(tx - 0.55, tz, Math.PI / 2);
  }
}

// ---------- city backdrop ----------
{
  const [c, g] = makeCanvas(4096, 1024);
  const sky = g.createLinearGradient(0, 0, 0, 1024);
  sky.addColorStop(0, '#b9cbd6'); sky.addColorStop(0.45, '#e6e3dc'); sky.addColorStop(0.6, '#f3e6d6'); sky.addColorStop(1, '#d6d3cc');
  g.fillStyle = sky; g.fillRect(0, 0, 4096, 1024);
  const layers = [['#c9ccce', 0.5, 0.25], ['#b4b9bd', 0.54, 0.2], ['#9fa6ab', 0.58, 0.16]];
  for (const [col, top, spread] of layers) {
    for (let x = 0; x < 4096;) {
      const w = 18 + rand() * 70, h = (top + range(-spread * 0.5, spread * 0.6) * (rand() < 0.1 ? 1.6 : 1)) * 1024;
      g.fillStyle = col; g.fillRect(x, h, w, 1024 - h);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      for (let wy = h + 8; wy < 1000; wy += 12) g.fillRect(x + 3, wy, w - 6, 3);
      x += w + rand() * 6;
    }
  }
  const haze = g.createLinearGradient(0, 520, 0, 1024);
  haze.addColorStop(0, 'rgba(240,232,220,0)'); haze.addColorStop(1, 'rgba(235,228,218,0.85)');
  g.fillStyle = haze; g.fillRect(0, 0, 4096, 1024);
  const t = toTex(c);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(80, 80, 100, 64, 1, true), new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, toneMapped: true, fog: false }));
  m.position.y = 18; scene.add(m);
  scene.background = new THREE.Color('#b9cbd6');
}

// ---------- lighting ----------
const sun = new THREE.DirectionalLight('#ffd6a6', 6);
sun.position.set(4.5, 3.9, 10.5);
sun.target.position.set(-0.4, 0, -2.2);
scene.add(sun, sun.target);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 40 });
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.02;
scene.add(new THREE.HemisphereLight('#e6eef2', '#b39d82', 0.32));
for (const [x, z] of [[0.6, -1.8], [0.9, -4.6], [0.9, -7.4], [-0.6, -5.5]]) {
  const l = new THREE.PointLight('#ffcf99', 1.5, 6, 1.8);
  l.position.set(x, H - 0.2, z);
  scene.add(l);
}

scene.traverse((o) => {
  if (!o.isMesh) return;
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  const see = mats.some((m) => m.transparent || m.side === THREE.BackSide || m.isMeshBasicMaterial || m === ledMat || m === downlightGlow);
  o.castShadow = !see;
  o.receiveShadow = !mats.some((m) => m.isMeshBasicMaterial);
});

// ---------- post-processing ----------
const rt = new THREE.WebGLRenderTarget(VW * PR, VH * PR, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.setPixelRatio(PR);
composer.setSize(VW, VH);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(VW, VH), 0.3, 0.5, 1.6));
composer.addPass(new OutputPass());

// ---------- camera walkthrough ----------
// [time s, position, yaw deg (0 = looking into the shop, 90 = facing the left wall), pitch deg]
const KEYS = [
  [0, [2.2, 1.6, 6.4], 14, 1],
  [4, [1.5, 1.6, 3.3], 12, -2],
  [7.5, [0.85, 1.6, 0.45], 16, -3],
  [10.5, [0.95, 1.58, -1.15], 72, -7],
  [13.5, [1.1, 1.6, -2.2], 22, 0],
  [17, [1.15, 1.6, -4.4], 58, 4],
  [20.5, [1.2, 1.6, -7.3], 102, -3],
  [24, [1.25, 1.6, -8.25], 176, -3],
  [27.5, [1.0, 1.6, -3.3], 205, -3],
  [30.5, [0.45, 1.6, -2.2], 270, -2],
  [33.5, [2.6, 1.6, -2.3], 262, -1],
  [37, [3.3, 1.6, -3.4], 160, 0],
  [41, [3.5, 1.55, -6.2], 182, 1],
  [45, [3.6, 1.45, -8.2], 180, 1],
];
const DURATION = 46.5;
const posCurve = new THREE.CatmullRomCurve3(KEYS.map((k) => new THREE.Vector3(...k[1])), false, 'centripetal');
const angCurve = new THREE.CatmullRomCurve3(KEYS.map((k) => new THREE.Vector3(k[2], k[3], 0)), false, 'catmullrom', 0.5);
function tourAt(t) {
  const last = KEYS.length - 1;
  let i = 0;
  while (i < last - 1 && t > KEYS[i + 1][0]) i++;
  const s = THREE.MathUtils.clamp((t - KEYS[i][0]) / (KEYS[i + 1][0] - KEYS[i][0]), 0, 1);
  // ease in/out only at the very start and end of the tour
  const e = i === 0 ? s * s * (3 - 2 * s) * 0.5 + s * 0.5 : i === last - 1 ? 1 - (1 - s) * (1 - s) : s;
  const u = (i + e) / last;
  camera.position.copy(posCurve.getPoint(u));
  const a = angCurve.getPoint(u);
  camera.rotation.set(THREE.MathUtils.degToRad(a.y), THREE.MathUtils.degToRad(a.x), 0);
}

let shadowsBaked = false;
function draw() {
  composer.render();
  if (!shadowsBaked) { renderer.shadowMap.autoUpdate = false; shadowsBaked = true; }
}

window.renderAt = (t) => {
  tourAt(t);
  draw();
  return renderer.domElement.toDataURL('image/jpeg', 0.93);
};
window.TOUR_DURATION = DURATION;

if (!RECORD) {
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enabled = false;
  controls.enableDamping = true;
  let free = false;
  const btn = document.getElementById('mode'), hint = document.getElementById('hint');
  btn.onclick = () => {
    free = !free;
    controls.enabled = free;
    if (free) {
      camera.position.set(1.0, 1.6, -0.6);
      controls.target.set(-0.2, 1.3, -4.0);
      controls.update();
    }
    btn.textContent = free ? 'Play walkthrough' : 'Explore freely';
    hint.textContent = free ? 'Drag to orbit, scroll to zoom, right-drag to pan' : 'Playing walkthrough';
    start = performance.now();
  };
  let start = performance.now();
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
  });
  renderer.setAnimationLoop(() => {
    if (free) controls.update();
    else tourAt(((performance.now() - start) / 1000) % DURATION);
    draw();
  });
}
window.sceneReady = true;
