import { randomBytes, randomUUID } from 'node:crypto';
import { BufferJSON } from '@whiskeysockets/baileys';
import {isSupportedChat, projectCatalog, type Config} from './config.js';
import {parseProjectCommand} from './projects.js';
import { hasSelfPrefix, instructionText, taskPrompt, type Incoming } from './messages.js';
import { Store, type Task } from './store.js';
import type { T3 } from './t3.js';

type TaskMessage = Incoming & {routeProject?: string; instructionReady?: boolean; pendingRequestId?: string; referenceTaskId?: string};

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
  private label(project: string): string {
    return [...this.projects].find(([,value])=>value===project)?.[0] ?? 'selected project';
  }
  private record(message: TaskMessage, project: string, state: string, reply?: string, thread?: string, effect?:()=>void): boolean {
    const id=randomUUID();
    let accepted=false;
    const payload: TaskMessage={...message,instructionReady:true,routeProject:this.config.routes.find(route=>route.chatJid===message.group)?.project};
    this.store.atomic(()=>{
      accepted=this.store.add(id,payload,project,thread,state);
      if (!accepted) return;
      effect?.();
      if (reply) this.enqueue(this.store.task(id)!,reply);
    });
    return accepted;
  }
  private control(message: TaskMessage, reply: string, effect?:()=>void): boolean {
    return this.record(message,'','control',reply,undefined,effect);
  }
  private work(message: Incoming, project: string, thread?: string, effect?:()=>void): boolean {
    const reply=message.hasMedia ? 'This first version handles text only. Please describe the attachment in text and send @bot again.' : undefined;
    return this.record(message,project,message.hasMedia ? 'unsupported' : 'queued',reply,thread,effect);
  }
  private chooseProject(message: Incoming, reason='Which project should handle this?', reference?: Task): boolean {
    return this.record({...message,referenceTaskId:reference?.id},'','awaiting_project',`${reason} Reply to this message with #project-name, or cancel. Use @bot projects to list available names.`);
  }
  private confirmNewTask(message: Incoming, project: string, original: Task, effect?:()=>void): boolean {
    return this.record(message,project,'awaiting_new_task',`This reply belongs to #${this.label(original.project)}. Start a NEW task in #${this.label(project)}? Reply new or cancel. The original thread will keep its project.`,undefined,effect);
  }
  accept(m: Incoming, botIds: string[], now = Date.now()): boolean {
    if (!this.chatAllowed(m.group) || !m.id) return false;
    if (this.config.selfCommands) {
      // Own-account authenticity comes from the linked-device protocol.
      if (!m.fromMe || !botIds.some(id=>this.config.allowedSenderJids.includes(id))) return false;
    } else if (m.fromMe || ![m.sender,m.senderAlt].some(id=>this.config.allowedSenderJids.includes(id))) return false;
    if (this.store.isOutgoing(m.group,m.id)) return false;
    if (!Number.isFinite(m.timestamp) || m.timestamp*1000>now+30000 || now-m.timestamp*1000>this.config.maxMessageAgeSeconds*1000) return false;
    if (m.text.length+m.quotedText.length>16000) return false;
    const isBotReply=this.store.isOutgoing(m.group,m.quotedId);
    const response=isBotReply ? this.store.requestForMessage(m.group,m.quotedId) : undefined;
    const parentId=response ? (JSON.parse(response.payload,BufferJSON.reviver) as TaskMessage).pendingRequestId : undefined;
    const parent=parentId ? this.store.task(parentId) : undefined;
    const reference=parent?.group_jid===m.group ? parent : response;
    const replyMessage: TaskMessage=reference && ['awaiting_project','awaiting_new_task'].includes(reference.state) ? {...m,pendingRequestId:reference.id} : m;
    const prefix=this.config.selfCommands ? hasSelfPrefix(m.text) : m.mentions.some(id=>botIds.includes(id));
    if (!prefix && !reference) return false;
    const instruction=instructionText(m.text,this.config.selfCommands);
    if (!instruction) return false;

    // A project-choice reply resumes the original instruction and quoted issue,
    // never a bare project name as a new agent task.
    if (reference && ['awaiting_project','awaiting_new_task'].includes(reference.state)) {
      if (/^cancel$/i.test(instruction)) {
        return this.control(replyMessage,'Pending task cancelled.',()=>this.store.setState(reference.id,'cancelled'));
      }
      const original=JSON.parse(reference.payload,BufferJSON.reviver) as TaskMessage;
      const selection=/^#([a-z0-9][a-z0-9_-]{0,63})$/i.exec(instruction);
      if (reference.state==='awaiting_project' && selection) {
        const project=this.projects.get(selection[1].toLowerCase());
        if (!project) return this.control(replyMessage,'Unknown project. Reply with a valid #project-name. Use @bot projects to list names.');
        const selected={...m,text:original.text,quotedText:original.quotedText,hasMedia:original.hasMedia};
        const source=original.referenceTaskId ? this.store.task(original.referenceTaskId) : undefined;
        const previous=source?.group_jid===m.group ? source : undefined;
        const resolve=()=>this.store.setState(reference.id,'resolved');
        if (previous?.thread_id && project!==previous.project) return this.confirmNewTask(selected,project,previous,resolve);
        return this.work(selected,project,previous?.thread_id ?? undefined,resolve);
      }
      if (reference.state==='awaiting_new_task' && /^new$/i.test(instruction)) {
        if (![...this.projects.values()].includes(reference.project)) return this.control(replyMessage,'That project is no longer configured. Start a fresh @bot command with a valid project.');
        return this.work({...m,text:original.text,quotedText:original.quotedText,hasMedia:original.hasMedia},reference.project,undefined,()=>this.store.setState(reference.id,'resolved'));
      }
      // An explicit new @bot command is independent of the pending question.
      if (!prefix) return this.control(replyMessage,reference.state==='awaiting_project' ? 'Reply with #project-name or cancel.' : 'Reply with new or cancel.');
    }

    if (!prefix && !reference?.thread_id) return false;
    const command=parseProjectCommand(instruction,this.projects);
    if (command.kind==='projects') {
      return this.control(replyMessage,`Available projects: ${[...this.projects.keys()].map(name=>'#'+name).join(', ')}. Use @bot #project-name followed by your task.`);
    }
    if (command.kind==='map') {
      const project=this.projects.get(command.alias);
      if (!project) return this.control(replyMessage,'Unknown project. Use @bot projects to list available names.');
      return this.control(replyMessage,`This chat now uses #${command.alias} for new tasks. A #project-name in a message overrides it for that task only.`,()=>this.store.mapChat(m.group,project));
    }
    if (command.kind==='unmap') return this.control(replyMessage,'Chat mapping cleared. New tasks need a #project-name or I will ask you to choose.',()=>this.store.unmapChat(m.group));
    const message={...m,text:command.instruction};
    if (command.error) return this.chooseProject(message,command.error,reference);
    if (!command.instruction) return this.control(replyMessage,'Add a task after the project name, for example: @bot #project-name explain this project.');
    const explicit=command.alias ? this.projects.get(command.alias) : undefined;
    if (command.alias && !explicit) return this.chooseProject(message,`Unknown project #${command.alias}.`,reference);

    if (reference?.thread_id) {
      if (![...this.projects.values()].includes(reference.project)) return this.chooseProject(message,'The original task project is no longer configured.',reference);
      if (explicit && explicit!==reference.project) {
        return this.confirmNewTask(message,explicit,reference);
      }
      // Changing a chat mapping never moves an existing task to another project.
      return this.work(message,reference.project,reference.thread_id);
    }
    const project=explicit ?? this.mappedProject(m.group);
    if (!project || ![...this.projects.values()].includes(project)) return this.chooseProject(message);
    return this.work(message,project);
  }
  isRouted(task: Task): boolean {
    if (!this.chatAllowed(task.group_jid)) return false;
    if (!task.project) return ['control','awaiting_project','resolved','cancelled'].includes(task.state);
    if (![...this.projects.values()].includes(task.project)) return false;
    if (this.config.accountWide) return true;
    // Preserve conservative recovery for legacy restricted-chat configs.
    const payload=JSON.parse(task.payload,BufferJSON.reviver) as TaskMessage;
    const originalRoute=payload.routeProject ?? task.project;
    return this.config.routes.some(route=>route.chatJid===task.group_jid && route.project===originalRoute);
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
        const message = JSON.parse(task.payload, BufferJSON.reviver) as TaskMessage;
        const result = await this.t3.submit(task.project, taskPrompt(message, this.config.selfCommands, message.instructionReady ? message.text : undefined), task.thread_id ?? undefined);
        const followUp = Boolean(task.thread_id);
        task.thread_id = result.threadId;
        this.store.atomic(() => {
          this.store.submitted(task, result.threadId, result.runId);
          this.enqueue(task, `${followUp ? 'Follow-up sent' : 'Task sent'} to T3 Code (#${this.label(task.project)}).\nThread: ${result.threadId}`);
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
