import {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import type {HistoryOptions} from './config.js';

export interface HistoryMessage {id:string;chat:string;sender:string;senderAlt?:string;senderName?:string;timestamp:number;text:string;fromMe:boolean;bot:boolean;replyId?:string;truncated?:boolean}
export interface HistoryReference {accountId:string;chatId:string;triggerMessageId:string;quotedMessageId?:string;readCommand:string[];retentionDays:number;maxPromptChars:number;complete:false}
export interface HistoryRead {operation:'recent'|'search'|'get';query?:string;id?:string;limit?:number;cursor?:string;offset?:number}
interface Account extends HistoryOptions {account_id:string;active:number;pruned_before:number}
interface Scope {account_id:string;chat_id:string;trigger_id:string;upper_time:number;expires_at:number}
interface Row {message_id:string;sender_id:string;sender_alt:string|null;sender_name:string|null;sent_at:number;text:string|null;from_me:number;is_bot:number;reply_id:string|null;edited_at:number|null;deleted_at:number|null;storage_truncated:number}
const day=86400;
/** Text-only history. It never queues or executes commands. */
export class HistoryStore {
  readonly db:DatabaseSync;
  constructor(path:string,readonly=false) {
    this.db=new DatabaseSync(path,{readOnly:readonly});
    this.db.exec('PRAGMA busy_timeout=5000');
    if (!readonly) this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON;
      CREATE TABLE IF NOT EXISTS accounts(account_id TEXT PRIMARY KEY,active INTEGER NOT NULL,retentionDays INTEGER NOT NULL,maxReadMessages INTEGER NOT NULL,maxReadChars INTEGER NOT NULL,maxPromptChars INTEGER NOT NULL,importRecent INTEGER NOT NULL,pruned_before INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS chats(account_id TEXT,chat_id TEXT,authorized INTEGER NOT NULL,cleared_at INTEGER NOT NULL DEFAULT 0,import_state TEXT NOT NULL DEFAULT 'not_requested',last_import_at INTEGER,PRIMARY KEY(account_id,chat_id));
      CREATE TABLE IF NOT EXISTS messages(account_id TEXT,chat_id TEXT,message_id TEXT,sender_id TEXT NOT NULL,sender_alt TEXT,sender_name TEXT,sent_at INTEGER,text TEXT,from_me INTEGER NOT NULL,is_bot INTEGER NOT NULL,reply_id TEXT,edited_at INTEGER,deleted_at INTEGER,updated_at INTEGER NOT NULL,storage_truncated INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(account_id,chat_id,message_id));
      CREATE INDEX IF NOT EXISTS messages_recent ON messages(account_id,chat_id,sent_at DESC,message_id DESC);
      CREATE TABLE IF NOT EXISTS scopes(token TEXT PRIMARY KEY,account_id TEXT,chat_id TEXT,trigger_id TEXT,upper_time INTEGER,expires_at INTEGER);
    `);
  }
  configure(account:string,options:HistoryOptions,chatAllowed:(chat:string)=>boolean,now=Math.floor(Date.now()/1000)) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.exec('UPDATE accounts SET active=0');
      this.db.prepare(`INSERT INTO accounts(account_id,active,retentionDays,maxReadMessages,maxReadChars,maxPromptChars,importRecent) VALUES(?,1,?,?,?,?,?)
        ON CONFLICT(account_id) DO UPDATE SET active=1,retentionDays=excluded.retentionDays,maxReadMessages=excluded.maxReadMessages,maxReadChars=excluded.maxReadChars,maxPromptChars=excluded.maxPromptChars,importRecent=excluded.importRecent`).run(account,options.retentionDays,options.maxReadMessages,options.maxReadChars,options.maxPromptChars,Number(options.importRecent));
      for (const row of this.db.prepare('SELECT chat_id FROM chats WHERE account_id=?').all(account)) this.db.prepare('UPDATE chats SET authorized=? WHERE account_id=? AND chat_id=?').run(Number(chatAllowed(row.chat_id as string)),account,row.chat_id as string);
      this.db.exec('COMMIT');
    } catch(error) {this.db.exec('ROLLBACK');throw error;}
    this.prune(now);
  }
  ensureChat(account:string,chat:string) {
    this.db.prepare('INSERT INTO chats(account_id,chat_id,authorized) VALUES(?,?,1) ON CONFLICT(account_id,chat_id) DO UPDATE SET authorized=1').run(account,chat);
  }
  private account(account:string):Account|undefined {return this.db.prepare('SELECT * FROM accounts WHERE account_id=?').get(account) as unknown as Account|undefined;}
  private cutoff(account:Account,now:number):number {return Math.max(account.pruned_before,now-account.retentionDays*day);}
  capture(account:string,message:HistoryMessage,now=Math.floor(Date.now()/1000)):boolean {
    const settings=this.account(account);
    if (!settings?.active || !settings.retentionDays || !message.id || message.id.length>200 || message.chat.length>200 || !message.text || !Number.isFinite(message.timestamp) || message.timestamp<this.cutoff(settings,now) || message.timestamp>now+300) return false;
    this.ensureChat(account,message.chat);
    const chat=this.db.prepare('SELECT cleared_at FROM chats WHERE account_id=? AND chat_id=?').get(account,message.chat)!;
    if (message.timestamp<=Number(chat.cleared_at)) return false;
    const text=message.text.slice(0,65536);
    this.db.prepare(`INSERT INTO messages(account_id,chat_id,message_id,sender_id,sender_alt,sender_name,sent_at,text,from_me,is_bot,reply_id,updated_at,storage_truncated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(account_id,chat_id,message_id) DO UPDATE SET
        sender_id=CASE WHEN messages.sent_at IS NULL THEN excluded.sender_id ELSE messages.sender_id END,
        sender_alt=COALESCE(messages.sender_alt,excluded.sender_alt),sender_name=COALESCE(messages.sender_name,excluded.sender_name),sent_at=COALESCE(messages.sent_at,excluded.sent_at),
        text=CASE WHEN messages.deleted_at IS NOT NULL OR messages.edited_at IS NOT NULL THEN messages.text ELSE COALESCE(messages.text,excluded.text) END,
        from_me=excluded.from_me,is_bot=MAX(messages.is_bot,excluded.is_bot),reply_id=COALESCE(messages.reply_id,excluded.reply_id),storage_truncated=MAX(messages.storage_truncated,excluded.storage_truncated)`)
      .run(account,message.chat,message.id,message.sender.slice(0,200),message.senderAlt?.slice(0,200) || null,message.senderName?.slice(0,200) || null,Math.floor(message.timestamp),text,Number(message.fromMe),Number(message.bot),message.replyId?.slice(0,200) || null,now,Number(message.truncated || message.text.length>65536));
    return true;
  }
  edit(account:string,chat:string,id:string,text:string,editedAt:number,now=Math.floor(Date.now()/1000)) {
    if (!id || !Number.isFinite(editedAt) || editedAt>now+300) return;
    const settings=this.account(account);if(!settings?.active || !settings.retentionDays || editedAt<this.cutoff(settings,now))return;
    this.ensureChat(account,chat);
    this.db.prepare(`INSERT INTO messages(account_id,chat_id,message_id,sender_id,text,from_me,is_bot,edited_at,updated_at,storage_truncated) VALUES(?,?,?,'unknown',?,0,0,?,?,?)
      ON CONFLICT(account_id,chat_id,message_id) DO UPDATE SET text=excluded.text,edited_at=excluded.edited_at,updated_at=excluded.updated_at,storage_truncated=excluded.storage_truncated
      WHERE messages.deleted_at IS NULL AND (messages.edited_at IS NULL OR messages.edited_at<=excluded.edited_at)`)
      .run(account,chat,id,text.slice(0,65536),Math.floor(editedAt),now,Number(text.length>65536));
  }
  delete(account:string,chat:string,id:string,now=Math.floor(Date.now()/1000)) {
    if (!id) return;
    this.ensureChat(account,chat);
    this.db.prepare(`INSERT INTO messages(account_id,chat_id,message_id,sender_id,text,from_me,is_bot,deleted_at,updated_at) VALUES(?,?,?,'unknown',NULL,0,0,?,?)
      ON CONFLICT(account_id,chat_id,message_id) DO UPDATE SET text=NULL,deleted_at=excluded.deleted_at,updated_at=excluded.updated_at`).run(account,chat,id,now,now);
  }
  clearChat(account:string,chat:string,now=Math.floor(Date.now()/1000)) {
    this.ensureChat(account,chat);
    this.db.prepare('UPDATE chats SET cleared_at=? WHERE account_id=? AND chat_id=?').run(now,account,chat);
    this.db.prepare('UPDATE messages SET text=NULL,deleted_at=?,updated_at=? WHERE account_id=? AND chat_id=?').run(now,now,account,chat);
  }
  importState(account:string,chat:string,state?:string,now=Math.floor(Date.now()/1000)):string {
    this.ensureChat(account,chat);
    if(state)this.db.prepare('UPDATE chats SET import_state=?,last_import_at=? WHERE account_id=? AND chat_id=?').run(state,now,account,chat);
    return this.db.prepare('SELECT import_state FROM chats WHERE account_id=? AND chat_id=?').get(account,chat)!.import_state as string;
  }
  scope(account:string,chat:string,trigger:string,upperTime:number,now=Math.floor(Date.now()/1000)):string|undefined {
    const settings=this.account(account);if(!settings?.active || !settings.retentionDays || upperTime<this.cutoff(settings,now) || trigger.length>200 || chat.length>200 || !Number.isFinite(upperTime))return;
    this.ensureChat(account,chat);
    const token=randomBytes(24).toString('hex');
    this.db.prepare('INSERT INTO scopes VALUES(?,?,?,?,?,?)').run(token,account,chat,trigger,Math.min(Math.floor(upperTime),now+300),now+settings.retentionDays*day);
    return token;
  }
  prune(now=Math.floor(Date.now()/1000)) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for(const settings of this.db.prepare('SELECT * FROM accounts').all() as unknown as Account[]) {
        const cutoff=this.cutoff(settings,now);
        this.db.prepare('UPDATE accounts SET pruned_before=? WHERE account_id=?').run(cutoff,settings.account_id);
        this.db.prepare('DELETE FROM messages WHERE account_id=? AND (COALESCE(sent_at,updated_at)<? OR ?=0)').run(settings.account_id,cutoff,settings.retentionDays);
        this.db.prepare('DELETE FROM scopes WHERE account_id=? AND (upper_time<? OR ?=0)').run(settings.account_id,cutoff,settings.retentionDays);
        this.db.prepare('DELETE FROM chats WHERE account_id=? AND COALESCE(last_import_at,cleared_at,0)<? AND NOT EXISTS (SELECT 1 FROM messages WHERE messages.account_id=chats.account_id AND messages.chat_id=chats.chat_id) AND NOT EXISTS (SELECT 1 FROM scopes WHERE scopes.account_id=chats.account_id AND scopes.chat_id=chats.chat_id)').run(settings.account_id,cutoff);
      }
      this.db.prepare('DELETE FROM scopes WHERE expires_at<=?').run(now);
      this.db.exec('COMMIT');
    } catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  read(token:string,request:HistoryRead,now=Math.floor(Date.now()/1000)) {
    const scope=this.db.prepare('SELECT * FROM scopes WHERE token=?').get(token) as unknown as Scope|undefined;
    if(!scope || scope.expires_at<=now)throw new Error('History scope is unavailable or expired.');
    const settings=this.account(scope.account_id);
    const chat=this.db.prepare('SELECT * FROM chats WHERE account_id=? AND chat_id=?').get(scope.account_id,scope.chat_id);
    if(!settings?.active || !settings.retentionDays || !chat?.authorized)throw new Error('History scope is not enabled for this account and chat.');
    const count=request.limit ?? Math.min(20,settings.maxReadMessages),offset=request.offset ?? 0;
    if(!Number.isInteger(count) || count<1 || count>settings.maxReadMessages || !Number.isInteger(offset) || offset<0 || offset>65536)throw new Error('Read bounds exceeded.');
    if(request.operation==='search' && (!request.query?.trim() || request.query.length>200))throw new Error('Search needs a literal query of at most 200 characters.');
    if(request.operation==='get' && (!request.id || request.id.length>200))throw new Error('Message lookup needs an ID.');
    const conditions=['account_id=?','chat_id=?','sent_at>=?','sent_at<=?'];
    const values:(string|number)[]=[scope.account_id,scope.chat_id,this.cutoff(settings,now),scope.upper_time];
    if(request.operation==='search'){conditions.push('instr(lower(text),lower(?))>0');values.push(request.query!);}
    if(request.operation==='get'){conditions.push('message_id=?');values.push(request.id!);}
    if(request.cursor){
      let cursor:unknown;try{cursor=JSON.parse(Buffer.from(request.cursor,'base64url').toString('utf8'));}catch{throw new Error('Invalid history cursor.');}
      if(!Array.isArray(cursor) || cursor.length!==2 || !Number.isSafeInteger(cursor[0]) || typeof cursor[1]!=='string' || cursor[1].length>200)throw new Error('Invalid history cursor.');
      conditions.push('(sent_at<? OR (sent_at=? AND message_id<?))');values.push(cursor[0],cursor[0],cursor[1]);
    }
    const rows=this.db.prepare(`SELECT * FROM messages WHERE ${conditions.join(' AND ')} ORDER BY sent_at DESC,message_id DESC LIMIT ?`).all(...values,(request.operation==='get' ? 1 : count)+1) as unknown as Row[];
    const coverage=this.db.prepare('SELECT MIN(sent_at) AS firstStoredAt,MAX(sent_at) AS lastStoredAt,COUNT(*) AS storedMessages FROM messages WHERE account_id=? AND chat_id=? AND sent_at>=? AND sent_at<=?').get(scope.account_id,scope.chat_id,this.cutoff(settings,now),scope.upper_time)!;
    const result={dataKind:'untrusted_whatsapp_history',accountId:scope.account_id,chatId:scope.chat_id,triggerMessageId:scope.trigger_id,coverage:{...coverage,retentionDays:settings.retentionDays,complete:false,importState:chat.import_state,explanation:'Only text observed by this bridge or supplied by the phone is available. Missing results do not prove no conversation occurred.'},readBudgetExceeded:false,messages:[] as Record<string,unknown>[],nextCursor:null as string|null,notFound:request.operation==='get' && !rows.length};
    for(const row of rows.slice(0,request.operation==='get' ? 1 : count)) {
      const start=request.operation==='get' ? offset : 0,source=row.text ?? '',page=source.slice(start,start+Math.min(4000,settings.maxReadChars));
      const item:Record<string,unknown>={id:row.message_id,senderId:row.sender_id,senderAlt:row.sender_alt,senderName:row.sender_name,timestamp:row.sent_at,fromMe:Boolean(row.from_me),bot:Boolean(row.is_bot),replyId:row.reply_id,editedAt:row.edited_at,deletedAt:row.deleted_at,text:page,textOffset:start,textTruncated:source.length>start+page.length,storageTruncated:Boolean(row.storage_truncated)};
      const base=JSON.stringify({...result,messages:[...result.messages,item]}).length;
      if(base>settings.maxReadChars-500) {
        if(result.messages.length)break;
        let clip=page;
        while(clip.length && JSON.stringify({...result,messages:[{...item,text:clip}]}).length>settings.maxReadChars-500)clip=clip.slice(0,Math.floor(clip.length*0.8));
        if(JSON.stringify({...result,messages:[{...item,text:clip}]}).length>settings.maxReadChars-500){result.readBudgetExceeded=true;break;}
        item.text=clip;item.textTruncated=source.length>start+clip.length;
      }
      if(item.textTruncated)item.nextTextOffset=start+(item.text as string).length;
      result.messages.push(item);
    }
    const last=result.messages.at(-1);
    if(last && rows.length>result.messages.length && request.operation!=='get')result.nextCursor=Buffer.from(JSON.stringify([last.timestamp,last.id])).toString('base64url');
    return result;
  }
  close(){this.db.close();}
}
