import test from 'node:test';
import assert from 'node:assert/strict';
import {config,chat,owner,own,setup} from './conversation-support.js';
import {ThreadUnavailableError} from '../src/t3.js';
const data=(prompt:string)=>JSON.parse(prompt.split('\n\n').at(-1)!);

test('each new personal chat, group and self-chat gets its own No project conversation',async t=>{
  const s=setup(t);
  for (const jid of [chat,'300@g.us',owner]) s.bridge.accept(own(jid,'@bot hi',undefined,jid),[owner]);
  await s.bridge.submitQueued();
  assert.equal(s.calls.length,3);assert.ok(s.calls.every(c=>c.project==='/general' && !c.thread));
  assert.equal(new Set(s.calls.map(c=>c.threadId)).size,3);
  assert.match(s.calls[0].prompt,/Respond naturally/);
});
test('unreplied messages each start a fresh conversation, even rapid ones',async t=>{
  const s=setup(t);
  for (const [id,text] of [['one','@bot #website investigate'],['two','@bot explain tests too'],['three','@bot then fix it']]) s.bridge.accept(own(id,text),[owner]);
  await s.bridge.submitQueued();assert.equal(s.calls.length,3);
  assert.ok(s.calls.every(c=>c.project==='/general' && c.thread===undefined));
  s.finish();await s.bridge.collectResults();s.bridge.accept(own('later','@bot what did you find?'),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls[3].thread,undefined);
});
test('replying to a bot response continues its conversation across restart, even when project hints change',async t=>{
  const s=setup(t);s.bridge.accept(own('first','@bot #website investigate checkout'),[owner]);await s.bridge.submitQueued();
  s.finish();await s.bridge.collectResults();const reply=s.store.pending()[0];s.restart();
  s.bridge.accept(own('follow','@bot #mobile compare this with the mobile flow',reply.id),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls[1].project,'/general');assert.equal(s.calls[1].thread,'t1');
  assert.equal(data(s.calls[1].prompt).projectContext.projects[0].target,'/mobile');
});
test('an unprefixed reply to a bot response also continues its conversation',async t=>{
  const s=setup(t);s.bridge.accept(own('old','@bot hi'),[owner]);await s.bridge.submitQueued();s.finish();await s.bridge.collectResults();const reply=s.store.pending()[0];
  s.bridge.accept(own('fresh','@bot another topic'),[owner]);await s.bridge.submitQueued();
  s.bridge.accept(own('reply','what were we discussing?',reply.id),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls[1].thread,undefined);assert.equal(s.calls[2].thread,'t1');
});
test('replies sent while the first turn is running wait and then share its thread',async t=>{
  const s=setup(t);s.bridge.accept(own('one','@bot investigate'),[owner]);await s.bridge.submitQueued();
  s.finish();await s.bridge.collectResults();const reply=s.store.pending()[0];
  s.bridge.accept(own('two','@bot explain tests too',reply.id),[owner]);await s.bridge.submitQueued();
  s.bridge.accept(own('three','@bot then fix it',reply.id),[owner]);await s.bridge.submitQueued();assert.equal(s.calls.length,2);
  s.finish();await s.bridge.collectResults();await s.bridge.submitQueued();
  assert.equal(s.calls.length,3);assert.ok(s.calls.slice(1).every(c=>c.thread==='t1'));
});
test('explicit hints override chat mappings in the prompt',async t=>{
  const s=setup(t);s.store.mapChat(chat,'/website');
  s.bridge.accept(own('first','@bot #mobile save this to my todo thread'),[owner]);await s.bridge.submitQueued();
  assert.deepEqual(data(s.calls[0].prompt).projectContext,{source:'message',projects:[{name:'mobile',target:'/mobile'}]});
  s.finish();await s.bridge.collectResults();s.bridge.accept(own('next','@bot show pending todos'),[owner]);await s.bridge.submitQueued();
  assert.deepEqual(data(s.calls[1].prompt).projectContext,{source:'mapping',projects:[{name:'website',target:'/website'}]});
  assert.equal(s.store.chatProject(chat),'/website');
});
test('mapping and unmapping change the project hint without breaking replies',async t=>{
  const s=setup(t);s.bridge.accept(own('first','@bot hi'),[owner]);await s.bridge.submitQueued();s.finish();await s.bridge.collectResults();const reply=s.store.pending()[0];
  s.bridge.accept(own('map','@bot use website for this chat'),[owner]);
  s.bridge.accept(own('follow','@bot investigate checkout',reply.id),[owner]);await s.bridge.submitQueued();assert.equal(s.calls[1].thread,'t1');
  assert.equal(data(s.calls[1].prompt).projectContext.projects[0].target,'/website');
  s.finish();await s.bridge.collectResults();s.bridge.accept(own('unmap','@bot unmap this chat'),[owner]);
  s.bridge.accept(own('last','@bot thanks',reply.id),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls[2].thread,'t1');assert.equal(data(s.calls[2].prompt).projectContext,undefined);
});
test('new is no longer a control command and is forwarded like any message',async t=>{
  const s=setup(t);s.store.mapChat(chat,'/website');s.bridge.accept(own('first','@bot hi'),[owner]);await s.bridge.submitQueued();s.finish();await s.bridge.collectResults();
  s.bridge.accept(own('reset','@bot new'),[owner]);s.bridge.accept(own('natural','@bot new thread in the website project, please'),[owner]);await s.bridge.submitQueued();
  assert.equal(s.store.tasks('control').length,0);assert.equal(s.store.chatProject(chat),'/website');
  assert.deepEqual(s.calls.slice(1).map(c=>[c.thread,data(c.prompt).instruction]),[[undefined,'new'],[undefined,'new thread in the website project, please']]);
});
test('a failed submission does not block the next message',async t=>{
  const s=setup(t);const submit=s.t3.submit;s.t3.submit=async()=>{throw new Error('T3 unavailable');};
  s.bridge.accept(own('lost','@bot hi'),[owner]);await s.bridge.submitQueued();assert.equal(s.store.tasks('review').length,1);
  const failure=s.store.pending()[0];assert.match(failure.text,/Could not confirm submission/);s.t3.submit=submit;
  s.bridge.accept(own('next','@bot hi'),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls.length,1);assert.equal(s.calls[0].thread,undefined);
  s.bridge.accept(own('reply','@bot try again',failure.id),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls.length,1,'a reply to an ambiguous submission is held, not duplicated');
  assert.match(s.store.pending().at(-1)!.text,/not a reply/);
});
test('ambiguous earlier submissions block replies instead of creating a duplicate conversation',async t=>{
  const s=setup(t);s.bridge.accept(own('first','@bot fix it'),[owner]);await s.bridge.submitQueued();s.finish();await s.bridge.collectResults();
  const reply=s.store.pending()[0];s.store.setState(s.store.tasks('completed')[0].id,'review');
  s.bridge.accept(own('follow','@bot explain more',reply.id),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls.length,1);assert.equal(s.store.tasks('review').length,2);
});
test('legacy routing requests are held for review and not resumed',async t=>{
  const s=setup(t);s.store.add('legacy',own('old','@bot ~todo save this'),'/general');
  s.bridge.accept(own('fresh','@bot hello'),[owner]);await s.bridge.submitQueued();
  assert.equal(s.store.task('legacy')?.state,'review');assert.equal(s.calls.length,1);assert.equal(s.calls[0].thread,undefined);
});
test('old project-bound bot replies cannot pull the new conversation back into that project',async t=>{
  const s=setup(t);s.store.add('legacy',own('old','@bot fix'),'/website','old-thread','completed');s.store.outgoing('old-ack',s.store.task('legacy')!,'Done');
  s.bridge.accept(own('fresh','@bot explain more','old-ack'),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls[0].project,'/general');assert.equal(s.calls[0].thread,undefined);
});
test('the legacy rememberContext flag cannot make unreplied messages continue',async t=>{
  const s=setup(t,{...config,rememberContext:true});s.bridge.accept(own('one','@bot hi'),[owner]);await s.bridge.submitQueued();s.finish();await s.bridge.collectResults();
  s.bridge.accept(own('two','@bot thanks'),[owner]);await s.bridge.submitQueued();assert.equal(s.calls[1].thread,undefined);
});
test('unsupported media cannot change a chat mapping',async t=>{
  const s=setup(t);s.store.mapChat(chat,'/website');
  s.bridge.accept({...own('attachment','@bot hi'),hasMedia:true},[owner]);
  s.bridge.accept({...own('mapping','@bot use mobile for this chat'),hasMedia:true},[owner]);
  assert.equal(s.store.chatProject(chat),'/website');assert.equal(s.store.tasks('unsupported').length,2);assert.equal(s.calls.length,0);
});

