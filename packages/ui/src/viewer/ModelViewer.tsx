'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { ModelViewerProps, ViewerMesh } from './types';

/**
 * Shared 3D viewer for forges, generated models, and print previews (build prompt 11).
 * Z-up millimetres. Orbit / pan / zoom, F frames, R resets, arrow keys orbit, wireframe
 * toggle, bounding-box readout, and a 10 mm grid at true scale on the bed.
 */
export default function ModelViewer({ meshes, url, format, busy, overhangDeg = null, className, label = '3D model viewer', onError }: ModelViewerProps) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    content: THREE.Group;
    grid: THREE.Group;
    material: THREE.MeshStandardMaterial;
    raf: number;
    home: { pos: THREE.Vector3; target: THREE.Vector3 } | null;
  } | null>(null);
  const [bbox, setBbox] = useState<[number, number, number] | null>(null);
  const [wireframe, setWireframe] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Scene setup once.
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-hidden', 'true');
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 20000);
    camera.up.set(0, 0, 1);
    camera.position.set(120, -160, 110);
    const controls = new OrbitControls(camera, renderer.domElement);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    controls.enableDamping = !reduced;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(1, -1.5, 2.5);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(-1, 1, 0.5);
    scene.add(fill);
    const content = new THREE.Group();
    const grid = new THREE.Group();
    scene.add(grid, content);
    const css = getComputedStyle(el);
    const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(css.getPropertyValue('--sw-mesh').trim() || '#d9611c'), roughness: 0.55, metalness: 0.05, vertexColors: false });
    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      state.current!.raf = requestAnimationFrame(loop);
    };
    state.current = { renderer, scene, camera, controls, content, grid, material, raf: 0, home: null };
    loop();
    return () => {
      cancelAnimationFrame(state.current?.raf ?? 0);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      state.current = null;
    };
  }, []);

  const frame = useCallback((reset = false) => {
    const s = state.current;
    if (!s) return;
    const box = new THREE.Box3().setFromObject(s.content);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 5);
    const dist = radius / Math.sin((s.camera.fov * Math.PI) / 360);
    const dir = reset || !s.home ? new THREE.Vector3(0.6, -0.9, 0.6).normalize() : s.camera.position.clone().sub(s.controls.target).normalize();
    s.controls.target.copy(center);
    s.camera.position.copy(center.clone().add(dir.multiplyScalar(dist * 1.05)));
    s.camera.near = Math.max(0.1, dist / 100);
    s.camera.far = dist * 20;
    s.camera.updateProjectionMatrix();
    if (reset || !s.home) s.home = { pos: s.camera.position.clone(), target: s.controls.target.clone() };
  }, []);

  const setContent = useCallback(
    (geometries: THREE.BufferGeometry[]) => {
      const s = state.current;
      if (!s) return;
      const firstLoad = s.content.children.length === 0;
      for (const c of [...s.content.children]) {
        s.content.remove(c);
        (c as THREE.Mesh).geometry?.dispose();
      }
      for (const g of geometries) {
        if (!g.getAttribute('normal')) g.computeVertexNormals();
        if (overhangDeg !== null) paintOverhangs(g, overhangDeg);
        const m = s.material.clone();
        m.vertexColors = overhangDeg !== null;
        m.wireframe = wireframe;
        s.content.add(new THREE.Mesh(g, m));
      }
      const box = new THREE.Box3().setFromObject(s.content);
      if (!box.isEmpty()) {
        const size = box.getSize(new THREE.Vector3());
        setBbox([size.x, size.y, size.z]);
        rebuildGrid(s.grid, box, getComputedStyle(host.current!).getPropertyValue('--sw-grid').trim() || '#b8bcc4');
      }
      if (firstLoad) frame(true);
    },
    [frame, overhangDeg, wireframe],
  );

  // Meshes from the forge worker.
  useEffect(() => {
    if (!meshes) return;
    setContent(meshes.map(toGeometry));
  }, [meshes, setContent]);

  // Or load a URL.
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setLoadError(null);
    (async () => {
      try {
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`Could not load the model (${res.status})`);
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        const kind = format ?? (url.toLowerCase().includes('.glb') ? 'glb' : 'stl');
        if (kind === 'stl') {
          setContent([new STLLoader().parse(buf)]);
        } else {
          const gltf = await new GLTFLoader().parseAsync(buf, '');
          const geos: THREE.BufferGeometry[] = [];
          gltf.scene.updateMatrixWorld(true);
          gltf.scene.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (mesh.isMesh) {
              const g = mesh.geometry.clone();
              g.applyMatrix4(mesh.matrixWorld);
              // glTF is Y-up; our scene is Z-up.
              g.rotateX(Math.PI / 2);
              geos.push(g);
            }
          });
          setContent(geos);
        }
      } catch (e) {
        const msg = (e as Error).message;
        setLoadError(msg);
        onError?.(msg);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, format, setContent, onError]);

  useEffect(() => {
    const s = state.current;
    s?.content.children.forEach((c) => (((c as THREE.Mesh).material as THREE.MeshStandardMaterial).wireframe = wireframe));
  }, [wireframe]);

  const onKey = (e: React.KeyboardEvent) => {
    const s = state.current;
    if (!s) return;
    const k = e.key.toLowerCase();
    if (k === 'f') frame(false);
    else if (k === 'r') frame(true);
    else if (e.key.startsWith('Arrow')) {
      const offset = s.camera.position.clone().sub(s.controls.target);
      const sph = new THREE.Spherical().setFromVector3(new THREE.Vector3(offset.x, offset.z, -offset.y));
      const step = Math.PI / 24;
      if (e.key === 'ArrowLeft') sph.theta -= step;
      if (e.key === 'ArrowRight') sph.theta += step;
      if (e.key === 'ArrowUp') sph.phi = Math.max(0.05, sph.phi - step);
      if (e.key === 'ArrowDown') sph.phi = Math.min(Math.PI - 0.05, sph.phi + step);
      const v = new THREE.Vector3().setFromSpherical(sph);
      s.camera.position.copy(s.controls.target.clone().add(new THREE.Vector3(v.x, -v.z, v.y)));
    } else return;
    e.preventDefault();
  };

  return (
    <div className={`relative overflow-hidden rounded-lg bg-[var(--sw-viewer-bg)] ${className ?? ''}`}>
      <div
        ref={host}
        tabIndex={0}
        role="img"
        aria-label={`${label}. ${bbox ? `Bounding box ${bbox.map((n) => n.toFixed(1)).join(' by ')} millimetres.` : ''} Press F to frame, R to reset, arrow keys to orbit.`}
        onKeyDown={onKey}
        className="h-full w-full touch-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--sw-focus)]"
        data-testid="model-viewer"
      />
      <div className="pointer-events-none absolute left-2 top-2 rounded bg-[var(--sw-bg)]/80 px-2 py-1 font-mono text-xs tabular-nums text-[var(--sw-text)]" data-testid="bbox-readout">
        {bbox ? `${bbox.map((n) => n.toFixed(1)).join(' × ')} mm` : '—'}
      </div>
      <div className="absolute right-2 top-2 flex gap-1">
        <button type="button" onClick={() => setWireframe((w) => !w)} aria-pressed={wireframe} className="rounded border border-[var(--sw-border)] bg-[var(--sw-bg)] px-2 py-1 text-xs text-[var(--sw-text)]">
          Wireframe
        </button>
        <button type="button" onClick={() => frame(false)} className="rounded border border-[var(--sw-border)] bg-[var(--sw-bg)] px-2 py-1 text-xs text-[var(--sw-text)]" aria-label="Frame the model (F)">
          Frame
        </button>
      </div>
      {busy ? (
        <div className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-2 rounded bg-[var(--sw-bg)]/90 px-2 py-1 text-xs text-[var(--sw-text)]" role="status">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" /> Rebuilding…
        </div>
      ) : null}
      {loadError ? (
        <div role="alert" className="absolute inset-x-2 bottom-2 rounded bg-[var(--sw-bg)] px-2 py-1 text-xs text-[var(--sw-fail)]">
          {loadError}
        </div>
      ) : null}
    </div>
  );
}

