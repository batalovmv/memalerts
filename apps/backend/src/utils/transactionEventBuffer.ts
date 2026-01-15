type BufferedTask = () => void | Promise<void>;

export class TransactionEventBuffer {
  private readonly tasks: BufferedTask[] = [];
  private committed = false;
  private flushed = false;

  add(task: BufferedTask) {
    if (typeof task !== 'function') return;
    this.tasks.push(task);
  }

  commit() {
    this.committed = true;
  }

  async flush(): Promise<void> {
    if (!this.committed || this.flushed || this.tasks.length === 0) return;
    this.flushed = true;

    for (const task of this.tasks) {
      try {
        await task();
      } catch {
        // Best-effort: never throw from buffered side effects.
      }
    }
  }
}
