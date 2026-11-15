import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Bridge} from '../src/bridge.js';
import {Store} from '../src/store.js';
import {Worker} from '../src/worker.js';
import {normalize} from '../src/messages.js';
import type {Config} from '../src/config.js';
import type {T3} from '../src/t3.js';

const owner='100@s.whatsapp.net',chat='200@s.whatsapp.net',group='300@g.us';
const config:Config={t3Binary:'t3',dataDir:'.data',noProject:'/general',rememberContext:false,selfCommands:true,accountWide:true,allowedSenderJids:[owner],projects:{website:'/website','mobile-app':'/mobile'},routes:[],pollIntervalMs:15000,maxMessageAgeSeconds:300};
function own(id:string,text:string,quotedId?:string,jid=chat,quotedText='') {
  return normalize({key:{id,remoteJid:jid,fromMe:true},messageTimestamp:Math.floor(Date.now()/1000),message:{extendedTextMessage:{text,contextInfo:{stanzaId:quotedId,quotedMessage:quotedText ? {conversation:quotedText} : undefined}}}});
}
function setup(t:TestContext,settings:Config=config) {
  const dir=mkdtempSync(join(tmpdir(),'t3-wide-')),path=join(dir,'state.sqlite');
  let store=new Store(path);
  const calls:{project:string;prompt:string;thread?:string}[]=[];
  const t3:T3={
    listThreads:async()=>[],
    submit:async(project,prompt,thread)=>{calls.push({project,prompt,thread});return {threadId:thread ?? `t${calls.length}`,runId:`r${calls.length}`};},
    show:async thread=>({thread:{threadId:thread,status:'running',latestRunId:'r1',pendingRequestCount:0},messages:[]}),
  };
  let bridge=new Bridge(settings,store,t3,()=>{});
  t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
  return {calls,t3,get store(){return store;},get bridge(){return bridge;},restart(){store.close();store=new Store(path);bridge=new Bridge(settings,store,t3,()=>{});}};
}
test('owner commands work in unmapped DMs, groups, LID chats and Message yourself',async t=>{
  const s=setup(t);
  for (const [i,jid] of [chat,group,'400@lid',owner].entries()) assert.equal(s.bridge.accept(own(`m${i}`,'@bot #website explain',undefined,jid),[owner]),true);
  await s.bridge.submitQueued();assert.equal(s.calls.length,4);assert.ok(s.calls.every(c=>c.project==='/website'));
  assert.ok(s.calls.every(c=>JSON.parse(c.prompt.split('\n\n').at(-1)!).instruction==='explain'));
});
test('other participants, broadcasts, channels, stale messages and bot echoes stay blocked',async t=>{
  const s=setup(t);
  assert.equal(s.bridge.accept({...own('other','@bot #website fix'),fromMe:false,sender:'999@s.whatsapp.net'},[owner]),false);
  for(const jid of ['status@broadcast','999@newsletter']) assert.equal(s.bridge.accept(own(jid,'@bot #website fix',undefined,jid),[owner]),false);
  assert.equal(s.bridge.accept({...own('old','@bot #website fix'),timestamp:1},[owner]),false);
  s.bridge.accept(own('task','@bot #website explain'),[owner]);await s.bridge.submitQueued();
  const ack=s.store.pending()[0];assert.equal(s.bridge.accept(own(ack.id,'@bot #website accidental echo'),[owner]),false);
});
test('saved mapping persists; explicit selectors override it for one task only',async t=>{
  const s=setup(t);
  s.bridge.accept(own('map','@bot use website for this chat'),[owner]);
  assert.equal(s.store.chatProject(chat),'/website');
  assert.equal(s.store.tasks('queued').length,0);
  s.restart();
  s.bridge.accept(own('default','@bot explain this'),[owner]);
  s.bridge.accept(own('override','@bot #mobile-app fix this'),[owner]);
  s.bridge.accept(own('still-default','@bot explain tests'),[owner]);
  await s.bridge.submitQueued();assert.deepEqual(s.calls.map(c=>c.project),['/website','/mobile','/website']);
  assert.equal(s.store.chatProject(chat),'/website');
});
test('unmapped requests go straight to No project and retain the quoted issue after restart',async t=>{
  const s=setup(t);
  s.bridge.accept(own('issue','@bot resolve this','their-message',chat,'Checkout fails on mobile'),[owner]);
  assert.equal(s.store.tasks('awaiting_project').length,0);assert.equal(s.store.pending().length,0);
  s.restart();await s.bridge.submitQueued();assert.equal(s.calls.length,1);assert.equal(s.calls[0].project,'/general');
  const payload=JSON.parse(s.calls[0].prompt.split('\n\n').at(-1)!);
  assert.equal(payload.instruction,'resolve this');assert.equal(payload.quotedContext,'Checkout fails on mobile');
});
test('unknown explicit project never falls back to an existing mapping',async t=>{
  const s=setup(t);s.store.mapChat(chat,'/website');
  s.bridge.accept(own('typo','@bot #websit fix'),[owner]);
  await s.bridge.submitQueued();assert.equal(s.calls.length,0);assert.equal(s.store.tasks('awaiting_project').length,0);
});
test('quoted project hashtags cannot override the sender instruction',async t=>{
  const s=setup(t);s.store.mapChat(chat,'/website');
  s.bridge.accept(own('quoted','@bot fix this','their-message',chat,'#mobile-app please fix'),[owner]);
  await s.bridge.submitQueued();assert.equal(s.calls[0].project,'/website');
});
test('existing task replies preserve the project despite changes to the chat mapping',async t=>{
  const s=setup(t);s.bridge.accept(own('first','@bot #website explain'),[owner]);await s.bridge.submitQueued();
  const ack=s.store.pending()[0];s.store.mapChat(chat,'/mobile');
  s.t3.show=async thread=>({thread:{threadId:thread,status:'completed',latestRunId:'r1',pendingRequestCount:0},messages:[{role:'assistant',runId:'r1',text:'Done'}]});
  await s.bridge.collectResults();
  s.bridge.accept(own('follow','explain tests too',ack.id),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls[1].project,'/website');assert.equal(s.calls[1].thread,'t1');
});
test('different project in a task reply requires explicit new-task confirmation',async t=>{
  const s=setup(t);s.bridge.accept(own('first','@bot #website explain'),[owner]);await s.bridge.submitQueued();
  const ack=s.store.pending()[0];
  s.bridge.accept(own('switch','@bot #mobile-app fix the issue',ack.id),[owner]);
  await s.bridge.submitQueued();assert.equal(s.calls.length,1);
  const question=s.store.pending().find(m=>m.text.includes('Start a NEW task'))!;
  assert.ok(question);s.restart();
  assert.equal(s.bridge.accept(own('confirm','new',question.id),[owner]),true);
  await s.bridge.submitQueued();assert.equal(s.calls.length,2);assert.equal(s.calls[1].project,'/mobile');assert.equal(s.calls[1].thread,undefined);
  assert.equal(JSON.parse(s.calls[1].prompt.split('\n\n').at(-1)!).instruction,'fix the issue');
});
test('a pending cross-project confirmation can be cancelled without more work',async t=>{
  const s=setup(t);s.bridge.accept(own('first','@bot #website explain'),[owner]);await s.bridge.submitQueued();const ack=s.store.pending()[0];
  s.bridge.accept(own('switch','@bot #mobile-app fix',ack.id),[owner]);const question=s.store.pending().find(m=>m.text.includes('Start a NEW task'))!;
  s.bridge.accept(own('cancel','cancel',question.id),[owner]);await s.bridge.submitQueued();assert.equal(s.calls.length,1);assert.equal(s.store.tasks('cancelled').length,1);
});
test('project lists and mapping acknowledgements send in an unmapped chat without an AI call',async t=>{
  const s=setup(t);s.bridge.accept(own('list','@bot projects'),[owner]);
  const sends:string[]=[];
  const worker=new Worker(s.bridge,s.store,()=>true,async out=>{sends.push(out.text);return {};},()=>{});
  await worker.tick();assert.equal(s.calls.length,0);assert.equal(sends.length,1);assert.match(sends[0],/#website/);
});
test('unmapping overrides a configured chat mapping and persists',async t=>{
  const s=setup(t,{...config,routes:[{chatJid:chat,project:'/website'}]});
  s.bridge.accept(own('clear','@bot unmap this chat'),[owner]);s.restart();
  s.bridge.accept(own('issue','@bot explain'),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls.length,1);assert.equal(s.calls[0].project,'/general');assert.equal(s.store.tasks('awaiting_project').length,0);
});
test('task references are scoped to the originating chat',async t=>{
  const s=setup(t);s.bridge.accept(own('first','@bot #website explain'),[owner]);await s.bridge.submitQueued();
  const ack=s.store.pending()[0];
  assert.equal(s.bridge.accept(own('foreign','follow up',ack.id,group),[owner]),false);
  s.bridge.accept(own('fresh','@bot #mobile-app explain',ack.id,group),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls[1].project,'/mobile');assert.equal(s.calls[1].thread,undefined);
});

test('invalid explicit projects return an error without offering an automatic project picker',async t=>{
  const s=setup(t);s.bridge.accept(own('bad','@bot #typo fix checkout'),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls.length,0);assert.equal(s.store.tasks('awaiting_project').length,0);
  assert.ok(s.store.pending().every(m=>!m.text.includes('Which project')));
});
test('a corrected project hashtag can continue the quoted original task',async t=>{
  const s=setup(t);s.bridge.accept(own('first','@bot #website explain'),[owner]);await s.bridge.submitQueued();const ack=s.store.pending()[0];
  s.bridge.accept(own('bad','@bot #websit fix tests',ack.id),[owner]);
  s.bridge.accept(own('correct','@bot #website fix tests',ack.id),[owner]);
  assert.equal(s.store.tasks('queued')[0].thread_id,'t1');
});
test('removing a project blocks persisted work and its pending response',async t=>{
  const s=setup(t);s.bridge.accept(own('queued','@bot #website fix'),[owner]);const task=s.store.tasks('queued')[0];s.store.outgoing('old-reply',task,'private old response');
  const changed=new Bridge({...config,projects:{'mobile-app':'/mobile'}},s.store,s.t3,()=>{});
  const sends:string[]=[];await new Worker(changed,s.store,()=>true,async o=>{sends.push(o.text);return {};},()=>{}).tick();
  assert.equal(s.calls.length,0);assert.equal(sends.length,0);assert.equal(s.store.tasks('review').length,1);
});
