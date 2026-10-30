/** Client for the internal mesh service (apps/mesh). */
export type MeshFormat = 'stl' | 'obj' | '3mf' | 'glb';

export interface MeshAnalysis {
  triangles: number;
  vertices: number;
  bbox_mm: [number, number, number];
  volume_mm3: number;
  surface_area_mm2: number;
  watertight: boolean;
  manifold: boolean;
  winding_consistent: boolean;
  flipped_normals: boolean;
  degenerate_faces: number;
  boundary_edges: number;
  nonmanifold_edges: number;
  components: number | null;
  overhang_area_mm2: number;
  units_guess: 'mm' | 'm' | 'inch';
  fits_build_volume: boolean;
  printable: boolean;
  scale_pct: number;
  notes: string[];
}

export interface MeshReport {
  before?: MeshAnalysis;
  after: MeshAnalysis;
  actions: string[];
}

export interface SliceCheck {
  layer_mm: number;
  layers: number;
  empty_layers: number[];
  empty_count: number;
  open_layers: number[];
  open_count: number;
  self_intersecting_layers: number[];
  self_intersecting_count: number;
  exhaustive: boolean;
  ok: boolean;
}

export class MeshServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'MeshServiceError';
  }
}

export class MeshClient {
  constructor(private readonly o: { url: string; token: string; fetchImpl?: typeof fetch; timeoutMs?: number }) {}

  private async call(path: string, body?: Buffer): Promise<Response> {
    const res = await (this.o.fetchImpl ?? fetch)(`${this.o.url}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${this.o.token}`, ...(body ? { 'content-type': 'application/octet-stream' } : {}) },
      ...(body ? { body: new Uint8Array(body) } : {}),
      signal: AbortSignal.timeout(this.o.timeoutMs ?? 120_000),
    });
    if (!res.ok) {
      let code = 'MESH_SERVICE_ERROR';
      let message = `mesh service returned ${res.status}`;
      try {
        const j = (await res.json()) as { error?: { code: string; message: string }; detail?: string };
        if (j.error) ({ code, message } = j.error);
        else if (j.detail) message = String(j.detail);
      } catch {
        /* not json */
      }
      throw new MeshServiceError(code, message, res.status);
    }
    return res;
  }

  async analyze(file: Buffer, format: MeshFormat, opts: { buildVolume?: [number, number, number]; scalePct?: number; maxBytes?: number } = {}): Promise<MeshAnalysis> {
    const q = new URLSearchParams({ format, build_volume: (opts.buildVolume ?? [256, 256, 256]).join('x'), scale_pct: String(opts.scalePct ?? 100) });
    if (opts.maxBytes) q.set('max_bytes', String(opts.maxBytes));
    return (await (await this.call(`/analyze?${q}`, file)).json()) as MeshAnalysis;
  }

  private async withReport(path: string, file: Buffer): Promise<{ file: Buffer; report: MeshReport }> {
    const res = await this.call(path, file);
    const header = res.headers.get('x-mesh-report');
    const report = header ? (JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as MeshReport) : ({ after: null, actions: [] } as unknown as MeshReport);
    return { file: Buffer.from(await res.arrayBuffer()), report };
  }

  repair(file: Buffer, format: MeshFormat, to: MeshFormat = 'stl') {
    return this.withReport(`/repair?format=${format}&to=${to}`, file);
  }

  remesh(file: Buffer, format: MeshFormat, targetFaces: number, to: MeshFormat = 'glb') {
    return this.withReport(`/remesh?format=${format}&target_faces=${targetFaces}&to=${to}`, file);
  }

  /** Layer sanity: empty layers, open contours, and self-crossing contours (not a slicer). */
  async sliceCheck(file: Buffer, format: MeshFormat, layerMm = 0.2): Promise<SliceCheck> {
    return (await this.call(`/slice-check?format=${format}&layer_mm=${layerMm}`, file)).json() as Promise<SliceCheck>;
  }

  async convert(file: Buffer, format: MeshFormat, to: MeshFormat): Promise<Buffer> {
    return Buffer.from(await (await this.call(`/convert?format=${format}&to=${to}`, file)).arrayBuffer());
  }

  async health(): Promise<boolean> {
    try {
      const r = await (this.o.fetchImpl ?? fetch)(`${this.o.url}/health`, { signal: AbortSignal.timeout(3000) });
      return r.ok;
    } catch {
      return false;
    }
  }
}
