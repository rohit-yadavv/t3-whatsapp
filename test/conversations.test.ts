import test from 'node:test';
import assert from 'node:assert/strict';
import {Bridge} from '../src/bridge.js';
import {config,chat,owner,own,setup} from './conversation-support.js';

test('greetings in unmapped chats receive a No project AI conversation',async t=>{
  const s=setup(t);assert.equal(s.bridge.accept(own('hi','@bot hi'),[owner]),true);
  assert.equal(s.store.tasks('awaiting_project').length,0);
  await s.bridge.submitQueued();assert.equal(s.calls[0].project,'/general');
  assert.match(s.calls[0].prompt,/Respond naturally/);assert.match(s.calls[0].prompt,/general No project conversation/);
});
test('standalone follow-ups retain project and thread after a restart',async t=>{
  const s=setup(t);s.bridge.accept(own('first','@bot #website investigate checkout'),[owner]);await s.bridge.submitQueued();
  s.finish();await s.bridge.collectResults();s.restart();
  s.bridge.accept(own('follow','@bot what did you find?'),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls[1].project,'/website');assert.equal(s.calls[1].thread,'t1');
});
test('rapid follow-ups wait for the initial thread and share it',async t=>{
  const s=setup(t);
  s.bridge.accept(own('one','@bot #website investigate'),[owner]);
  s.bridge.accept(own('two','@bot explain tests too'),[owner]);
  s.bridge.accept(own('three','@bot then fix it'),[owner]);
  await s.bridge.submitQueued();assert.equal(s.calls.length,1);
  s.finish();await s.bridge.collectResults();await s.bridge.submitQueued();assert.equal(s.calls.length,2);
  assert.equal(s.calls[1].thread,'t1');
  s.finish();await s.bridge.collectResults();await s.bridge.submitQueued();assert.equal(s.calls.length,3);
  assert.equal(s.calls[2].thread,'t1');assert.equal(s.store.context(chat)?.thread_id,'t1');
});
test('project focus alone is remembered without creating an empty agent task',async t=>{
  const s=setup(t);s.bridge.accept(own('focus','@bot #website'),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls.length,0);assert.equal(s.store.context(chat)?.project,'/website');
  s.bridge.accept(own('task','@bot explain this'),[owner]);await s.bridge.submitQueued();assert.equal(s.calls[0].project,'/website');
});
test('active project overrides mapping while new resets to the saved mapping',async t=>{
  const s=setup(t);s.store.mapChat(chat,'/website');
  s.bridge.accept(own('mobile','@bot #mobile investigate'),[owner]);await s.bridge.submitQueued();s.finish();await s.bridge.collectResults();
  s.bridge.accept(own('follow','@bot explain more'),[owner]);await s.bridge.submitQueued();assert.equal(s.calls[1].project,'/mobile');assert.equal(s.calls[1].thread,'t1');
  s.bridge.accept(own('reset','@bot new'),[owner]);assert.equal(s.store.context(chat),undefined);assert.equal(s.store.chatProject(chat),'/website');
  s.bridge.accept(own('fresh','@bot explain this'),[owner]);await s.bridge.submitQueued();assert.equal(s.calls[2].project,'/website');assert.equal(s.calls[2].thread,undefined);
});
test('active conversations are isolated between chats',async t=>{
  const s=setup(t);s.bridge.accept(own('site','@bot #website investigate'),[owner]);await s.bridge.submitQueued();
  s.bridge.accept(own('other','@bot hi',undefined,'300@g.us'),[owner]);await s.bridge.submitQueued();assert.equal(s.calls[1].project,'/general');assert.equal(s.calls[1].thread,undefined);
  assert.equal(s.store.context(chat)?.project,'/website');
});
test('removed active projects ask rather than silently selecting another workspace',async t=>{
  const s=setup(t);s.store.focusChat(chat,'/website','old-thread');
  const changed=new Bridge({...config,projects:{mobile:'/mobile'}},s.store,s.t3,()=>{});
  changed.accept(own('follow','@bot fix it'),[owner]);await changed.submitQueued();
  assert.equal(s.calls.length,0);assert.equal(s.store.tasks('awaiting_project').length,1);
});
test('an ambiguous earlier submission prevents automatic continuation',async t=>{
  const s=setup(t);s.bridge.accept(own('first','@bot #website fix'),[owner]);
  s.bridge.accept(own('follow','@bot explain more'),[owner]);
  const first=s.store.tasks('queued')[0];s.store.setState(first.id,'review');
  await s.bridge.submitQueued();assert.equal(s.calls.length,0);assert.equal(s.store.tasks('review').length,2);
});
test('explicit new with an instruction starts another thread in the selected project',async t=>{
  const s=setup(t);s.bridge.accept(own('first','@bot #website explain'),[owner]);await s.bridge.submitQueued();
  s.bridge.accept(own('new','@bot #website new investigate another issue'),[owner]);await s.bridge.submitQueued();
  assert.equal(s.calls.length,2);assert.equal(s.calls[1].thread,undefined);
  assert.equal(JSON.parse(s.calls[1].prompt.split('\n\n').at(-1)!).instruction,'investigate another issue');
});