test('replying to a settled conversation starts fresh while retaining the mapping hint and quoted text',async t=>{
  const s=setup(t);s.store.mapChat(chat,'/website');s.bridge.accept(own('first','@bot hi'),[owner]);await s.bridge.submitQueued();
  s.finish();await s.bridge.collectResults();const reply=s.store.pending()[0];s.settle();s.restart();
  s.bridge.accept(own('next','@bot save this',reply.id,chat,'Checkout needs a fix'),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls.length,2);assert.equal(s.calls[1].project,'/general');assert.equal(s.calls[1].thread,undefined);
  assert.equal(data(s.calls[1].prompt).quotedContext,'Checkout needs a fix');assert.equal(data(s.calls[1].prompt).projectContext.projects[0].target,'/website');
});
test('replying to a deleted conversation starts fresh without sending to its old thread',async t=>{
  const s=setup(t);s.bridge.accept(own('first','@bot hi'),[owner]);await s.bridge.submitQueued();s.finish();await s.bridge.collectResults();const reply=s.store.pending()[0];
  s.t3.show=async thread=>{throw new ThreadUnavailableError(thread);};
  s.bridge.accept(own('reply','explain more',reply.id),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls.length,2);assert.equal(s.calls[1].thread,undefined);assert.equal(s.calls[1].project,'/general');
  assert.equal(s.store.tasks('review').length,0);assert.equal(s.errors.length,0);
});
test('a failed settlement lookup never sends to the old thread or starts duplicate work',async t=>{
  const s=setup(t);s.bridge.accept(own('first','@bot hi'),[owner]);await s.bridge.submitQueued();s.finish();await s.bridge.collectResults();const reply=s.store.pending()[0];
  s.bridge.accept(own('next','@bot continue',reply.id),[owner]);s.t3.show=async()=>{throw new Error('T3 unavailable');};
  await s.bridge.submitQueued();await s.bridge.submitQueued();assert.equal(s.calls.length,1);assert.equal(s.store.tasks('review').length,1);
  assert.ok(s.store.pending().some(m=>m.text.includes('No message was sent')));
});
test('shutdown during settlement lookup does not submit another turn',async t=>{
  const s=setup(t);s.bridge.accept(own('first','@bot hi'),[owner]);await s.bridge.submitQueued();s.finish();await s.bridge.collectResults();const reply=s.store.pending()[0];
  s.bridge.accept(own('next','@bot continue',reply.id),[owner]);let enabled=true;const show=s.t3.show;
  s.t3.show=async thread=>{const snapshot=await show(thread);enabled=false;return snapshot;};
  await s.bridge.submitQueued(()=>enabled);assert.equal(s.calls.length,1);assert.equal(s.store.tasks('queued').length,1);
});

