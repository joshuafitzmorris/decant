import { WorkerPool } from '../../lib/worker-pool';
import type { ConvertedFile, ConvertRequest } from '../types';
import type { DataOutput, DataTask } from './data.worker';

const pool = new WorkerPool(
  () => new Worker(new URL('./data.worker.ts', import.meta.url), { type: 'module', name: 'decant-data' }),
  2,
);

export async function convert(request: ConvertRequest): Promise<ConvertedFile[]> {
  const task: DataTask = { file: request.file, from: request.from, to: request.to };
  return pool.run<DataOutput[]>(task, { signal: request.signal, onProgress: request.onProgress });
}