function toGeometry(m: ViewerMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  if (m.normals && m.normals.length === m.positions.length) g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  if (m.indices) g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  return g;
}

/** Color faces that point down more steeply than `deg` from vertical (needs supports). */
function paintOverhangs(g: THREE.BufferGeometry, deg: number) {
  const geo = g.index ? g.toNonIndexed() : g;
  if (geo !== g) {
    g.copy(geo);
  }
  g.computeVertexNormals();
  const n = g.getAttribute('normal');
  const colors = new Float32Array(n.count * 3);
  const limit = -Math.cos(((90 - deg) * Math.PI) / 180); // nz below this is an overhang
  const base = new THREE.Color('#d9611c');
  const bad = new THREE.Color('#dc2626');
  const box = new THREE.Box3().setFromBufferAttribute(g.getAttribute('position') as THREE.BufferAttribute);
  const pos = g.getAttribute('position');
  for (let i = 0; i < n.count; i += 3) {
    const nz = (n.getZ(i) + n.getZ(i + 1) + n.getZ(i + 2)) / 3;
    const z = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const c = nz < limit && z > box.min.z + 0.5 ? bad : base;
    for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (i + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function rebuildGrid(grid: THREE.Group, box: THREE.Box3, color: string) {
  for (const c of [...grid.children]) grid.remove(c);
  const size = box.getSize(new THREE.Vector3());
  const extent = Math.max(50, Math.ceil((Math.max(size.x, size.y) * 1.6) / 10) * 10);
  const g = new THREE.GridHelper(extent, extent / 10, color, color);
  g.rotation.x = Math.PI / 2; // GridHelper lies in XZ; our bed is XY at z = 0
  const center = box.getCenter(new THREE.Vector3());
  g.position.set(Math.round(center.x / 10) * 10, Math.round(center.y / 10) * 10, 0);
  (g.material as THREE.Material).transparent = true;
  (g.material as THREE.Material).opacity = 0.6;
  grid.add(g);
}