test('bare mentions greet naturally without authorizing earlier work',async t=>{
  const s=setup(t);assert.equal(s.bridge.accept(own('mention','  @BOT  '),[owner]),true);await s.bridge.submitQueued();
  const payload=data(s.calls[0].prompt);assert.equal(payload.mentionOnly,'greeting');assert.match(payload.instruction,/Greet/);
  assert.match(s.calls[0].prompt,/Do not infer a task/);assert.equal(s.calls[0].project,'/general');
  s.finish();await s.bridge.collectResults();s.bridge.accept(own('next','@bot'),[owner]);await s.bridge.submitQueued();assert.equal(s.calls[1].thread,undefined);
});
test('thread names, todo requests and new-thread requests are forwarded as natural language',async t=>{
  const s=setup(t);const instruction='create a thread in Diskovalist and add this to my Launch planning thread';
  s.bridge.accept(own('natural','@bot '+instruction,'issue',chat,'Improve the logo'),[owner]);await s.bridge.submitQueued();
  assert.equal(data(s.calls[0].prompt).instruction,instruction);assert.equal(data(s.calls[0].prompt).quotedContext,'Improve the logo');
  assert.match(s.calls[0].prompt,/available T3 tools/);assert.match(s.calls[0].prompt,/Default delivery is T3/);
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
test('mention-only replies answer quoted questions without promoting them to commands',async t=>{
  const s=setup(t);assert.equal(s.bridge.accept(own('mention','@bot','question',chat,'Who created this assistant?'),[owner]),true);await s.bridge.submitQueued();
  const payload=data(s.calls[0].prompt);assert.equal(payload.mentionOnly,'quoted');assert.equal(payload.quotedContext,'Who created this assistant?');
  assert.match(payload.instruction,/do not execute actions/);assert.match(s.calls[0].prompt,/Return kind reply only/);
});
test('a missing quoted body stays a quoted mention and requests lookup rather than greeting',async t=>{
  const s=setup(t);s.bridge.accept(own('mention','@bot','missing-body'),[owner]);await s.bridge.submitQueued();
  assert.equal(data(s.calls[0].prompt).mentionOnly,'quoted');assert.match(s.calls[0].prompt,/ask the user to resend/);
});
test('empty unauthenticated mentions and blank replies are still ignored',async t=>{
  const s=setup(t);assert.equal(s.bridge.accept({...own('foreign','@bot'),fromMe:false},[owner]),false);
  assert.equal(s.bridge.accept(own('wrong-account','@bot'),['999@s.whatsapp.net']),false);
  s.bridge.accept(own('first','@bot hello'),[owner]);await s.bridge.submitQueued();s.finish();await s.bridge.collectResults();
  assert.equal(s.bridge.accept(own('blank','  ',s.store.pending()[0].id),[owner]),false);
});
