import { abortError, ConversionError, type ProgressFn } from '../engines/types';

export type WorkerMessage =
  | { id: number; type: 'progress'; value: number | null; stage?: string }
  | { id: number; type: 'done'; result: unknown }
  | { id: number; type: 'error'; message: string; code?: string };

interface Task {
  id: number;
  payload: unknown;
  transfer: Transferable[];
  onProgress?: ProgressFn;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

let nextTaskId = 1;

/**
 * Runs tasks on a small set of module workers. Cancelling a running task
 * terminates its worker outright, which is the only reliable way to stop a
 * WebAssembly encoder mid-frame; a fresh worker takes its place.
 */
export class WorkerPool {
  private readonly live = new Set<Worker>();
  private readonly idle: Worker[] = [];
  private readonly idleTimers = new Map<Worker, ReturnType<typeof setTimeout>>();
  private readonly busy = new Map<Worker, Task>();
  private readonly queue: Task[] = [];

  /**
   * @param idleMs Workers left unused this long are terminated, releasing the
   *   memory their WebAssembly codecs grew to. A new one starts when needed.
   */
  constructor(
    private readonly spawnWorker: () => Worker,
    private readonly maxWorkers: number,
    private readonly idleMs = 60_000,
  ) {}

  run<T>(
    payload: unknown,
    options: { signal?: AbortSignal; onProgress?: ProgressFn; transfer?: Transferable[] } = {},
  ): Promise<T> {
    const { signal, onProgress, transfer = [] } = options;
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const task: Task = {
        id: nextTaskId++,
        payload,
        transfer,
        onProgress,
        resolve: resolve as (value: unknown) => void,
        reject,
      };
      signal?.addEventListener('abort', () => this.cancel(task), { once: true });
      this.queue.push(task);
      this.pump();
    });
  }

  private pump() {
    while (this.queue.length > 0) {
      const worker = this.idle.pop() ?? (this.live.size < this.maxWorkers ? this.spawn() : undefined);
      if (!worker) return;
      clearTimeout(this.idleTimers.get(worker));
      this.idleTimers.delete(worker);
      const task = this.queue.shift() as Task;
      this.busy.set(worker, task);
      worker.postMessage({ id: task.id, payload: task.payload }, task.transfer);
    }
  }

  private spawn(): Worker {
    const worker = this.spawnWorker();
    this.live.add(worker);
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => this.handleMessage(worker, event.data);
    worker.onerror = (event) => {
      event.preventDefault();
      this.retire(worker, new ConversionError(event.message || 'The converter stopped unexpectedly.', 'crash'));
    };
    return worker;
  }

  private handleMessage(worker: Worker, message: WorkerMessage) {
    const task = this.busy.get(worker);
    if (!task || task.id !== message.id) return;
    if (message.type === 'progress') {
      task.onProgress?.(message.value, message.stage);
      return;
    }
    this.busy.delete(worker);
    this.idle.push(worker);
    this.idleTimers.set(
      worker,
      setTimeout(() => this.retire(worker, null), this.idleMs),
    );
    if (message.type === 'done') task.resolve(message.result);
    else task.reject(new ConversionError(message.message, message.code ?? 'internal'));
    this.pump();
  }

  private cancel(task: Task) {
    const queued = this.queue.indexOf(task);
    if (queued >= 0) {
      this.queue.splice(queued, 1);
      task.reject(abortError());
      return;
    }
    for (const [worker, running] of this.busy) {
      if (running === task) {
        this.retire(worker, abortError());
        return;
      }
    }
  }

  /** Terminates a worker (crashed, cancelled or idle) and rejects its task, if it had one. Safe to call twice. */
  private retire(worker: Worker, reason: unknown) {
    if (!this.live.delete(worker)) return;
    const task = this.busy.get(worker);
    worker.terminate();
    this.busy.delete(worker);
    clearTimeout(this.idleTimers.get(worker));
    this.idleTimers.delete(worker);
    const idleIndex = this.idle.indexOf(worker);
    if (idleIndex >= 0) this.idle.splice(idleIndex, 1);
    task?.reject(reason);
    this.pump();
  }
}
