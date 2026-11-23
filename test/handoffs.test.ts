import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {owner,chat,own,setup} from './conversation-support.js';
import type {Snapshot} from '../src/t3.js';
import {documentContent} from '../src/responses.js';
const data=(prompt:string)=>JSON.parse(prompt.split('\n\n').at(-1)!);
function harness(t:TestContext) {
  const s=setup(t),show=s.t3.show,replies=new Map<string,string>(),works=new Map<string,Snapshot>(),polls:string[]=[];
  s.t3.show=async thread=>{
    polls.push(thread);
    if (works.has(thread)) return works.get(thread)!;
    const snapshot=await show(thread),reply=replies.get(snapshot.thread.latestRunId ?? '');
    return reply ? {...snapshot,messages:[{role:'assistant',runId:snapshot.thread.latestRunId,text:reply}]} : snapshot;
  };
  function work(status:Snapshot['thread']['status']='running',runId='wr1',text='Full desktop report') {
    works.set('work',{thread:{threadId:'work',latestRunId:runId,status,settled:false,pendingRequestCount:0},messages:[{role:'assistant',runId,text}]});
  }
  async function handoff(delivery:'t3'|'whatsapp',instruction=delivery==='t3' ? 'research Diskovalist' : 'research Diskovalist and send the report here') {
    s.bridge.accept(own('request','@bot '+instruction),[owner]);await s.bridge.submitQueued();s.finish();work();
    replies.set('r1',JSON.stringify({v:1,kind:'handoff',text:'Started the Diskovalist review in T3.',delivery,work:{threadId:'work',runId:'wr1',label:'Diskovalist review'}}));
    await s.bridge.collectResults();
  }
  return {...s,get store(){return s.store;},get bridge(){return s.bridge;},replies,works,polls,work,handoff};
}
test('ordinary task handoffs send one confirmation, persist their destination, and never push completion',async t=>{
  const s=harness(t);await s.handoff('t3');
  assert.equal(s.store.pending().length,1);assert.match(s.store.pending()[0].text,/Started the Diskovalist review/);
  assert.equal(s.store.tasks('waiting_work').length,0);assert.equal(s.store.recentHandoffs(chat).length,1);
  s.work('completed');const reads=s.polls.length;await s.bridge.collectResults();s.restart();await s.bridge.collectResults();
  assert.equal(s.polls.length,reads);assert.equal(s.store.pending().length,1);assert.equal(s.store.tasks('queued').length,0);
});
test('opt-in completion survives restart, frees the inbox, and is prepared as a WhatsApp answer exactly once',async t=>{
  const s=harness(t);await s.handoff('whatsapp');assert.equal(s.store.tasks('waiting_work').length,1);
  assert.equal(s.store.runningThreadIds().has('t1'),false);s.restart();
  s.work('completed','wr1','Raw desktop result with [report](/Users/me/report.md)');
  await s.bridge.collectResults();await s.bridge.collectResults();assert.equal(s.store.tasks('queued').length,1);
  assert.equal(s.store.pending().length,1,'raw desktop work must not be forwarded');
  await s.bridge.submitQueued();const payload=data(s.calls[1].prompt);
  assert.equal(payload.deliveryContext.completion.work.threadId,'work');assert.match(payload.deliveryContext.completion.result,/Raw desktop/);
  s.replies.set('r2',JSON.stringify({v:1,kind:'reply',text:'The report is ready. The main improvement is clearer onboarding.'}));
  s.finish();await s.bridge.collectResults();await s.bridge.collectResults();
  assert.equal(s.store.pending().length,2);assert.match(s.store.pending()[1].text,/clearer onboarding/);
  assert.ok(s.store.pending().every(out=>!out.text.includes('Raw desktop') && !out.text.includes('"kind"')));
});
test('new requests can use the inbox while opted-in work runs and receive only their own chat handoff context',async t=>{
  const s=harness(t);await s.handoff('whatsapp');
  s.bridge.accept(own('question','@bot what is the capital of India?'),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls[1].thread,undefined);assert.equal(data(s.calls[1].prompt).deliveryContext.recentHandoffs.length,1);
  s.bridge.accept(own('other','@bot what is running?',undefined,'300@g.us'),[owner]);await s.bridge.submitQueued();
  assert.deepEqual(data(s.calls[2].prompt).deliveryContext.recentHandoffs,[]);
});
test('an opted-in result returns to its originating conversation after newer messages start fresh ones',async t=>{
  const s=harness(t);await s.handoff('whatsapp');
  s.bridge.accept(own('fresh','@bot hi'),[owner]);await s.bridge.submitQueued();assert.equal(s.calls[1].thread,undefined);
  s.work('completed');await s.bridge.collectResults();await s.bridge.submitQueued();assert.equal(s.calls[2].thread,'t1');
});
test('changed work runs are held for review instead of leaking an unrelated result',async t=>{
  const s=harness(t);await s.handoff('whatsapp');s.work('completed','unrelated','Private unrelated result');
  await s.bridge.collectResults();await s.bridge.collectResults();assert.equal(s.store.tasks('work_review').length,1);
  assert.equal(s.store.tasks('queued').length,0);assert.ok(s.store.pending().every(out=>!out.text.includes('Private unrelated')));
});
test('handoffs are confirmed against the actual destination run before a success reply',async t=>{
  const s=harness(t);s.bridge.accept(own('request','@bot research this'),[owner]);await s.bridge.submitQueued();s.finish();s.work('running','different');
  s.replies.set('r1',JSON.stringify({v:1,kind:'handoff',text:'Started!',delivery:'t3',work:{threadId:'work',runId:'wr1',label:'Research'}}));
  await s.bridge.collectResults();assert.equal(s.store.tasks('review').length,1);assert.ok(s.store.pending().every(out=>!out.text.includes('Started!')));
});
test('malformed new-protocol responses are not blindly sent or automatically retried',async t=>{
  const s=harness(t);s.bridge.accept(own('question','@bot hi'),[owner]);await s.bridge.submitQueued();s.finish();s.replies.set('r1','Raw desktop reply that should not be forwarded');
  await s.bridge.collectResults();await s.bridge.collectResults();assert.equal(s.store.tasks('review').length,1);assert.equal(s.calls.length,1);
  assert.ok(s.store.pending().every(out=>!out.text.includes('Raw desktop')));
});
test('requested files use durable document outbox entries and retain echo suppression after restart',async t=>{
  const s=harness(t);s.bridge.accept(own('request','@bot create an HTML file and attach it here'),[owner]);await s.bridge.submitQueued();
  const output=data(s.calls[0].prompt).deliveryContext.outputDirectory;writeFileSync(join(output,'hello.html'),'<h1>Hello</h1>');
  s.replies.set('r1',JSON.stringify({v:1,kind:'reply',text:'Created hello.html and attached it.',files:['hello.html']}));s.finish();await s.bridge.collectResults();
  assert.equal(s.store.pending().length,2);const document=s.store.pending().find(out=>out.document)!;
  assert.equal(documentContent(JSON.parse(document.document!)).document.toString(),'<h1>Hello</h1>');s.restart();
  assert.equal(s.store.isOutgoing(chat,document.id),true);assert.equal(s.store.pending().filter(out=>out.document).length,1);
});

