import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadConfig,projectCatalog,isSupportedChat} from '../src/config.js';
function read(value:unknown) {
  const dir=mkdtempSync(join(tmpdir(),'t3-config-')),path=join(dir,'config.json');
  try {writeFileSync(path,JSON.stringify(value));return loadConfig(path);}
  finally {rmSync(dir,{recursive:true,force:true});}
}
const base={allowedSenderJids:['100@s.whatsapp.net'],projects:{website:'/website'}};
test('account-wide scope requires the authenticated own-account command mode',()=>{
  assert.throws(()=>read({...base,accountWide:true}),/Account-wide commands require/);
  assert.equal(read({...base,accountWide:true,selfCommands:true}).routes.length,0);
});
test('legacy group routes migrate without losing the project mapping',()=>{
  const c=read({allowedSenderJids:base.allowedSenderJids,routes:[{groupJid:'300@g.us',project:'/website'}]});
  assert.deepEqual(c.routes,[{chatJid:'300@g.us',project:'/website'}]);assert.equal(projectCatalog(c).get('website'),'/website');
});
test('duplicate aliases and chat mappings fail rather than silently choosing a project',()=>{
  assert.throws(()=>read({...base,projects:{Website:'/a',website:'/b'}}),/Duplicate project alias/);
  assert.throws(()=>read({...base,routes:[{chatJid:'200@s.whatsapp.net',project:'/a'},{chatJid:'200@s.whatsapp.net',project:'/b'}]}),/exactly one/);
});
test('supported chat identifiers exclude channels and broadcasts',()=>{
  for(const jid of ['100@s.whatsapp.net','200@lid','300@g.us','100-200@g.us']) assert.equal(isSupportedChat(jid),true);
  for(const jid of ['status@broadcast','300@newsletter','malformed']) assert.equal(isSupportedChat(jid),false);
});

test('No project has a default workspace and a reserved alias',()=>{
  const c=read({allowedSenderJids:['100@s.whatsapp.net']});
  assert.equal(c.noProject,'~/.t3/scratch');assert.equal(projectCatalog(c).get('no-project'),'~/.t3/scratch');
  assert.throws(()=>read({...base,noProject:'/general',projects:{'no-project':'/wrong'}}),/reserved/);
});
