type Job = () => Promise<void>;

export class TaskQueue {
  private queue: Job[] = [];
  private running = false;

  // Returns a promise that resolves when the job completes (after waiting in queue).
  run(job: Job): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          await job();
          resolve();
        } catch (err) {
          reject(err);
        }
      });
      if (!this.running) {
        void this.drain();
      }
    });
  }

  get size(): number {
    return this.queue.length;
  }

  get busy(): boolean {
    return this.running;
  }

  private async drain(): Promise<void> {
    this.running = true;
    while (this.queue.length > 0) {
      await this.queue.shift()!();
    }
    this.running = false;
  }
}
