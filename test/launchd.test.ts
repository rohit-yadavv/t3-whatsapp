import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AutoStart} from '../src/autostart.js';
import {Setup} from '../src/setup.js';

// Opt-in real launchd validation. All files and fake credentials stay in a temporary
// home; there is no real T3 endpoint, no WhatsApp connection, and no login item left.
test('macOS loads and unloads the native timer',{skip:process.platform!=='darwin'||process.env.T3_TEST_LAUNCHD!=='1'},async()=>{
  const root=mkdtempSync(join(tmpdir(),'t3-launchd-')),data=join(root,'.data'),config=join(root,'config.json');
  mkdirSync(join(data,'auth'),{recursive:true});mkdirSync(join(root,'dist'));
  writeFileSync(join(root,'dist','autostart-entry.js'),'throw new Error("The missing runtime must prevent Node from launching");');
  writeFileSync(config,JSON.stringify({dataDir:data,selfCommands:true,allowedSenderJids:['100@s.whatsapp.net']}));
  writeFileSync(join(data,'auth','creds.json'),JSON.stringify({registered:true,me:{id:'100@s.whatsapp.net'}}));
  const automatic=new AutoStart(new Setup(config),{home:join(root,'home'),root,runtimeFile:join(root,'missing-runtime.json'),build:async()=>{}});
  try {
    const enabled=await automatic.enable();assert.equal(enabled.enabled,true);assert.equal(enabled.loaded,true);
    const disabled=await automatic.disable();assert.equal(disabled.enabled,false);assert.equal(disabled.loaded,false);
  } finally {await automatic.disable();rmSync(root,{recursive:true,force:true});}
});
