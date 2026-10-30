export interface ViewerMesh {
  name: string;
  positions: Float32Array;
  normals?: Float32Array | undefined;
  indices?: Uint32Array | undefined;
  /** Per-triangle 1-based index into `features` (0 = unlabeled), from the forge kernel. */
  featureIds?: Uint16Array | undefined;
  features?: string[] | undefined;
}

/** A picked point on the model and the feature its triangle belongs to. */
export interface ViewerHit {
  mesh: string;
  feature: string | null;
  point: [number, number, number];
}

export interface ModelViewerProps {
  /** Meshes in millimetres, Z up (forge worker output). */
  meshes?: ViewerMesh[] | undefined;
  /** Or a file to load (STL or GLB). */
  url?: string;
  format?: 'stl' | 'glb';
  /** Show a spinner over the last good model. */
  busy?: boolean | undefined;
  /** Highlight downward faces steeper than this many degrees from vertical (print overlay). */
  overhangDeg?: number | null;
  className?: string;
  label?: string;
  onError?: (message: string) => void;
  /** Region selection: click a face or drag a circle; orbiting pauses while on. */
  selectMode?: boolean;
  onSelect?: (hits: ViewerHit[]) => void;
  /** Tint the triangles of this feature. */
  highlightFeature?: string | null;
}
