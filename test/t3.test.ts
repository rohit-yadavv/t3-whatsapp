import test from 'node:test';
import assert from 'node:assert/strict';
import { command, T3Cli, ThreadUnavailableError } from '../src/t3.js';
import {mkdtempSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('CLI transport sends exact prompt on stdin without shell interpretation', async () => {
  const input = 'Fix this\n`touch /tmp/should-never-exist`\n$(echo not-a-command)';
  const result = await command(process.execPath, ['-e', 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>console.log(JSON.stringify({input:s})))'], input);
  assert.deepEqual(result,{input});
});
test('CLI transport fails clearly for malformed output and nonzero exits', async () => {
  await assert.rejects(command(process.execPath,['-e','console.log("not json")']),/Unexpected T3 CLI JSON/);
  await assert.rejects(command(process.execPath,['-e','process.exit(2)']),/exited 2/);
  await assert.rejects(command('/missing-t3-binary',[]),/ENOENT/);
});

test('CLI stdout decoder preserves Unicode split across stream chunks', async () => {
  const code='const b=Buffer.from(JSON.stringify({text:"😀"}));const i=b.indexOf(0xf0)+2;process.stdout.write(b.subarray(0,i));setTimeout(()=>process.stdout.end(b.subarray(i)),20)';
  assert.deepEqual(await command(process.execPath,['-e',code]),{text:'😀'});
});
test('CLI output limit terminates excessive output', async () => {
  await assert.rejects(command(process.execPath,['-e','process.stdout.write("x".repeat(1000));setInterval(()=>{},1000)'],'',{maxOutputBytes:100}),/output limit/);
});

test('CLI timeouts kill a child that ignores SIGTERM', async () => {
  const dir=mkdtempSync(join(tmpdir(),'t3-timeout-')),pidFile=join(dir,'pid');
  try {
    const code=`require('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`;
    await assert.rejects(command(process.execPath,['-e',code],'',{timeoutMs:1000,killGraceMs:50}),/timed out/);
    const pid=Number(readFileSync(pidFile,'utf8'));
    await new Promise(resolve=>setTimeout(resolve,150));
    assert.throws(()=>process.kill(pid,0),error=>(error as NodeJS.ErrnoException).code==='ESRCH');
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('adapter rejects malformed snapshots and responses for another thread', async () => {
  const dir=mkdtempSync(join(tmpdir(),'t3-schema-')),binary=join(dir,'fake-t3');
  const respond=(value:unknown)=>writeFileSync(binary,`#!${process.execPath}\nconsole.log(${JSON.stringify(JSON.stringify(value))})\n`,{mode:0o700});
  try {
    const cli=new T3Cli(binary);
    respond({threadId:123,runId:'r1'});
    await assert.rejects(cli.submit('/project','hello'),/Unexpected T3 submission/);
    respond({threadId:'different',runId:'r1'});
    await assert.rejects(cli.submit('/project','hello','expected'),/Unexpected T3 submission/);
    respond({thread:{threadId:'expected'},messages:[]});
    await assert.rejects(cli.show('expected'),/Unexpected T3 thread snapshot/);
    respond({thread:{threadId:'other',status:'completed',latestRunId:'r1',settled:false,pendingRequestCount:0},messages:[]});
    await assert.rejects(cli.show('expected'),/Unexpected T3 thread snapshot/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('adapter retains settlement metadata and rejects snapshots without it',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'t3-settlement-')),binary=join(dir,'fake-t3');
  const respond=(value:unknown)=>writeFileSync(binary,`#!${process.execPath}\nconsole.log(${JSON.stringify(JSON.stringify(value))})\n`,{mode:0o700});
  try {
    const cli=new T3Cli(binary);
    const thread={threadId:'expected',status:'completed',latestRunId:'r1',pendingRequestCount:0};
    respond({thread:{...thread,settled:true},messages:[]});assert.equal((await cli.show('expected')).thread.settled,true);
    respond({thread,messages:[]});await assert.rejects(cli.show('expected'),/Unexpected T3 thread snapshot/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('adapter reports a deleted thread distinctly from other CLI failures',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'t3-unavailable-')),binary=join(dir,'fake-t3');
  const fail=(message:string)=>writeFileSync(binary,`#!${process.execPath}\nconsole.error(${JSON.stringify(message)});process.exit(1)\n`,{mode:0o700});
  try {
    const cli=new T3Cli(binary);
    fail('Thread mcp:gone is no longer available.');
    await assert.rejects(cli.show('mcp:gone'),(error:unknown)=>error instanceof ThreadUnavailableError && error.threadId==='mcp:gone');
    fail('Thread mcp:other is no longer available.');
    await assert.rejects(cli.show('mcp:gone'),(error:unknown)=>!(error instanceof ThreadUnavailableError));
    fail('Could not connect to T3.');
    await assert.rejects(cli.show('mcp:gone'),(error:unknown)=>!(error instanceof ThreadUnavailableError));
  } finally {rmSync(dir,{recursive:true,force:true});}
});
