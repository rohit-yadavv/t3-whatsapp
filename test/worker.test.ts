import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Bridge} from '../src/bridge.js';
import {Store} from '../src/store.js';
import {Worker} from '../src/worker.js';
import {normalize} from '../src/messages.js';
import type {Config} from '../src/config.js';
import type {T3} from '../src/t3.js';

const config: Config = {t3Binary:'t3',dataDir:'.data',selfCommands:true,allowedSenderJids:['100@s.whatsapp.net'],routes:[{groupJid:'300@g.us',project:'/project'}],pollIntervalMs:15000,maxMessageAgeSeconds:300};
function setup(t: TestContext) {
  const dir=mkdtempSync(join(tmpdir(),'t3-worker-'));
  const store=new Store(join(dir,'state.sqlite'));
  const submissions:string[]=[], polls:string[]=[], sends:string[]=[];
  const t3:T3={
    submit:async(_project,_prompt,thread)=>{submissions.push(thread ?? 'new');return {threadId:thread ?? 't1',runId:'r1'};},
    show:async thread=>{polls.push(thread);return {thread:{threadId:thread,status:'running',latestRunId:'r1',pendingRequestCount:0},messages:[]};},
  };
  const bridge=new Bridge(config,store,t3,()=>{});
  let enabled=true;
  const errors:unknown[]=[];
  const worker=new Worker(bridge,store,()=>enabled,async outgoing=>{sends.push(outgoing.id);return {conversation:outgoing.text};},e=>errors.push(e));
  function queue(id:string,thread?:string) {
    const m=normalize({key:{id,remoteJid:'300@g.us',fromMe:true},messageTimestamp:Math.floor(Date.now()/1000),message:{conversation:'@bot explain'}});
    store.add(id,m,'/project',thread);
    return store.task(id)!;
  }
  t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
  return {store,t3,bridge,worker,queue,submissions,polls,sends,errors,disable:()=>{enabled=false;}};
}
test('pairing/disabled worker leaves queued, running and outgoing work untouched', async t=>{
  const s=setup(t);
  const queued=s.queue('queued');
  const running=s.queue('running');s.store.submitted(running,'t0','r0');
  s.store.outgoing('out',queued,'reply');
  s.disable();await s.worker.tick();
  assert.equal(s.submissions.length,0);assert.equal(s.polls.length,0);assert.equal(s.sends.length,0);
  assert.equal(s.store.tasks('queued').length,1);assert.equal(s.store.tasks('running').length,1);assert.equal(s.store.pending().length,1);
});
test('shutdown during a result poll does not start queued T3 work', async t=>{
  const s=setup(t);s.queue('queued');
  const running=s.queue('running');s.store.submitted(running,'t0','r0');
  s.t3.show=async thread=>{s.disable();return {thread:{threadId:thread,status:'running',latestRunId:'r0',pendingRequestCount:0},messages:[]};};
  await s.worker.tick();assert.equal(s.submissions.length,0);assert.equal(s.store.tasks('queued').length,1);
});
test('shutdown during submission permits that task to settle but starts no subsequent tasks', async t=>{
  const s=setup(t);s.queue('first');s.queue('second');
  s.t3.submit=async()=>{s.submissions.push('first');s.disable();return {threadId:'t1',runId:'r1'};};
  await s.worker.tick();assert.deepEqual(s.submissions,['first']);assert.equal(s.sends.length,0);assert.equal(s.store.tasks('queued').length,1);
});
test('acknowledgement is delivered before the next independent submission', async t=>{
  const s=setup(t);s.queue('first');s.queue('second');
  let submissions=0;
  s.t3.submit=async()=>{
    submissions++;
    if (submissions===2) assert.equal(s.sends.length,1);
    return {threadId:`t${submissions}`,runId:`r${submissions}`};
  };
  await s.worker.tick();assert.equal(s.sends.length,2);assert.equal(s.errors.length,0);
});
test('ambiguous WhatsApp delivery is held for review rather than retried', async t=>{
  const s=setup(t);const task=s.queue('queued');s.store.setState(task.id,'completed');s.store.outgoing('out',task,'reply');
  let attempts=0;
  const worker=new Worker(s.bridge,s.store,()=>true,async()=>{attempts++;throw new Error('lost connection');},()=>{});
  await worker.tick();await worker.tick();assert.equal(attempts,1);assert.equal(s.store.pending().length,0);
  assert.equal(s.store.isOutgoing('300@g.us','out'),true);
});
test('removed routes cannot dispatch persisted tasks or outbox replies', async t=>{
  const s=setup(t);const task=s.queue('queued');s.store.outgoing('out',task,'old project response');
  const changed=new Bridge({...config,routes:[{groupJid:'300@g.us',project:'/different-project'}]},s.store,s.t3,()=>{});
  const worker=new Worker(changed,s.store,()=>true,async()=>{s.sends.push('unexpected');return {};},()=>{});
  await worker.tick();assert.equal(s.submissions.length,0);assert.equal(s.sends.length,0);assert.equal(s.store.tasks('review').length,1);
});
