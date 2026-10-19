import type { ProgressFn } from '../engines/types';
import type { WorkerMessage } from './worker-pool';

interface WorkerScope {
  postMessage(message: WorkerMessage, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<{ id: number; payload: unknown }>) => void) | null;
}

export interface HandlerResult<T> {
  result: T;
  transfer?: Transferable[];
}

/** Wires a worker's message port to a single async handler. Pair with WorkerPool on the page side. */
export function serve<P, R>(handler: (payload: P, progress: ProgressFn) => Promise<HandlerResult<R>>) {
  const scope = globalThis as unknown as WorkerScope;
  scope.onmessage = async (event) => {
    const { id, payload } = event.data;
    const progress: ProgressFn = (value, stage) => scope.postMessage({ id, type: 'progress', value, stage });
    try {
      const { result, transfer = [] } = await handler(payload as P, progress);
      scope.postMessage({ id, type: 'done', result }, transfer);
    } catch (error) {
      const err = error as { message?: string; code?: unknown };
      scope.postMessage({
        id,
        type: 'error',
        message: err?.message || String(error),
        // Only our own errors carry string codes; DOMException's numeric code is meaningless here.
        code: typeof err?.code === 'string' ? err.code : undefined,
      });
    }
  };
}
