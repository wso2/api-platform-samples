import { InMemoryTaskStore, type TaskStore } from '@a2a-js/sdk/server';

/** How long a task survives before the store it lives in is discarded. */
export const TASK_RETENTION_MS = 60 * 60 * 1000;

/**
 * A task store that holds at most one interval's worth of tasks.
 *
 * Reads and writes go to an SDK store that is replaced wholesale each
 * interval, so memory is bounded by the traffic in that window. Delegating
 * keeps the SDK's own filtering and pagination rather than restating them.
 *
 * A task lives for up to one interval, not a guaranteed one, which suits an
 * agent whose tasks finish in seconds.
 */
export class ExpiringTaskStore implements TaskStore {
  private inner = new InMemoryTaskStore();

  constructor(intervalMs: number = TASK_RETENTION_MS) {
    const sweep = setInterval(() => {
      this.inner = new InMemoryTaskStore();
    }, intervalMs);
    // The sweep alone should not keep the process alive.
    sweep.unref();
  }

  save: TaskStore['save'] = (task, context) => this.inner.save(task, context);

  load: TaskStore['load'] = (taskId, context) => this.inner.load(taskId, context);

  list: TaskStore['list'] = (params, context) => this.inner.list(params, context);
}
