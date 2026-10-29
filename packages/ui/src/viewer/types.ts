export interface ViewerMesh {
  name: string;
  positions: Float32Array;
  normals?: Float32Array | undefined;
  indices?: Uint32Array | undefined;
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
}
