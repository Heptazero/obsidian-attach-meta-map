import { runInBackground } from './background-task';

/** One timer and one active task; waiting keys hold no file contents or parsed PDFs. */
export class DeferredTaskQueue<Key> {
  private waiting = new Map<Key, number>();
  private timer: number | null = null;
  private active: { key: Key } | null = null;
  private stopped = false;

  constructor(private run: (key: Key) => Promise<unknown>, private context: string) {}

  enqueue(key: Key, delayMs = 0): void {
    if (this.stopped || (this.active && this.active.key === key) || this.waiting.has(key)) return;
    this.waiting.set(key, Date.now() + delayMs);
    this.schedule();
  }

  stop(): void {
    this.stopped = true;
    this.waiting.clear();
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    if (this.stopped || this.active || this.timer !== null) return;
    const next = this.waiting.entries().next();
    if (next.done) return;
    const [key, readyAt] = next.value;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.waiting.delete(key);
      this.active = { key };
      runInBackground(async () => {
        try {
          await this.run(key);
        } finally {
          this.active = null;
          this.schedule();
        }
      }, this.context);
    }, Math.max(0, readyAt - Date.now()));
  }
}
