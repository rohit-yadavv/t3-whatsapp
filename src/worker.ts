import { BufferJSON } from '@whiskeysockets/baileys';
import type { Bridge } from './bridge.js';
import type { Outgoing, Store } from './store.js';

/** One guarded work cycle, shared by incoming commands and the result timer. */
export class Worker {
  running = false;
  constructor(
    private bridge: Bridge,
    private store: Store,
    private canWork: () => boolean,
    private send: (outgoing: Outgoing, quote: unknown) => Promise<unknown>,
    private logError: (error: unknown) => void,
  ) {}

  async tick() {
    if (this.running || !this.canWork()) return;
    this.running = true;
    try {
      await this.flush();
      await this.bridge.collectResults(this.canWork);
      await this.flush();
      if (this.canWork()) await this.bridge.submitQueued(this.canWork, () => this.flush());
    } catch (error) {
      this.logError(error);
    } finally {
      this.running = false;
    }
  }

  private async flush() {
    if (!this.canWork()) return;
    for (const outgoing of this.store.pending()) {
      if (!this.canWork()) break;
      const task = this.store.task(outgoing.task_id);
      if (!task || !this.bridge.isRouted(task)) {
        this.store.sentState(outgoing.id, 'review');
        continue;
      }
      this.store.sentState(outgoing.id, 'sending');
      try {
        const content = await this.send(outgoing, JSON.parse(outgoing.quote, BufferJSON.reviver));
        this.store.atomic(() => {
          this.store.remember(outgoing.id, content);
          this.store.sentState(outgoing.id, 'sent');
        });
      } catch (error) {
        // The send may have succeeded. Do not blindly duplicate it on a retry.
        this.store.sentState(outgoing.id, 'review');
        this.logError(error);
      }
    }
  }
}
