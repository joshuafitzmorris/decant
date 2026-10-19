import type { Engine } from '../engines/types';
import type { EngineId } from './routes';

/** Engines are code-split: nothing heavier than the app shell loads until a file needs it. */
const loaders: Record<EngineId, () => Promise<Engine>> = {
  image: () => import('../engines/image'),
  media: () => import('../engines/media'),
  pdf: () => import('../engines/pdf'),
  docs: () => import('../engines/docs'),
  data: () => import('../engines/data'),
};

const loaded = new Map<EngineId, Promise<Engine>>();

export function loadEngine(id: EngineId): Promise<Engine> {
  let engine = loaded.get(id);
  if (!engine) {
    engine = loaders[id]();
    engine.catch(() => loaded.delete(id));
    loaded.set(id, engine);
  }
  return engine;
}

/** How many jobs each engine runs at once. */
export const ENGINE_CONCURRENCY: Record<EngineId, number> = {
  image: Math.max(1, Math.min(4, (globalThis.navigator?.hardwareConcurrency || 4) - 1)),
  media: 1,
  pdf: 1,
  docs: 2,
  data: 2,
};
