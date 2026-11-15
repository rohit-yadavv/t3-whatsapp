import { DatabaseSync } from 'node:sqlite';
import { BufferJSON } from '@whiskeysockets/baileys';
import type { Incoming } from './messages.js';

export interface Task { id: string; group_jid: string; message_id: string; project: string; thread_id: string | null; run_id: string | null; state: string; payload: string; notice: string | null }
export interface ChatContext { project: string; thread_id: string | null; task_id: string | null }
export interface Outgoing { id: string; group_jid: string; task_id: string; text: string; quote: string; state: string }
export class Store {
  readonly db: DatabaseSync;
  constructor(path: string, recover = true) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, group_jid TEXT NOT NULL, message_id TEXT NOT NULL,
        project TEXT NOT NULL, thread_id TEXT, run_id TEXT, state TEXT NOT NULL,
        payload TEXT NOT NULL, notice TEXT, UNIQUE(group_jid, message_id));
      CREATE TABLE IF NOT EXISTS links (group_jid TEXT, message_id TEXT, thread_id TEXT NOT NULL, PRIMARY KEY(group_jid,message_id));
      CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, group_jid TEXT, task_id TEXT, text TEXT, quote TEXT, state TEXT);
      CREATE TABLE IF NOT EXISTS chat_context (chat_jid TEXT PRIMARY KEY, project TEXT NOT NULL, thread_id TEXT, task_id TEXT);
      CREATE TABLE IF NOT EXISTS chat_mappings (chat_jid TEXT PRIMARY KEY, project TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sent_messages (id TEXT PRIMARY KEY, content TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS tasks_state ON tasks(state);
      CREATE INDEX IF NOT EXISTS tasks_thread_project ON tasks(thread_id, group_jid, project);
      CREATE INDEX IF NOT EXISTS outbox_state ON outbox(state);
    `);
    // A process could have died after an external side effect. Never blindly repeat it.
    if (recover) this.db.exec("UPDATE tasks SET state='review' WHERE state='submitting'; UPDATE outbox SET state='review' WHERE state='sending';");
  }
  findThread(group: string, id?: string, project?: string): string | undefined {
    if (!id) return;
    const link = this.db.prepare('SELECT thread_id FROM links WHERE group_jid=? AND message_id=?').get(group, id) as {thread_id: string} | undefined;
    if (!link) return;
    if (project && !this.db.prepare('SELECT 1 FROM tasks WHERE thread_id=? AND group_jid=? AND project=? LIMIT 1').get(link.thread_id, group, project)) return;
    return link.thread_id;
  }
  requestForMessage(chat: string, id?: string): Task | undefined {
    if (!id) return;
    const outgoing=this.db.prepare('SELECT task_id FROM outbox WHERE group_jid=? AND id=?').get(chat,id) as {task_id:string} | undefined;
    return outgoing ? this.task(outgoing.task_id) : this.db.prepare('SELECT * FROM tasks WHERE group_jid=? AND message_id=?').get(chat,id) as unknown as Task | undefined;
  }
  chatProject(chat: string): string | undefined {
    return (this.db.prepare('SELECT project FROM chat_mappings WHERE chat_jid=?').get(chat) as {project:string} | undefined)?.project;
  }
  mapChat(chat: string, project: string) {
    this.db.prepare('INSERT OR REPLACE INTO chat_mappings VALUES (?,?)').run(chat,project);
  }
  unmapChat(chat: string) { this.mapChat(chat,''); }
  context(chat: string): ChatContext | undefined {
    return this.db.prepare('SELECT project,thread_id,task_id FROM chat_context WHERE chat_jid=?').get(chat) as unknown as ChatContext | undefined;
  }
  focusChat(chat: string, project: string, thread?: string, taskId?: string) {
    this.db.prepare('INSERT OR REPLACE INTO chat_context VALUES (?,?,?,?)').run(chat,project,thread ?? null,taskId ?? null);
  }
  clearContext(chat: string) { this.db.prepare('DELETE FROM chat_context WHERE chat_jid=?').run(chat); }
  bindContext(task: Task, thread: string) {
    this.db.prepare('UPDATE chat_context SET thread_id=? WHERE chat_jid=? AND task_id=?').run(thread,task.group_jid,task.id);
  }
  attachThread(id: string, thread: string) { this.db.prepare('UPDATE tasks SET thread_id=? WHERE id=?').run(thread,id); }
  isOutgoing(group: string, id?: string): boolean {
    return Boolean(id && this.db.prepare('SELECT 1 FROM outbox WHERE group_jid=? AND id=?').get(group, id));
  }
  link(group: string, message: string, thread: string) {
    this.db.prepare('INSERT OR REPLACE INTO links VALUES (?,?,?)').run(group, message, thread);
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
    this.link(task.group_jid, task.message_id, thread);
  }
  notice(id: string, notice: string | null) { this.db.prepare('UPDATE tasks SET notice=? WHERE id=?').run(notice, id); }
  outgoing(id: string, task: Task, text: string) {
    const m = JSON.parse(task.payload, BufferJSON.reviver) as Incoming;
    this.db.prepare("INSERT INTO outbox VALUES (?,?,?,?,?,'pending')").run(id, task.group_jid, task.id, text, JSON.stringify(m.raw, BufferJSON.replacer));
    if (task.thread_id) this.link(task.group_jid, id, task.thread_id);
  }
  pending(): Outgoing[] { return this.db.prepare("SELECT * FROM outbox WHERE state='pending' ORDER BY rowid").all() as unknown as Outgoing[]; }
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
