import { randomBytes, randomUUID } from 'node:crypto';
import { BufferJSON } from '@whiskeysockets/baileys';
import type { Config } from './config.js';
import { hasSelfPrefix, instructionText, taskPrompt, type Incoming } from './messages.js';
import { Store, type Task } from './store.js';
import type { T3 } from './t3.js';

export class Bridge {
  constructor(private config: Config, private store: Store, private t3: T3, private logError: (error: unknown) => void) {}
  accept(m: Incoming, botIds: string[], now = Date.now()): boolean {
    const route = this.config.routes.find(r => r.groupJid === m.group);
    if (!route || !m.id || this.store.isOutgoing(m.group, m.id)) return false;
    if (this.config.selfCommands) {
      // fromMe is authenticated by the linked-device protocol. A missing group
      // participant field on an own message must not prevent owner commands.
      if (!m.fromMe || !botIds.some(id => this.config.allowedSenderJids.includes(id))) return false;
    } else if (m.fromMe || ![m.sender,m.senderAlt].some(id => this.config.allowedSenderJids.includes(id))) return false;
    if (m.timestamp * 1000 > now + 30000 || now - m.timestamp * 1000 > this.config.maxMessageAgeSeconds * 1000) return false;
    const thread = this.store.findThread(m.group, m.quotedId, route.project);
    const mentioned = m.mentions.some(id => botIds.includes(id));
    if (this.config.selfCommands) {
      if (!hasSelfPrefix(m.text) && !(thread && this.store.isOutgoing(m.group, m.quotedId))) return false;
    } else if (!thread && !mentioned) return false;
    if (!instructionText(m.text, this.config.selfCommands)) return false;
    if (m.text.length + m.quotedText.length > 16000) return false;
    const id = randomUUID();
    let accepted = false;
    this.store.atomic(() => {
      accepted = this.store.add(id, m, route.project, thread);
      if (accepted && m.hasMedia) {
        const task = this.store.task(id)!;
        this.enqueue(task, 'This first version handles text only. Please describe the attachment in text and mention me again.');
        this.store.setState(id, 'unsupported');
      }
    });
    return accepted;
  }
  isRouted(task: Task): boolean {
    return this.config.routes.some(route => route.groupJid === task.group_jid && route.project === task.project);
  }
  enqueue(task: Task, text: string) {
    // Split code points, not UTF-16 halves, so emoji survive chunk boundaries.
    const characters = Array.from(text);
    const capped = characters.slice(0, 12000);
    if (characters.length > 12000) capped.push(...Array.from('\n[More in T3 Code]'));
    for (let i = 0; i < capped.length; i += 3000) {
      const prefix = this.config.selfCommands ? '[T3 Bot]\n' : '';
      this.store.outgoing('3EB0' + randomBytes(16).toString('hex').toUpperCase(), task, prefix + capped.slice(i, i + 3000).join(''));
    }
  }
  async submitQueued(shouldContinue = () => true, afterSubmit: () => Promise<void> = async () => {}) {
    const busyThreads = this.store.runningThreadIds();
    for (const task of this.store.tasks('queued')) {
      if (!shouldContinue()) break;
      if (!this.isRouted(task)) {
        this.store.setState(task.id, 'review');
        continue;
      }
      if (task.thread_id && busyThreads.has(task.thread_id)) continue;
      this.store.setState(task.id, 'submitting');
      try {
        const message = JSON.parse(task.payload, BufferJSON.reviver) as Incoming;
        const result = await this.t3.submit(task.project, taskPrompt(message, this.config.selfCommands), task.thread_id ?? undefined);
        const followUp = Boolean(task.thread_id);
        task.thread_id = result.threadId;
        this.store.atomic(() => {
          this.store.submitted(task, result.threadId, result.runId);
          this.enqueue(task, `${followUp ? 'Follow-up sent' : 'Task sent'} to T3 Code.\nThread: ${result.threadId}`);
        });
        busyThreads.add(result.threadId);
      } catch (error) {
        this.logError(error);
        this.store.atomic(() => {
          this.store.setState(task.id, 'review');
          this.enqueue(task, 'Could not confirm submission. Check T3 Code before retrying so the task is not started twice.');
        });
      }
      await afterSubmit();
    }
  }
  async collectResults(shouldContinue = () => true) {
    for (const task of this.store.tasks('running')) {
      if (!shouldContinue()) break;
      if (!this.isRouted(task)) {
        this.store.setState(task.id, 'review');
        continue;
      }
      try {
        const snapshot = await this.t3.show(task.thread_id!);
        const thread = snapshot.thread;
        if (thread.latestRunId !== task.run_id) {
          if (task.notice !== 'changed') {
            this.store.atomic(() => {
              this.enqueue(task, 'This thread advanced in T3 Code. Open T3 Code to review the result; I will not guess which reply belongs to this task.');
              this.store.notice(task.id, 'changed'); this.store.setState(task.id, 'review');
            });
          }
          continue;
        }
        if (thread.pendingRequestCount > 0 || thread.status === 'waiting') {
          if (task.notice !== 'waiting') {
            this.store.atomic(() => {
              this.enqueue(task, 'T3 Code needs your input or approval. Please answer in T3 Code; WhatsApp cannot approve permission prompts in this version.');
              this.store.notice(task.id, 'waiting');
            });
          }
          continue;
        }
        if (task.notice === 'waiting') this.store.notice(task.id, null);
        if (['idle','completed','failed','cancelled','interrupted','rolled_back'].includes(thread.status)) {
          const reply = snapshot.messages.findLast(m => m.role === 'assistant' && m.runId === task.run_id)?.text;
          const ok = thread.status === 'completed' || thread.status === 'idle';
          this.store.atomic(() => {
            this.enqueue(task, ok ? (reply || 'Task finished. Open T3 Code to review the result.') : `Task stopped (${thread.status}). Please review it in T3 Code.`);
            this.store.setState(task.id, ok ? 'completed' : 'stopped');
          });
        }
      } catch (error) { this.logError(error); }
    }
  }
}
