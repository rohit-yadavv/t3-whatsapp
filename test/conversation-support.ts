import type {TestContext} from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Bridge} from '../src/bridge.js';
import {Store} from '../src/store.js';
import {normalize} from '../src/messages.js';
import type {Config} from '../src/config.js';
import type {T3,ThreadSummary} from '../src/t3.js';
export const owner='100@s.whatsapp.net',chat='200@s.whatsapp.net';
export const config:Config={t3Binary:'t3',dataDir:'.data',selfCommands:true,accountWide:true,rememberContext:true,noProject:'/general',allowedSenderJids:[owner],projects:{website:'/website',mobile:'/mobile'},routes:[],pollIntervalMs:15000,maxMessageAgeSeconds:300};
export function own(id:string,text:string,quotedId?:string,jid=chat,quotedText='') {
  return normalize({key:{id,remoteJid:jid,fromMe:true},messageTimestamp:Math.floor(Date.now()/1000),message:{extendedTextMessage:{text,contextInfo:{stanzaId:quotedId,quotedMessage:quotedText ? {conversation:quotedText} : undefined}}}});
}
export function setup(t:TestContext,settings:Config=config) {
  const dir=mkdtempSync(join(tmpdir(),'t3-conversation-')),path=join(dir,'state.sqlite');
  let store=new Store(path);
  const calls:{project:string;prompt:string;thread?:string;threadId:string;runId:string}[]=[];
  const threads=new Map<string,ThreadSummary[]>(),listCalls:string[]=[];
  const status=new Map<string,'running'|'completed'>();
  const errors:unknown[]=[];
  const t3:T3={
    listThreads:async project=>{listCalls.push(project);return threads.get(project) ?? [];},
    submit:async(project,prompt,thread)=>{
      const threadId=thread ?? `t${calls.length+1}`,runId=`r${calls.length+1}`;
      calls.push({project,prompt,thread,threadId,runId});
      if (!thread) threads.set(project,[...(threads.get(project) ?? []),{threadId,title:'WhatsApp conversation'}]);
      status.set(threadId,'running');return {threadId,runId};
    },
    show:async thread=>{
      const call=calls.findLast(c=>c.threadId===thread);
      return {thread:{threadId:thread,status:status.get(thread) ?? 'running',latestRunId:call?.runId ?? 'external',pendingRequestCount:0},messages:call ? [{role:'assistant',runId:call.runId,text:'AI response'}] : []};
    },
  };
  let bridge=new Bridge(settings,store,t3,e=>errors.push(e));
  t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
  return {calls,t3,errors,threads,listCalls,get store(){return store;},get bridge(){return bridge;},finish(thread='t1'){status.set(thread,'completed');},restart(){store.close();store=new Store(path);bridge=new Bridge(settings,store,t3,e=>errors.push(e));}};
}
