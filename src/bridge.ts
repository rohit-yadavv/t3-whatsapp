import { randomBytes, randomUUID } from 'node:crypto';
import { BufferJSON } from '@whiskeysockets/baileys';
import {isSupportedChat, projectCatalog, type Config} from './config.js';
import {parseProjectCommand, type ProjectContext} from './projects.js';
import { hasSelfPrefix, instructionText, taskPrompt, type Incoming } from './messages.js';
import { Store, type Task } from './store.js';
import type { T3 } from './t3.js';

// Versioned payloads prevent old routing requests from being replayed under new semantics.
type TaskMessage = Incoming & {bridgeVersion:2; projectContext?:ProjectContext; continueTaskId?:string};

export class Bridge {
  private projects: Map<string,string>;
  constructor(private config: Config, private store: Store, private t3: T3, private logError: (error: unknown) => void) {
    this.projects=projectCatalog(config);
  }
  private chatAllowed(chat: string): boolean {
    return isSupportedChat(chat) && (this.config.accountWide || this.config.routes.some(route=>route.chatJid===chat));
  }
  private mappedProject(chat: string): string | undefined {
    const saved=this.store.chatProject(chat);
    return saved===undefined ? this.config.routes.find(route=>route.chatJid===chat)?.project : saved || undefined;
  }
  private record(message: Incoming, state: string, reply?: string, effect?:()=>void): boolean {
    let accepted=false;
    this.store.atomic(()=>{
      const id=randomUUID();
      const payload:TaskMessage={...message,bridgeVersion:2};
      accepted=this.store.add(id,payload,'',undefined,state);
      if (!accepted) return;
      effect?.();
      if (reply) this.enqueue(this.store.task(id)!,reply);
    });
    return accepted;
  }
  private conversationTask(task: Task | undefined): task is Task {
    return Boolean(task && task.project===this.config.noProject && (JSON.parse(task.payload,BufferJSON.reviver) as Partial<TaskMessage>).bridgeVersion===2);
  }
  accept(m: Incoming, botIds: string[], now = Date.now()): boolean {
    if (!this.chatAllowed(m.group) || !m.id) return false;
    if (this.config.selfCommands) {
      if (!m.fromMe || !botIds.some(id=>this.config.allowedSenderJids.includes(id))) return false;
    } else if (m.fromMe || ![m.sender,m.senderAlt].some(id=>this.config.allowedSenderJids.includes(id))) return false;
    if (this.store.isOutgoing(m.group,m.id)) return false;
    if (!Number.isFinite(m.timestamp) || m.timestamp*1000>now+30000 || now-m.timestamp*1000>this.config.maxMessageAgeSeconds*1000) return false;
    if (m.text.length+m.quotedText.length>16000) return false;
    const response=this.store.isOutgoing(m.group,m.quotedId) ? this.store.requestForMessage(m.group,m.quotedId) : undefined;
    const reference=this.conversationTask(response) ? response : undefined;
    const prefix=this.config.selfCommands ? hasSelfPrefix(m.text) : m.mentions.some(id=>botIds.includes(id));
    if (!prefix && !reference) return false;
    const instruction=instructionText(m.text,this.config.selfCommands);
    if (!instruction) return false;
    // Media cannot silently become a mapping/reset or lose its quoted attachment.
    if (m.hasMedia) return this.record(m,'unsupported','This version handles text only. Please describe the attachment in text and send @bot again.');
    const command=parseProjectCommand(instruction,this.projects);
    if (command.kind==='projects') {
      return this.record(m,'control',`Configured project hints: ${[...this.projects.keys()].map(name=>'#'+name).join(', ') || '(none)'}. You can also ask T3 about projects and threads by name.`);
    }
    if (command.kind==='map') {
      const project=this.projects.get(command.alias);
      if (!project) return this.record(m,'control','Unknown configured alias. Use @bot projects to list project hints, or name the project in your message.');
      return this.record(m,'control',`This chat now provides #${command.alias} as default project context. Its No project conversation stays the same.`,()=>this.store.mapChat(m.group,project));
    }
    if (command.kind==='unmap') return this.record(m,'control','Chat project hint cleared. Its conversation stays the same.',()=>this.store.unmapChat(m.group));
    if (/^new$/i.test(command.instruction)) return this.record(m,'control','Conversation reset. Your next @bot message starts a fresh No project thread. The chat mapping is unchanged.',()=>this.store.clearContext(m.group));

    const context=this.store.context(m.group);
    const active=context?.task_id ? this.store.task(context.task_id) : undefined;
    const parent=reference ?? (this.conversationTask(active) ? active : undefined);
    const mapping=this.mappedProject(m.group);
    const projectContext:ProjectContext | undefined=command.projects.length
      ? {source:'message',projects:command.projects}
      : mapping ? {source:'mapping',projects:[{name:[...this.projects].find(([,target])=>target===mapping)?.[0],target:mapping}]} : undefined;
    const payload:TaskMessage={...m,text:command.instruction,bridgeVersion:2,projectContext,continueTaskId:parent?.id};
    let accepted=false;
    this.store.atomic(()=>{
      const id=randomUUID();
      accepted=this.store.add(id,payload,this.config.noProject,parent?.thread_id ?? undefined);
      if (accepted) this.store.focusChat(m.group,this.config.noProject,parent?.thread_id ?? undefined,id);
    });
    return accepted;
  }
  isRouted(task: Task): boolean {
    if (!this.chatAllowed(task.group_jid)) return false;
    if (!task.project) return task.state==='control' || task.state==='unsupported';
    return this.conversationTask(task);
  }
  enqueue(task: Task, text: string) {
    const characters = Array.from(text);
    const capped = characters.slice(0, 12000);
    if (characters.length > 12000) capped.push(...Array.from('\n[More in T3 Code]'));
    for (let i = 0; i < capped.length; i += 3000) {
      const prefix = this.config.selfCommands ? '🤖 ' : '';
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
      const message = JSON.parse(task.payload, BufferJSON.reviver) as TaskMessage;
      if (message.continueTaskId) {
        const parent=this.store.task(message.continueTaskId);
        if (!this.conversationTask(parent) || parent.group_jid!==task.group_jid || !['queued','submitting','running','completed','stopped'].includes(parent.state)) {
          this.store.atomic(()=>{this.store.setState(task.id,'review');this.enqueue(task,'I could not safely resume the earlier conversation. Check T3 Code before retrying, or send @bot new to start fresh.');});
          continue;
        }
        if (!parent.thread_id) continue;
        task.thread_id=parent.thread_id;
        this.store.attachThread(task.id,parent.thread_id);
      }
      if (task.thread_id && busyThreads.has(task.thread_id)) continue;
      if (task.thread_id) {
        try {
          const snapshot=await this.t3.show(task.thread_id);
          if (!shouldContinue()) break;
          // Settlement closes the conversation; a normal completed turn does not.
          if (snapshot.thread.settled) {
            task.thread_id=null;
            this.store.attachThread(task.id,null);
          }
        } catch (error) {
          this.logError(error);
          this.store.atomic(()=>{
            this.store.setState(task.id,'review');
            this.enqueue(task,'I could not verify whether the previous conversation is settled. No message was sent. Check T3 Code, or send @bot new to start fresh.');
          });
          continue;
        }
      }
      this.store.setState(task.id, 'submitting');
      try {
        const result = await this.t3.submit(this.config.noProject,taskPrompt(message,this.config.selfCommands,message.text,message.projectContext),task.thread_id ?? undefined);
        task.thread_id = result.threadId;
        this.store.atomic(() => {
          this.store.submitted(task, result.threadId, result.runId);
          this.store.bindContext(task,result.threadId);
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
