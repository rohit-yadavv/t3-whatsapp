import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {acquireSetupLock} from '../src/setup-lock.js';
import {setupError} from '../src/setup-errors.js';
import {validateConfig} from '../src/config.js';

function fixture(){const dir=mkdtempSync(join(tmpdir(),'t3-setup-lock-'));return {dir,lock:join(dir,'setup.lock'),clean:()=>rmSync(dir,{recursive:true,force:true})};}
async function exitedPid(){const child=spawn(process.execPath,['-e',''],{stdio:'ignore'});await once(child,'close');return child.pid!;}
const lockModule=pathToFileURL(resolve('src/setup-lock.ts')).href;

test('setup releases its lock on normal shutdown and leaves a replacement owner alone',()=>{
  const f=fixture();
  try {
    const release=acquireSetupLock(f.dir);assert.equal(readFileSync(f.lock,'utf8'),String(process.pid));
    release();release();assert.equal(existsSync(f.lock),false);
    const previous=acquireSetupLock(f.dir);unlinkSync(f.lock);writeFileSync(f.lock,'4242');
    previous();assert.equal(readFileSync(f.lock,'utf8'),'4242');
  } finally {f.clean();}
});

test('a definitely exited setup owner is recovered without changing runtime locks or data',async()=>{
  const f=fixture();
  try {
    writeFileSync(f.lock,String(await exitedPid()));
    writeFileSync(join(f.dir,'run.lock'),'999');writeFileSync(join(f.dir,'session-data'),'unchanged');
    const release=acquireSetupLock(f.dir);
    assert.equal(readFileSync(f.lock,'utf8'),String(process.pid));
    assert.equal(readFileSync(join(f.dir,'run.lock'),'utf8'),'999');
    assert.equal(readFileSync(join(f.dir,'session-data'),'utf8'),'unchanged');
    assert.equal(existsSync(f.lock+'.recovery'),false);release();
  } finally {f.clean();}
});

test('a live or unverifiable setup owner is never removed',()=>{
  const f=fixture();
  try {
    writeFileSync(f.lock,String(process.pid));assert.throws(()=>acquireSetupLock(f.dir),/Setup is already running/);
    assert.equal(readFileSync(f.lock,'utf8'),String(process.pid));
    writeFileSync(f.lock,'private-invalid-record');
    assert.throws(()=>acquireSetupLock(f.dir),error=>{assert.match((error as Error).message,/invalid owner/);assert.doesNotMatch((error as Error).message,/private-invalid-record/);return true;});
    assert.equal(readFileSync(f.lock,'utf8'),'private-invalid-record');
    assert.equal(existsSync(f.lock+'.recovery'),false);
  } finally {f.clean();}
});

test('concurrent recovery launches keep exactly one setup owner',async()=>{
  const f=fixture();
  const children:ReturnType<typeof spawn>[]=[];
  try {
    writeFileSync(f.lock,String(await exitedPid()));
    const launch=()=>{
      const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',`import {acquireSetupLock} from ${JSON.stringify(lockModule)};try{acquireSetupLock(process.argv[1]);console.log('acquired');setInterval(()=>{},1000);}catch{console.log('blocked');}`,f.dir],{stdio:['ignore','pipe','pipe']});
      children.push(child);
      return once(child.stdout!,'data').then(([data])=>String(data).trim());
    };
    const results=await Promise.all([launch(),launch()]);
    assert.equal(results.filter(result=>result==='acquired').length,1);
    assert.equal(results.filter(result=>result==='blocked').length,1);
    assert.equal(children.some(child=>String(child.pid)===readFileSync(f.lock,'utf8')),true);
  } finally {
    await Promise.all(children.map(async child=>{if(child.exitCode===null&&child.signalCode===null){const closed=once(child,'close');child.kill('SIGKILL');await closed;}}));f.clean();
  }
});

test('the exit handler releases setup locks even without an explicit server close',async()=>{
  const f=fixture();
  try {
    const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',`import {acquireSetupLock} from ${JSON.stringify(lockModule)};acquireSetupLock(process.argv[1]);`,f.dir],{stdio:'ignore'});
    const [code]=await once(child,'close');assert.equal(code,0);assert.equal(existsSync(f.lock),false);
  } finally {f.clean();}
});

test('startup errors name invalid fields and permission failures without leaking values',()=>{
  try{validateConfig({allowedSenderJids:['private-invalid-account']});assert.fail('Expected validation failure');}
  catch(error){const message=setupError(error);assert.match(message,/allowedSenderJids/);assert.doesNotMatch(message,/private-invalid-account/);}
  assert.match(setupError(new SyntaxError('private JSON contents')),/not valid JSON/);
  assert.doesNotMatch(setupError(new SyntaxError('private JSON contents')),/private JSON/);
  assert.match(setupError(Object.assign(new Error('private file path'),{code:'EACCES'})),/denied permission \(EACCES\)/);
  assert.doesNotMatch(setupError(Object.assign(new Error('private file path'),{code:'EACCES'})),/private file path/);
});
