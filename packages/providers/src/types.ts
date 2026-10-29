/** Generation provider contract (build prompt 4.1). */
export type TaskStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
export type OutputFormat = 'glb' | 'obj' | 'fbx' | 'usdz' | 'stl';

export interface Capabilities {
  textTo3D: boolean;
  imageTo3D: boolean;
  refine: boolean;
  retexture: boolean;
  remesh: boolean;
  webhooks: boolean;
  outputs: OutputFormat[];
}

export type ProviderInput =
  | { kind: 'preview'; modelCode: string; prompt: string; style?: string | undefined; topology?: 'triangle' | 'quad' | undefined; polycount?: number | undefined }
  | { kind: 'refine'; modelCode: string; previewTaskId: string; texturePrompt?: string | undefined }
  | { kind: 'image'; modelCode: string; imageUrls: string[]; removeBackground?: boolean | undefined }
  | { kind: 'retexture'; modelCode: string; sourceTaskId?: string | undefined; sourceModelUrl?: string | undefined; texturePrompt: string };

export interface NormalizedTask {
  id: string;
  status: TaskStatus;
  /** 0-100 */
  progress: number;
  outputs: Partial<Record<OutputFormat | 'thumbnail', string>>;
  error: { code: string; message: string } | null;
}

export interface ModelProvider {
  readonly key: string;
  capabilities(modelCode: string): Capabilities;
  createTask(input: ProviderInput, ctx: { idempotencyKey: string }): Promise<{ providerTaskId: string }>;
  getTask(providerTaskId: string): Promise<NormalizedTask>;
  cancelTask(providerTaskId: string): Promise<void>;
  parseWebhook(headers: Headers, rawBody: Buffer): { eventKey: string; task: NormalizedTask } | null;
  verifyWebhook(headers: Headers, rawBody: Buffer): boolean;
  /** Fetch an output file (providers' download URLs may need auth or expire). */
  download(url: string): Promise<Buffer>;
}

export class ProviderError extends Error {
  constructor(
    readonly code: 'PROVIDER_ERROR' | 'PROVIDER_CREATE_UNCERTAIN' | 'NOT_IMPLEMENTED' | 'PROVIDER_REJECTED',
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

const RANK: Record<TaskStatus, number> = { QUEUED: 0, RUNNING: 1, SUCCEEDED: 2, FAILED: 2, CANCELED: 2 };

/**
 * State only moves forward (build prompt 12): a late in-progress event never overwrites a
 * final state, and progress never decreases within the same state.
 */
export function isForward(current: { status: TaskStatus; progress: number }, next: { status: TaskStatus; progress: number }): boolean {
  if (RANK[current.status] === 2) return false;
  if (RANK[next.status] > RANK[current.status]) return true;
  return RANK[next.status] === RANK[current.status] && next.progress > current.progress;
}
