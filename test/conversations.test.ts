import test from 'node:test';
import assert from 'node:assert/strict';
import {config,chat,owner,own,setup} from './conversation-support.js';
const data=(prompt:string)=>JSON.parse(prompt.split('\n\n').at(-1)!);

test('each new personal chat, group and self-chat gets its own No project conversation',async t=>{
  const s=setup(t);
  for (const jid of [chat,'300@g.us',owner]) s.bridge.accept(own(jid,'@bot hi',undefined,jid),[owner]);
  await s.bridge.submitQueued();
  assert.equal(s.calls.length,3);assert.ok(s.calls.every(c=>c.project==='/general' && !c.thread));
  assert.equal(new Set(s.calls.map(c=>c.threadId)).size,3);
  assert.match(s.calls[0].prompt,/Respond naturally/);
});
test('follow-ups reuse their chat conversation across restart, even when project hints change',async t=>{
  const s=setup(t);s.bridge.accept(own('first','@bot #website investigate checkout'),[owner]);await s.bridge.submitQueued();
  s.finish();await s.bridge.collectResults();s.restart();
  s.bridge.accept(own('follow','@bot #mobile compare this with the mobile flow'),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls[1].project,'/general');assert.equal(s.calls[1].thread,'t1');
  assert.equal(data(s.calls[1].prompt).projectContext.projects[0].target,'/mobile');
});
test('rapid follow-ups wait for the first submission and then share its thread',async t=>{
  const s=setup(t);
  for (const [id,text] of [['one','@bot #website investigate'],['two','@bot explain tests too'],['three','@bot then fix it']]) s.bridge.accept(own(id,text),[owner]);
  await s.bridge.submitQueued();assert.equal(s.calls.length,1);
  s.finish();await s.bridge.collectResults();await s.bridge.submitQueued();assert.equal(s.calls.length,2);
  s.finish();await s.bridge.collectResults();await s.bridge.submitQueued();assert.equal(s.calls.length,3);
  assert.ok(s.calls.slice(1).every(c=>c.thread==='t1'));
  assert.equal(s.store.context(chat)?.thread_id,'t1');
});
test('explicit hints override chat mappings in the prompt without changing the conversation',async t=>{
  const s=setup(t);s.store.mapChat(chat,'/website');
  s.bridge.accept(own('first','@bot #mobile save this to my todo thread'),[owner]);await s.bridge.submitQueued();
  assert.deepEqual(data(s.calls[0].prompt).projectContext,{source:'message',projects:[{name:'mobile',target:'/mobile'}]});
  s.finish();await s.bridge.collectResults();s.bridge.accept(own('next','@bot show pending todos'),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls[1].thread,'t1');assert.deepEqual(data(s.calls[1].prompt).projectContext,{source:'mapping',projects:[{name:'website',target:'/website'}]});
  assert.equal(s.store.chatProject(chat),'/website');
});
test('mapping and unmapping preserve the active conversation',async t=>{
  const s=setup(t);s.bridge.accept(own('first','@bot hi'),[owner]);await s.bridge.submitQueued();s.finish();await s.bridge.collectResults();
  s.bridge.accept(own('map','@bot use website for this chat'),[owner]);assert.equal(s.store.context(chat)?.thread_id,'t1');
  s.bridge.accept(own('follow','@bot investigate checkout'),[owner]);await s.bridge.submitQueued();assert.equal(s.calls[1].thread,'t1');
  s.finish();await s.bridge.collectResults();s.bridge.accept(own('unmap','@bot unmap this chat'),[owner]);
  s.bridge.accept(own('last','@bot thanks'),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls[2].thread,'t1');assert.equal(data(s.calls[2].prompt).projectContext,undefined);
});
test('new resets only its chat and retains mapping; older results cannot steal its focus',async t=>{
  const s=setup(t);s.store.mapChat(chat,'/website');s.bridge.accept(own('old','@bot hi'),[owner]);await s.bridge.submitQueued();
  s.bridge.accept(own('other','@bot hi',undefined,'300@g.us'),[owner]);await s.bridge.submitQueued();
  s.bridge.accept(own('reset','@bot new'),[owner]);assert.equal(s.store.context(chat),undefined);assert.equal(s.store.chatProject(chat),'/website');
  s.bridge.accept(own('fresh','@bot investigate'),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls[2].thread,undefined);assert.equal(s.calls[2].project,'/general');
  s.finish('t1');await s.bridge.collectResults();assert.equal(s.store.context(chat)?.thread_id,'t3');
  assert.equal(s.store.context('300@g.us')?.thread_id,'t2');
});
test('replying to an older bot response resumes that conversation after a reset',async t=>{
  const s=setup(t);s.bridge.accept(own('old','@bot hi'),[owner]);await s.bridge.submitQueued();s.finish();await s.bridge.collectResults();const reply=s.store.pending()[0];
  s.bridge.accept(own('reset','@bot new'),[owner]);
  s.bridge.accept(own('fresh','@bot another topic'),[owner]);await s.bridge.submitQueued();
  s.bridge.accept(own('reply','what were we discussing?',reply.id),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls[2].thread,'t1');assert.equal(s.store.context(chat)?.thread_id,'t1');
});
test('thread names, todo requests and new-thread requests are forwarded as natural language',async t=>{
  const s=setup(t);const instruction='create a thread in Diskovalist and add this to my Launch planning thread';
  s.bridge.accept(own('natural','@bot '+instruction,'issue',chat,'Improve the logo'),[owner]);await s.bridge.submitQueued();
  assert.equal(data(s.calls[0].prompt).instruction,instruction);assert.equal(data(s.calls[0].prompt).quotedContext,'Improve the logo');
  assert.match(s.calls[0].prompt,/available T3 tools/);assert.match(s.calls[0].prompt,/wait for and relay/);
  assert.doesNotMatch(s.calls[0].prompt,/Capture-only|in THIS conversation|Only an explicit/);
  s.finish();await s.bridge.collectResults();s.bridge.accept(own('literal','@bot ~"Launch planning" save this for later'),[owner]);await s.bridge.submitQueued();
  assert.equal(data(s.calls[1].prompt).instruction,'~"Launch planning" save this for later');
  assert.equal(s.store.tasks('awaiting_thread').length,0);
});
test('unknown or multiple hashtags are prompt hints for T3 to resolve without bridge menus',async t=>{
  const s=setup(t);s.store.mapChat(chat,'/website');
  s.bridge.accept(own('hints','@bot #unregistered #mobile compare these'),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls[0].project,'/general');
  assert.deepEqual(data(s.calls[0].prompt).projectContext,{source:'message',projects:[{name:'unregistered'},{name:'mobile',target:'/mobile'}]});
  assert.equal(s.store.tasks('control').length,0);
});
test('new project names in ordinary conversation are left for the agent to interpret',async t=>{
  const s=setup(t);s.bridge.accept(own('natural','@bot create a thread in the website project'),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls[0].project,'/general');assert.equal(data(s.calls[0].prompt).projectContext,undefined);
  assert.equal(data(s.calls[0].prompt).instruction,'create a thread in the website project');
});
test('ambiguous earlier submissions block continuation instead of creating a duplicate conversation',async t=>{
  const s=setup(t);s.bridge.accept(own('first','@bot fix it'),[owner]);s.bridge.accept(own('follow','@bot explain more'),[owner]);
  s.store.setState(s.store.tasks('queued')[0].id,'review');await s.bridge.submitQueued();
  assert.equal(s.calls.length,0);assert.equal(s.store.tasks('review').length,2);
});
test('legacy routing requests are held for review and old contexts are not resumed',async t=>{
  const s=setup(t);s.store.add('legacy',own('old','@bot ~todo save this'),'/general');s.store.focusChat(chat,'/general','old-thread','legacy');
  s.bridge.accept(own('fresh','@bot hello'),[owner]);await s.bridge.submitQueued();
  assert.equal(s.store.task('legacy')?.state,'review');assert.equal(s.calls.length,1);assert.equal(s.calls[0].thread,undefined);
});
test('old project-bound bot replies cannot pull the new conversation back into that project',async t=>{
  const s=setup(t);s.store.add('legacy',own('old','@bot fix'),'/website','old-thread','completed');s.store.outgoing('old-ack',s.store.task('legacy')!,'Done');
  s.store.focusChat(chat,'/website','old-thread','legacy');s.bridge.accept(own('fresh','@bot explain more','old-ack'),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls[0].project,'/general');assert.equal(s.calls[0].thread,undefined);
});
test('the legacy rememberContext flag cannot disable the agreed per-chat continuity',async t=>{
  const s=setup(t,{...config,rememberContext:false});s.bridge.accept(own('one','@bot hi'),[owner]);await s.bridge.submitQueued();s.finish();await s.bridge.collectResults();
  s.bridge.accept(own('two','@bot thanks'),[owner]);await s.bridge.submitQueued();assert.equal(s.calls[1].thread,'t1');
});

