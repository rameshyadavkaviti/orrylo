export class EnrollmentLoop {
  private running = false;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly intervalMs: number,
    private readonly reconcile: () => Promise<void>,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  async tick(): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    try {
      await this.reconcile();
      return true;
    } finally {
      this.running = false;
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick().catch(this.onError); }, this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