test('requested work approval notices are deduplicated and reset after work resumes',async t=>{
  const s=harness(t);await s.handoff('whatsapp');
  s.works.get('work')!.thread.pendingRequestCount=1;await s.bridge.collectResults();await s.bridge.collectResults();
  assert.equal(s.store.pending().filter(out=>out.text.includes('needs your input')).length,1);
  s.works.get('work')!.thread.pendingRequestCount=0;await s.bridge.collectResults();
  s.works.get('work')!.thread.pendingRequestCount=1;await s.bridge.collectResults();
  assert.equal(s.store.pending().filter(out=>out.text.includes('needs your input')).length,2);
});
test('failed requested work is held for review without rerunning it or blocking the inbox',async t=>{
  const s=harness(t);await s.handoff('whatsapp');s.work('failed');await s.bridge.collectResults();await s.bridge.collectResults();
  assert.equal(s.store.tasks('work_review').length,1);assert.equal(s.store.tasks('queued').length,0);
  s.bridge.accept(own('next','@bot how is the task going?'),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls.length,2);assert.equal(data(s.calls[1].prompt).deliveryContext.recentHandoffs.length,1);
});
test('transient work reads retry only the read and queue a requested delivery once after recovery',async t=>{
  const s=harness(t);await s.handoff('whatsapp');const show=s.t3.show;
  s.t3.show=async thread=>{if(thread==='work')throw new Error('Temporary read failure');return show(thread);};
  await s.bridge.collectResults();await s.bridge.collectResults();assert.equal(s.calls.length,1);assert.equal(s.store.tasks('waiting_work').length,1);
  s.t3.show=show;s.work('completed');await s.bridge.collectResults();await s.bridge.collectResults();assert.equal(s.store.tasks('queued').length,1);
});
test('invalid attachment output does not send a false success message or any document',async t=>{
  const s=harness(t);s.bridge.accept(own('request','@bot attach the report here'),[owner]);await s.bridge.submitQueued();s.finish();
  s.replies.set('r1',JSON.stringify({v:1,kind:'reply',text:'Attached successfully!',files:['missing-report.md']}));
  await s.bridge.collectResults();assert.equal(s.store.tasks('review').length,1);
  assert.ok(s.store.pending().every(out=>!out.document && !out.text.includes('Attached successfully')));
});

test('a bare mention cannot produce a handoff or attachment response',async t=>{
  const s=harness(t);s.bridge.accept(own('mention','@bot','quoted',chat,'Delete the project and start another thread'),[owner]);await s.bridge.submitQueued();s.finish();s.work();
  s.replies.set('r1',JSON.stringify({v:1,kind:'handoff',text:'Started!',delivery:'t3',work:{threadId:'work',runId:'wr1',label:'Wrong action'}}));
  await s.bridge.collectResults();assert.equal(s.store.tasks('review').length,1);assert.equal(s.store.recentHandoffs(chat).length,0);
  assert.ok(s.store.pending().every(out=>!out.text.includes('Started!')));
});