test('only the exact new control resets context; natural requests starting with new are forwarded',async t=>{
  const s=setup(t);s.bridge.accept(own('first','@bot hi'),[owner]);await s.bridge.submitQueued();s.finish();await s.bridge.collectResults();
  s.bridge.accept(own('natural','@bot new thread in the website project, please'),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls[1].thread,'t1');assert.equal(data(s.calls[1].prompt).instruction,'new thread in the website project, please');
});
test('unsupported media cannot change a chat mapping or reset an active conversation',async t=>{
  const s=setup(t);s.store.mapChat(chat,'/website');s.bridge.accept(own('first','@bot hi'),[owner]);await s.bridge.submitQueued();
  s.bridge.accept({...own('attachment','@bot new'),hasMedia:true},[owner]);
  s.bridge.accept({...own('mapping','@bot use mobile for this chat'),hasMedia:true},[owner]);
  assert.equal(s.store.context(chat)?.thread_id,'t1');assert.equal(s.store.chatProject(chat),'/website');assert.equal(s.store.tasks('unsupported').length,2);
});

test('a settled conversation starts fresh while retaining the mapping hint and quoted request',async t=>{
  const s=setup(t);s.store.mapChat(chat,'/website');s.bridge.accept(own('first','@bot hi'),[owner]);await s.bridge.submitQueued();
  s.finish();await s.bridge.collectResults();s.settle();s.restart();
  s.bridge.accept(own('next','@bot save this','issue',chat,'Checkout needs a fix'),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls.length,2);assert.equal(s.calls[1].project,'/general');assert.equal(s.calls[1].thread,undefined);
  assert.equal(data(s.calls[1].prompt).quotedContext,'Checkout needs a fix');assert.equal(data(s.calls[1].prompt).projectContext.projects[0].target,'/website');
  assert.equal(s.store.context(chat)?.thread_id,'t2');
});
test('replying to a settled bot conversation starts fresh without sending to its old thread',async t=>{
  const s=setup(t);s.bridge.accept(own('first','@bot hi'),[owner]);await s.bridge.submitQueued();s.finish();await s.bridge.collectResults();const reply=s.store.pending()[0];
  s.settle();s.bridge.accept(own('reply','explain more',reply.id),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls[1].thread,undefined);assert.equal(s.calls[1].project,'/general');
});
test('queued follow-ups share the replacement conversation when the old one is settled',async t=>{
  const s=setup(t);s.bridge.accept(own('first','@bot hi'),[owner]);await s.bridge.submitQueued();s.finish();await s.bridge.collectResults();
  s.bridge.accept(own('next','@bot next topic'),[owner]);s.bridge.accept(own('follow','@bot explain that'),[owner]);s.settle();
  await s.bridge.submitQueued();assert.equal(s.calls.length,2);assert.equal(s.calls[1].thread,undefined);
  s.finish('t2');await s.bridge.collectResults();await s.bridge.submitQueued();
  assert.equal(s.calls.length,3);assert.equal(s.calls[2].thread,'t2');
});
test('a failed settlement lookup never sends to the old thread or starts duplicate work',async t=>{
  const s=setup(t);s.bridge.accept(own('first','@bot hi'),[owner]);await s.bridge.submitQueued();s.finish();await s.bridge.collectResults();
  s.bridge.accept(own('next','@bot continue'),[owner]);s.t3.show=async()=>{throw new Error('T3 unavailable');};
  await s.bridge.submitQueued();await s.bridge.submitQueued();assert.equal(s.calls.length,1);assert.equal(s.store.tasks('review').length,1);
  assert.ok(s.store.pending().some(m=>m.text.includes('No message was sent')));
});
test('shutdown during settlement lookup does not submit another turn',async t=>{
  const s=setup(t);s.bridge.accept(own('first','@bot hi'),[owner]);await s.bridge.submitQueued();s.finish();await s.bridge.collectResults();
  s.bridge.accept(own('next','@bot continue'),[owner]);let enabled=true;const show=s.t3.show;
  s.t3.show=async thread=>{const snapshot=await show(thread);enabled=false;return snapshot;};
  await s.bridge.submitQueued(()=>enabled);assert.equal(s.calls.length,1);assert.equal(s.store.tasks('queued').length,1);
});
