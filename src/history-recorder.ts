import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {jidNormalizedUser,normalizeMessageContent,proto,WAMessageStubType,type WAMessage,type WAMessageUpdate,type WAMessageKey} from '@whiskeysockets/baileys';
import {historyOptions,isSupportedChat,type Config} from './config.js';
import {normalize,textOf,type Incoming} from './messages.js';
import {HistoryStore,type HistoryReference} from './history.js';

export function isMessageMutation(raw:WAMessage):boolean {
  let content=raw.message;
  for(let i=0;content && i<6;i++) {
    if(content.editedMessage || [proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,proto.Message.ProtocolMessage.Type.REVOKE].some(type=>type===content!.protocolMessage?.type))return true;
    content=content.ephemeralMessage?.message ?? content.viewOnceMessage?.message ?? content.viewOnceMessageV2?.message;
  }
  return raw.messageStubType===WAMessageStubType.REVOKE;
}
export function shouldImportHistory(enabled:boolean,type:number|null|undefined):boolean {
  return enabled && [proto.HistorySync.HistorySyncType.INITIAL_BOOTSTRAP,proto.HistorySync.HistorySyncType.RECENT,proto.HistorySync.HistorySyncType.ON_DEMAND].includes(type ?? -1);
}
export class HistoryRecorder {
  private account?:string;
  private lastPrune=0;
  readonly options;
  constructor(private config:Config,readonly store:HistoryStore,readonly path:string,private isBot:(chat:string,id:string)=>boolean) {this.options=historyOptions(config);}
  chatAllowed(chat:string):boolean {return chat.length<=200 && isSupportedChat(chat) && (this.config.accountWide || this.config.routes.some(route=>route.chatJid===chat));}
  bind(ids:string[]) {
    const normalized=ids.map(jidNormalizedUser).filter(Boolean);
    const authorized=!this.config.selfCommands || normalized.some(id=>this.config.allowedSenderJids.includes(id));
    this.account=authorized ? normalized.find(id=>id.endsWith('@s.whatsapp.net')) ?? normalized[0] : undefined;
    if(this.account)this.store.configure(this.account,this.options,chat=>this.chatAllowed(chat));
    else this.store.db.exec('UPDATE accounts SET active=0');
  }
  get accountId(){return this.account;}
  get enabled(){return Boolean(this.account && this.options.retentionDays>0);}
  acceptsAccount(account:string){return account===this.account;}
  capture(raw:WAMessage):boolean {
    if(!this.enabled)return false;
    const m=normalize(raw);if(!this.chatAllowed(m.group))return false;
    const protocol=normalizeMessageContent(raw.message)?.protocolMessage;
    if(protocol?.type===proto.Message.ProtocolMessage.Type.REVOKE) {this.store.delete(this.account!,m.group,protocol.key?.id ?? '');return false;}
    if(protocol?.type===proto.Message.ProtocolMessage.Type.MESSAGE_EDIT) {
      this.store.edit(this.account!,m.group,protocol.key?.id ?? '',textOf(protocol.editedMessage),protocol.timestampMs ? Math.floor(Number(protocol.timestampMs)/1000) : m.timestamp);return false;
    }
    if(raw.messageStubType===WAMessageStubType.REVOKE){this.store.delete(this.account!,m.group,m.id);return false;}
    if(isMessageMutation(raw) && m.text)this.store.edit(this.account!,m.group,m.id,m.text,m.timestamp);
    return this.store.capture(this.account!,{id:m.id,chat:m.group,sender:m.fromMe ? this.account! : m.sender || 'unknown',senderAlt:m.senderAlt,senderName:raw.pushName ?? undefined,timestamp:m.timestamp,text:m.text,fromMe:m.fromMe,bot:m.fromMe && this.isBot(m.group,m.id),replyId:m.quotedId});
  }
  import(messages:WAMessage[]) {
    if(!this.enabled)return;
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      for(const raw of messages){this.capture(raw);const chat=raw.key.remoteJid;if(chat && this.chatAllowed(chat))this.store.importState(this.account!,chat,'received');}
      this.store.db.exec('COMMIT');
    }catch(error){this.store.db.exec('ROLLBACK');throw error;}
  }
  update(updates:WAMessageUpdate[]) {
    if(!this.enabled)return;
    for(const {key,update} of updates) {
      if(!key.remoteJid || !key.id || !this.chatAllowed(key.remoteJid))continue;
      if(update.messageStubType===WAMessageStubType.REVOKE)this.store.delete(this.account!,key.remoteJid,key.id);
      else if(update.message) this.store.edit(this.account!,key.remoteJid,key.id,textOf(update.message),Number(update.messageTimestamp ?? Math.floor(Date.now()/1000)));
    }
  }
  delete(event:{keys:WAMessageKey[]}|{jid:string;all:true}) {
    if(!this.enabled)return;
    if('keys' in event) {
      for(const key of event.keys)if(key.remoteJid && key.id && this.chatAllowed(key.remoteJid))this.store.delete(this.account!,key.remoteJid,key.id);
    }else if(this.chatAllowed(event.jid))this.store.clearChat(this.account!,event.jid);
  }
  async requestRecent(raw:WAMessage,fetch:(count:number,key:WAMessageKey,timestamp:number)=>Promise<unknown>) {
    if(!this.enabled || !this.options.importRecent)return;
    const m=normalize(raw);if(!this.chatAllowed(m.group) || !m.id || !m.timestamp)return;
    const account=this.account!;
    const state=this.store.importState(account,m.group);
    if(state!=='not_requested')return;
    this.store.importState(account,m.group,'requested');
    try{await fetch(50,raw.key,m.timestamp);}catch{this.store.importState(account,m.group,'unavailable');}
  }
  prune() {
    const now=Math.floor(Date.now()/1000);if(now-this.lastPrune<900)return;
    this.store.prune(now);this.lastPrune=now;
  }
  reference(message:Incoming):HistoryReference|undefined {
    if(!this.enabled || !this.chatAllowed(message.group))return;
    const token=this.store.scope(this.account!,message.group,message.id,message.timestamp);if(!token)return;
    const compiled=fileURLToPath(new URL('./history-cli.js',import.meta.url));
    const script=existsSync(compiled) ? [compiled] : ['--import',import.meta.resolve('tsx'),fileURLToPath(new URL('./history-cli.ts',import.meta.url))];
    return {accountId:this.account!,chatId:message.group,triggerMessageId:message.id,quotedMessageId:message.quotedId,readCommand:[process.execPath,...script,'--database',this.path,'--scope',token],retentionDays:this.options.retentionDays,maxPromptChars:this.options.maxPromptChars,complete:false};
  }
}
