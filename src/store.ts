import { DatabaseSync } from 'node:sqlite';
import { BufferJSON } from '@whiskeysockets/baileys';
import {dirname,resolve,join} from 'node:path';
import type {Document,Handoff} from './responses.js';
import type { Incoming } from './messages.js';

export interface Task { id: string; group_jid: string; message_id: string; project: string; thread_id: string | null; run_id: string | null; state: string; payload: string; notice: string | null }
export interface Outgoing { id: string; group_jid: string; task_id: string; text: string; quote: string; state: string; document:string|null }
export class Store {
  readonly db: DatabaseSync;
  readonly directory:string;
  constructor(path: string, recover = true) {
    this.directory=dirname(resolve(path));
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, group_jid TEXT NOT NULL, message_id TEXT NOT NULL,
        project TEXT NOT NULL, thread_id TEXT, run_id TEXT, state TEXT NOT NULL,
        payload TEXT NOT NULL, notice TEXT, UNIQUE(group_jid, message_id));
      CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, group_jid TEXT, task_id TEXT, text TEXT, quote TEXT, state TEXT);
      CREATE TABLE IF NOT EXISTS chat_mappings (chat_jid TEXT PRIMARY KEY, project TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sent_messages (id TEXT PRIMARY KEY, content TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outbound_contacts (
        account TEXT NOT NULL, jid TEXT NOT NULL, phone TEXT, name TEXT,
        PRIMARY KEY (account, jid)
      );
      CREATE INDEX IF NOT EXISTS tasks_state ON tasks(state);
      CREATE INDEX IF NOT EXISTS tasks_thread_project ON tasks(thread_id, group_jid, project);
      CREATE INDEX IF NOT EXISTS outbox_state ON outbox(state);
    `);
    if (!this.db.prepare('PRAGMA table_info(outbox)').all().some(column=>column.name==='document')) this.db.exec('ALTER TABLE outbox ADD COLUMN document TEXT');
    // A process could have died after an external side effect. Never blindly repeat it.
    if (recover) this.db.exec("UPDATE tasks SET state='review' WHERE state='submitting'; UPDATE outbox SET state='review' WHERE state='sending'; UPDATE outbox SET state='superseded' WHERE state='pending' AND task_id IN (SELECT id FROM tasks WHERE state IN ('awaiting_project','awaiting_thread','awaiting_new_task')); UPDATE tasks SET state='superseded' WHERE state IN ('awaiting_project','awaiting_thread','awaiting_new_task');");
  }
  requestForMessage(chat: string, id?: string): Task | undefined {
    if (!id) return;
    const outgoing=this.db.prepare('SELECT task_id FROM outbox WHERE group_jid=? AND id=?').get(chat,id) as {task_id:string|null} | undefined;
    if (outgoing) return outgoing.task_id ? this.task(outgoing.task_id) : undefined;
    return this.db.prepare('SELECT * FROM tasks WHERE group_jid=? AND message_id=?').get(chat,id) as unknown as Task | undefined;
  }
  chatProject(chat: string): string | undefined {
    return (this.db.prepare('SELECT project FROM chat_mappings WHERE chat_jid=?').get(chat) as {project:string} | undefined)?.project;
  }
  mapChat(chat: string, project: string) {
    this.db.prepare('INSERT OR REPLACE INTO chat_mappings VALUES (?,?)').run(chat,project);
  }
  unmapChat(chat: string) { this.mapChat(chat,''); }
  attachThread(id: string, thread: string | null) { this.db.prepare('UPDATE tasks SET thread_id=? WHERE id=?').run(thread,id); }
  outputDirectory(id:string):string {return join(this.directory,'deliveries',id);}
  setPayload(id:string,payload:unknown) {this.db.prepare('UPDATE tasks SET payload=? WHERE id=?').run(JSON.stringify(payload,BufferJSON.replacer),id);}
  recentHandoffs(chat:string):Handoff[] {
    return this.db.prepare("SELECT payload FROM tasks WHERE group_jid=? AND json_type(payload,'$.handoff')='object' ORDER BY rowid DESC LIMIT 5").all(chat).map(row=>JSON.parse(row.payload as string,BufferJSON.reviver).handoff);
  }
  isOutgoing(group: string, id?: string): boolean {
    return Boolean(id && this.db.prepare('SELECT 1 FROM outbox WHERE id=? AND (group_jid=? OR task_id IS NULL)').get(id, group));
  }
  add(id: string, m: Incoming, project: string, thread?: string, state = 'queued'): boolean {
    return this.db.prepare("INSERT OR IGNORE INTO tasks (id,group_jid,message_id,project,thread_id,state,payload) VALUES (?,?,?,?,?,?,?)")
      .run(id, m.group, m.id, project, thread ?? null, state, JSON.stringify(m, BufferJSON.replacer)).changes > 0;
  }
  task(id: string): Task | undefined { return this.db.prepare('SELECT * FROM tasks WHERE id=?').get(id) as unknown as Task | undefined; }
  runningThreadIds(): Set<string> {
    const rows = this.db.prepare("SELECT DISTINCT thread_id FROM tasks WHERE state='running' AND thread_id IS NOT NULL").all() as {thread_id: string}[];
    return new Set(rows.map(row => row.thread_id));
  }
  tasks(state: string): Task[] { return this.db.prepare('SELECT * FROM tasks WHERE state=? ORDER BY rowid').all(state) as unknown as Task[]; }
  setState(id: string, state: string) { this.db.prepare('UPDATE tasks SET state=? WHERE id=?').run(state, id); }
  submitted(task: Task, thread: string, run: string) {
    this.db.prepare("UPDATE tasks SET state='running',thread_id=?,run_id=? WHERE id=?").run(thread, run, task.id);
  }
  notice(id: string, notice: string | null) { this.db.prepare('UPDATE tasks SET notice=? WHERE id=?').run(notice, id); }
  outgoing(id: string, task: Task, text: string, document?:Document) {
    const m = JSON.parse(task.payload, BufferJSON.reviver) as Incoming;
    this.db.prepare("INSERT INTO outbox (id,group_jid,task_id,text,quote,state,document) VALUES (?,?,?,?,?,'pending',?)").run(id,task.group_jid,task.id,text,JSON.stringify(m.raw,BufferJSON.replacer),document ? JSON.stringify(document) : null);
  }
  pending(): Outgoing[] { return this.db.prepare("SELECT * FROM outbox WHERE state='pending' ORDER BY rowid").all() as unknown as Outgoing[]; }
  beginDirectSend(id: string, chat: string) {
    // Record before sending so an immediate echo cannot become an inbound command.
    this.db.prepare("INSERT INTO outbox (id,group_jid,state) VALUES (?,?,'sending')").run(id,chat);
  }
  directSendState(id: string): string | undefined {
    return (this.db.prepare('SELECT state FROM outbox WHERE id=? AND task_id IS NULL').get(id) as {state:string} | undefined)?.state;
  }
  sentState(id: string, state: string) { this.db.prepare('UPDATE outbox SET state=? WHERE id=?').run(state, id); }
  remember(id: string, message: unknown) { this.db.prepare('INSERT OR REPLACE INTO sent_messages VALUES (?,?)').run(id, JSON.stringify(message, BufferJSON.replacer)); }
  message(id: string) { const r = this.db.prepare('SELECT content FROM sent_messages WHERE id=?').get(id) as {content:string} | undefined; return r ? JSON.parse(r.content, BufferJSON.reviver) : undefined; }
  close() { this.db.close(); }
  atomic(work: () => void) {
    this.db.exec('BEGIN IMMEDIATE');
    try { work(); this.db.exec('COMMIT'); }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
}
