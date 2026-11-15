import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

const exec=promisify(execFile);
function fixture() {
  const dir=mkdtempSync(join(tmpdir(),'t3-startup-'));
  const config=join(dir,'config.json');
  writeFileSync(config,JSON.stringify({dataDir:dir,allowedSenderJids:['100@s.whatsapp.net'],routes:[{groupJid:'300@g.us',project:'/project'}]}));
  return {dir,env:{...process.env,T3_WHATSAPP_CONFIG:config}};
}
test('a failed startup releases its own lock without connecting to WhatsApp', async () => {
  const {dir,env}=fixture();
  try {
    writeFileSync(join(dir,'bridge.sqlite'),'invalid SQLite file');
    await assert.rejects(exec(process.execPath,['--import','tsx',resolve('src/main.ts')],{env,timeout:10000}));
    assert.equal(existsSync(join(dir,'run.lock')),false);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('a second process gives a useful error and preserves the existing owner lock', async () => {
  const {dir,env}=fixture();
  try {
    const lock=join(dir,'run.lock');writeFileSync(lock,'12345');
    await assert.rejects(exec(process.execPath,['--import','tsx',resolve('src/main.ts')],{env,timeout:10000}),error=>{
      assert.match((error as {stderr:string}).stderr,/already locked \(PID 12345\)/);
      return true;
    });
    assert.equal(readFileSync(lock,'utf8'),'12345');
  } finally {rmSync(dir,{recursive:true,force:true});}
});
