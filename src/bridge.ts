import { randomBytes, randomUUID } from 'node:crypto';
import { BufferJSON } from '@whiskeysockets/baileys';
import {isSupportedChat, projectCatalog, type Config} from './config.js';
import {parseProjectCommand} from './projects.js';
import { hasSelfPrefix, instructionText, taskPrompt, type Incoming } from './messages.js';
import { Store, type Task } from './store.js';
import type { T3, ThreadSummary } from './t3.js';
import {parseThreadSelector, matchThreads, threadKey, isCaptureRequest} from './threads.js';

type TaskMessage = Incoming & {routeProject?: string; instructionReady?: boolean; pendingRequestId?: string; referenceTaskId?: string; continueTaskId?: string; threadName?: string; requireThread?: string; expectedThreadId?: string; selectOnly?: boolean; listThreads?: boolean; threadResolved?: boolean; threadChoices?: ThreadSummary[]};

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
  private record(message: TaskMessage, project: string, state: string, reply?: string, thread?: string, effect?:(task:Task)=>void): boolean {
    const id=randomUUID();
    let accepted=false;
    const payload: TaskMessage={...message,instructionReady:true,routeProject:this.config.routes.find(route=>route.chatJid===message.group)?.project};
    this.store.atomic(()=>{
      accepted=this.store.add(id,payload,project,thread,state);
      if (!accepted) return;
      const task=this.store.task(id)!;
      effect?.(task);
      if (reply) this.enqueue(task,reply);
    });
    return accepted;
  }
  private control(message: TaskMessage, reply: string, effect?:()=>void): boolean {
    return this.record(message,'','control',reply,undefined,effect);
  }
  private work(message: TaskMessage, project: string, thread?: string, effect?:()=>void): boolean {
    if (!message.text.trim() && !message.threadName && !message.requireThread && !message.listThreads) return this.control(message,`Using #${this.label(project)}. What would you like to do?`,()=>{
      if (this.config.rememberContext!==false) this.store.focusChat(message.group,project,thread);
      effect?.();
    });
    const reply=message.hasMedia ? 'This first version handles text only. Please describe the attachment in text and send @bot again.' : undefined;
    return this.record(message,project,message.hasMedia ? 'unsupported' : 'queued',reply,thread,task=>{
      if (!message.hasMedia && this.config.rememberContext!==false) this.store.focusChat(message.group,project,thread,task.id);
      effect?.();
    });
  }
  private projectError(message: TaskMessage, reason: string): boolean {
    return this.control(message,`${reason} No task was started. Correct the #project-name or send a fresh command without a project selector.`);
  }
  private confirmNewTask(message: TaskMessage, project: string, original: Task, effect?:()=>void): boolean {
    return this.record({...message,expectedThreadId:undefined,continueTaskId:undefined},project,'awaiting_new_task',`This reply belongs to #${this.label(original.project)}. Start a NEW task in #${this.label(project)}? Reply new or cancel. The original thread will keep its project.`,undefined,effect);
  }
  private resume(message: Incoming, original: TaskMessage): TaskMessage {
    return {...message,text:original.text,quotedText:original.quotedText,hasMedia:original.hasMedia,threadName:original.threadName,requireThread:original.requireThread,expectedThreadId:original.expectedThreadId,selectOnly:original.selectOnly,listThreads:original.listThreads};
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
    const replyMessage: TaskMessage=reference && ['awaiting_project','awaiting_new_task','awaiting_thread'].includes(reference.state) ? {...m,pendingRequestId:reference.id} : m;
    const prefix=this.config.selfCommands ? hasSelfPrefix(m.text) : m.mentions.some(id=>botIds.includes(id));
    if (!prefix && !reference) return false;
    const instruction=instructionText(m.text,this.config.selfCommands);
    if (!instruction) return false;

    // A project-choice reply resumes the original instruction and quoted issue,
    // never a bare project name as a new agent task.
    if (reference && ['awaiting_project','awaiting_new_task','awaiting_thread'].includes(reference.state)) {
      if (/^cancel$/i.test(instruction)) {
        return this.control(replyMessage,'Pending task cancelled.',()=>this.store.setState(reference.id,'cancelled'));
      }
      const original=JSON.parse(reference.payload,BufferJSON.reviver) as TaskMessage;
      if (reference.state==='awaiting_thread') {
        const number=/^\d{1,2}$/.test(instruction) ? Number(instruction) : 0;
        const choice=number>0 ? original.threadChoices?.[number-1] : undefined;
        const selector=parseThreadSelector(instruction);
        if (choice || (selector.name && !selector.instruction && !selector.error)) {
          return this.work({...this.resume(m,original),requireThread:choice?.threadId,listThreads:false,threadName:choice ? original.threadName : selector.name,threadResolved:false},reference.project,undefined,()=>this.store.setState(reference.id,'resolved'));
        }
        if (!prefix) return this.control(replyMessage,'Reply with a listed number, another ~thread-name, or cancel.');
      }
      const selection=/^#([a-z0-9][a-z0-9_-]{0,63})$/i.exec(instruction);
      if (reference.state==='awaiting_project' && selection) {
        const project=this.projects.get(selection[1].toLowerCase());
        if (!project) return this.projectError(replyMessage,'Unknown project.');
        const selected=this.resume(m,original);
        const source=original.referenceTaskId ? this.store.task(original.referenceTaskId) : undefined;
        const previous=source?.group_jid===m.group ? source : undefined;
        const resolve=()=>this.store.setState(reference.id,'resolved');
        if (previous?.thread_id && project!==previous.project) return this.confirmNewTask(selected,project,previous,resolve);
        return this.work({...selected,expectedThreadId:selected.threadName ? previous?.thread_id ?? undefined : undefined},project,selected.threadName ? undefined : previous?.thread_id ?? undefined,resolve);
      }
      if (reference.state==='awaiting_new_task' && /^new$/i.test(instruction)) {
        if (![...this.projects.values()].includes(reference.project)) return this.control(replyMessage,'That project is no longer configured. Start a fresh @bot command with a valid project.');
        return this.work(this.resume(m,original),reference.project,undefined,()=>this.store.setState(reference.id,'resolved'));
      }
      // An explicit new @bot command is independent of the pending question.
      if (!prefix) return this.control(replyMessage,reference.state==='awaiting_project' ? 'That older project prompt is no longer needed. Send a fresh @bot message to start a No project conversation.' : 'Reply with new or cancel.');
    }

    if (!prefix && !reference?.thread_id) return false;
    const selector=parseThreadSelector(instruction);
    if (selector.error) return this.control(replyMessage,selector.error);
    const command=parseProjectCommand(selector.instruction,this.projects);
    if (selector.name && command.kind!=='task') return this.control(replyMessage,'Use ~thread-name with a task or on its own to select a conversation.');
    if (command.kind==='projects') {
      return this.control(replyMessage,`Available projects: ${[...this.projects.keys()].map(name=>'#'+name).join(', ')}. Use @bot #project-name followed by your task.`);
    }
    if (command.kind==='map') {
      const project=this.projects.get(command.alias);
      if (!project) return this.control(replyMessage,'Unknown project. Use @bot projects to list available names.');
      return this.control(replyMessage,`This chat now uses #${command.alias} for new tasks. A #project-name in a message overrides it for that task only.`,()=>{this.store.mapChat(m.group,project);this.store.clearContext(m.group);});
    }
    if (command.kind==='unmap') return this.control(replyMessage,'Chat mapping cleared. The next conversation will use No project unless you select a project.',()=>{this.store.unmapChat(m.group);this.store.clearContext(m.group);});
    const forceNew=/^new(?:\s|$)/i.test(command.instruction);
    const body=forceNew ? command.instruction.replace(/^new(?:\s+|$)/i,'').trim() : command.instruction;
    const message: TaskMessage={...m,text:/^threads$/i.test(body) ? '' : body,threadName:selector.name,selectOnly:!body || /^threads$/i.test(body),listThreads:/^threads$/i.test(body)};
    if (forceNew && selector.name) return this.control(replyMessage,'Use new for a fresh conversation, or ~thread-name to select an existing one.');
    if (command.error) return this.projectError(message,command.error);
    const explicit=command.alias ? this.projects.get(command.alias) : undefined;
    if (command.alias && !explicit) return this.projectError(message,`Unknown project #${command.alias}.`);

    if (forceNew && !body) {
      if (explicit) return this.control(m,`New #${this.label(explicit)} conversation ready. What would you like to do?`,()=>this.store.focusChat(m.group,explicit));
      return this.control(m,'Active conversation cleared. The next command will use the saved chat mapping or No project.',()=>this.store.clearContext(m.group));
    }
    if (reference?.thread_id && !forceNew) {
      if (![...this.projects.values()].includes(reference.project)) return this.projectError(message,'The original task project is no longer configured.');
      if (explicit && explicit!==reference.project) {
        return this.confirmNewTask(message,explicit,reference);
      }
      // Changing a chat mapping never moves an existing task to another project.
      return this.work({...message,expectedThreadId:selector.name ? reference.thread_id : undefined},reference.project,selector.name ? undefined : reference.thread_id);
    }
    const savedContext=!forceNew && this.config.rememberContext!==false ? this.store.context(m.group) : undefined;
    const context=savedContext && [...this.projects.values()].includes(savedContext.project) ? savedContext : undefined;
    const contextProject=context && (!explicit || context.project===explicit);
    const useContext=!selector.name && !message.listThreads && contextProject;
    const savedMapping=this.mappedProject(m.group);
    const mapping=savedMapping && [...this.projects.values()].includes(savedMapping) ? savedMapping : undefined;
    const project=explicit ?? (contextProject ? context.project : undefined) ?? (reference?.state==='awaiting_thread' ? reference.project : undefined) ?? mapping ?? this.config.noProject;
    if (!this.projects.has('no-project')) throw new Error('No project workspace is not configured.');
    return this.work({...message,continueTaskId:useContext ? context.task_id ?? undefined : undefined},project,useContext ? context.thread_id ?? undefined : undefined);
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
  private async resolveThread(task: Task, message: TaskMessage): Promise<boolean> {
    let threads: ThreadSummary[];
    try { threads=await this.t3.listThreads(task.project); }
    catch (error) {
      this.logError(error);
      this.store.atomic(()=>{
        this.store.setState(task.id,'review');
        this.store.clearContextForTask(task);
        this.enqueue(task,'I could not read the thread list from T3 Code. No message was sent to a thread. Please try again when T3 is available.');
      });
      return false;
    }
    const saved=message.threadName ? this.store.threadAlias(task.project,threadKey(message.threadName)) : undefined;
    const selectedId=message.requireThread ?? saved;
    let matches=selectedId ? threads.filter(thread=>thread.threadId===selectedId) : [];
    if (!matches.length && !message.requireThread) matches=message.listThreads ? threads : matchThreads(message.threadName ?? '',threads);
    if (matches.length!==1 || message.listThreads) {
      const choices=matches.slice(0,10);
      const options=choices.map((thread,index)=>`${index+1}. ${thread.title.replace(/\s+/g,' ').slice(0,100)}`).join('\n');
      const text=choices.length
        ? `Which thread in #${this.label(task.project)}?${matches.length>10 ? ' Showing the first 10 matches.' : ''}\n${options}\nReply with a number, another ~thread-name, or cancel.`
        : `I could not find that thread in #${this.label(task.project)}. Reply with another ~thread-name or cancel. You can create a named thread in T3 Code first.`;
      this.store.atomic(()=>{
        this.store.setPayload(task.id,{...message,threadChoices:choices});
        this.store.setState(task.id,'awaiting_thread');
        this.store.clearContextForTask(task);
        this.enqueue(task,text);
      });
      return false;
    }
    const selected=matches[0];
    if (message.expectedThreadId && selected.threadId!==message.expectedThreadId) {
      this.store.atomic(()=>{
        this.store.setState(task.id,'control');this.store.clearContextForTask(task);
        this.enqueue(task,'That selector points to another thread. Send a fresh @bot #project ~thread command without quoting the previous bot task to switch conversations.');
      });
      return false;
    }
    task.thread_id=selected.threadId;
    message.threadResolved=true;
    this.store.atomic(()=>{
      this.store.attachThread(task.id,selected.threadId);
      this.store.setPayload(task.id,message);
      if (message.threadName) this.store.rememberThread(task.project,threadKey(message.threadName),selected.threadId);
      if (message.selectOnly) {
        this.store.setState(task.id,'selected');
        this.store.bindContext(task,selected.threadId);
        this.enqueue(task,`Using ~${selected.title} in #${this.label(task.project)}. What would you like to add or discuss?`);
      }
    });
    return !message.selectOnly;
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
        if (!parent || parent.group_jid!==task.group_jid || parent.project!==task.project || ['review','unsupported','cancelled','awaiting_thread','awaiting_project','awaiting_new_task','resolved'].includes(parent.state)) {
          this.store.atomic(()=>{this.store.setState(task.id,'review');this.enqueue(task,'I could not safely resume the earlier task. Select a thread explicitly or start a new conversation.');});
          continue;
        }
        if (!parent.thread_id) continue;
        task.thread_id=parent.thread_id;
        this.store.attachThread(task.id,parent.thread_id);
      }
      if ((message.threadName || message.requireThread || message.listThreads) && !message.threadResolved) {
        if (!await this.resolveThread(task,message)) continue;
        if (!shouldContinue()) break;
      }
      if (task.thread_id && busyThreads.has(task.thread_id)) continue;
      this.store.setState(task.id, 'submitting');
      try {
        const result = await this.t3.submit(task.project, taskPrompt(message, this.config.selfCommands, message.instructionReady ? message.text : undefined, {general:task.project===this.config.noProject,capture:isCaptureRequest(message.text)}), task.thread_id ?? undefined);
        task.thread_id = result.threadId;
        this.store.atomic(() => {
          this.store.submitted(task, result.threadId, result.runId);
          this.store.bindContext(task,result.threadId);
          this.enqueue(task, task.project===this.config.noProject ? 'I’m on it.' : `I’m on it in #${this.label(task.project)}.`);
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
