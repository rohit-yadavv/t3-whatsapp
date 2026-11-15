import test from 'node:test';
import assert from 'node:assert/strict';
import {parseThreadSelector,matchThreads,isCaptureRequest} from '../src/threads.js';
import {chat,owner,own,setup} from './conversation-support.js';

test('selectors support simple and quoted names without evaluating regular expressions',()=>{
  assert.deepEqual(parseThreadSelector('#website ~todo save this'),{name:'todo',instruction:'#website  save this'});
  assert.deepEqual(parseThreadSelector('~"Launch planning" discuss this'),{name:'Launch planning',instruction:'discuss this'});
  assert.ok(parseThreadSelector('~todo ~bugs fix').error);
  assert.ok(parseThreadSelector('~"unclosed fix').error);
  assert.deepEqual(matchThreads('.*',[{threadId:'a',title:'Todo'}]),[]);
});
test('todo capture intent is explicit and does not classify implementation requests as notes',()=>{
  assert.equal(isCaptureRequest('save this for later'),true);
  assert.equal(isCaptureRequest('add this to my todo list'),true);
  assert.equal(isCaptureRequest('add a login button'),false);
  assert.equal(isCaptureRequest('pick up the checkout issue'),false);
});
test('a named todo thread receives the quoted issue as capture-only',async t=>{
  const s=setup(t);s.threads.set('/website',[{threadId:'todo-id',title:'Todo'}]);
  s.bridge.accept(own('save','@bot #website ~todo save this for later','their-issue',chat,'Checkout is broken'),[owner]);
  await s.bridge.submitQueued();assert.equal(s.calls.length,1);assert.equal(s.calls[0].thread,'todo-id');assert.equal(s.calls[0].project,'/website');
  assert.match(s.calls[0].prompt,/Capture-only request/);assert.match(s.calls[0].prompt,/Do not implement the item, edit files, run commands/);
  const payload=JSON.parse(s.calls[0].prompt.split('\n\n').at(-1)!);assert.equal(payload.quotedContext,'Checkout is broken');
  assert.equal(payload.instruction,'save this for later');
});
test('selecting a thread alone creates no agent turn, and later commands continue it',async t=>{
  const s=setup(t);s.threads.set('/website',[{threadId:'todo-id',title:'Todo'}]);
  s.bridge.accept(own('focus','@bot #website ~todo'),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls.length,0);assert.equal(s.store.context(chat)?.thread_id,'todo-id');
  s.restart();s.bridge.accept(own('follow','@bot show my pending todos'),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls[0].thread,'todo-id');
});
test('thread names are searched inside the active project, not a different chat mapping',async t=>{
  const s=setup(t);s.store.mapChat(chat,'/mobile');s.store.focusChat(chat,'/website');
  s.threads.set('/website',[{threadId:'site-todo',title:'Todo'}]);s.threads.set('/mobile',[{threadId:'mobile-todo',title:'Todo'}]);
  s.bridge.accept(own('save','@bot ~todo save this','issue',chat,'An issue'),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls[0].thread,'site-todo');assert.deepEqual(s.listCalls,['/website']);
});
test('ambiguous thread selection persists and resumes the original request after restart',async t=>{
  const s=setup(t);s.threads.set('/website',[{threadId:'one',title:'Todo'},{threadId:'two',title:'Todo'}]);
  s.bridge.accept(own('save','@bot #website ~todo save this','issue',chat,'Original issue'),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls.length,0);assert.equal(s.store.tasks('awaiting_thread').length,1);assert.equal(s.store.context(chat),undefined);
  const prompt=s.store.pending()[0];s.restart();
  s.bridge.accept(own('pick','2',prompt.id),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls.length,1);assert.equal(s.calls[0].thread,'two');assert.match(s.calls[0].prompt,/Original issue/);
});
test('thread aliases retain their selected ID after a title is renamed',async t=>{
  const s=setup(t);s.threads.set('/website',[{threadId:'one',title:'Todo'}]);
  s.bridge.accept(own('select','@bot #website ~todo'),[owner]);await s.bridge.submitQueued();s.restart();
  s.threads.set('/website',[{threadId:'one',title:'Personal backlog'}]);
  s.bridge.accept(own('again','@bot #website ~todo show pending items'),[owner]);await s.bridge.submitQueued();assert.equal(s.calls[0].thread,'one');
});
test('a missing thread can be corrected through the latest bot prompt',async t=>{
  const s=setup(t);s.threads.set('/website',[{threadId:'todo-id',title:'Todo'}]);
  s.bridge.accept(own('bad','@bot #website ~missing save this','issue',chat,'Original'),[owner]);await s.bridge.submitQueued();
  const prompt=s.store.pending()[0];assert.equal(s.calls.length,0);
  s.bridge.accept(own('correct','~todo',prompt.id),[owner]);await s.bridge.submitQueued();assert.equal(s.calls[0].thread,'todo-id');assert.match(s.calls[0].prompt,/Original/);
});
test('thread list selections focus the chosen conversation without making an agent turn',async t=>{
  const s=setup(t);s.store.focusChat(chat,'/website');s.threads.set('/website',[{threadId:'one',title:'Todo'},{threadId:'two',title:'Bugs'}]);
  s.bridge.accept(own('list','@bot threads'),[owner]);await s.bridge.submitQueued();const question=s.store.pending()[0];
  assert.equal(s.calls.length,0);s.bridge.accept(own('pick','1',question.id),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls.length,0);assert.equal(s.store.context(chat)?.thread_id,'one');assert.equal(s.store.tasks('awaiting_thread').length,0);
});
test('a thread deleted between offering choices and selection never receives work',async t=>{
  const s=setup(t);s.threads.set('/website',[{threadId:'one',title:'Todo'},{threadId:'two',title:'Todo'}]);
  s.bridge.accept(own('request','@bot #website ~todo save this'),[owner]);await s.bridge.submitQueued();const prompt=s.store.pending()[0];
  s.threads.set('/website',[{threadId:'one',title:'Todo'}]);s.bridge.accept(own('pick','2',prompt.id),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls.length,0);assert.equal(s.store.tasks('awaiting_thread').length,1);
});
test('a quoted bot task cannot silently redirect to a different thread selector',async t=>{
  const s=setup(t);s.bridge.accept(own('first','@bot #website explain'),[owner]);await s.bridge.submitQueued();const ack=s.store.pending()[0];
  s.threads.set('/website',[{threadId:'t1',title:'Original'},{threadId:'other',title:'Todo'}]);
  s.bridge.accept(own('redirect','@bot ~todo save this',ack.id),[owner]);await s.bridge.submitQueued();assert.equal(s.calls.length,1);
  assert.ok(s.store.pending().some(m=>m.text.includes('another thread')));
});
test('quoted thread names containing project hashtags cannot select a project',async t=>{
  const s=setup(t);s.store.focusChat(chat,'/website');s.threads.set('/website',[{threadId:'special',title:'Todo #mobile launch'}]);
  s.bridge.accept(own('capture','@bot ~"Todo #mobile launch" save this'),[owner]);await s.bridge.submitQueued();assert.equal(s.calls[0].project,'/website');
});
test('thread lookup failure does not start new work or leave a misleading active context',async t=>{
  const s=setup(t);s.t3.listThreads=async()=>{throw new Error('unavailable');};
  s.bridge.accept(own('lookup','@bot #website ~todo save this'),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls.length,0);assert.equal(s.store.context(chat),undefined);assert.equal(s.store.tasks('review').length,1);
});
