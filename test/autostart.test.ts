import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:http';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AutoStart, autoStartScript, launchAgentPlist} from '../src/autostart.js';
import {backgroundReporter, readBackgroundStatus} from '../src/background-status.js';
import {Setup} from '../src/setup.js';
import {startSetupServer} from '../src/setup-server.js';
import {localT3Available} from '../src/local-t3.js';

const exec=promisify(execFile);
function fixture(configured=true,overrides:Record<string,unknown>={}) {
  const root=mkdtempSync(join(tmpdir(),"t3-auto ' quoted-")),data=join(root,'.data'),config=join(root,'config.json');
  mkdirSync(join(data,'auth'),{recursive:true});mkdirSync(join(root,'dist'));
  writeFileSync(join(root,'dist','autostart-entry.js'),'// built test entry\n');
  if(configured) writeFileSync(config,JSON.stringify({dataDir:data,selfCommands:true,allowedSenderJids:['100@s.whatsapp.net'],...overrides}));
  writeFileSync(join(data,'auth','creds.json'),JSON.stringify({registered:false,me:{id:'100:1@s.whatsapp.net'},secret:'do not expose'}));
  const setup=new Setup(config),calls:string[][]=[];
  let loaded=false,builds=0,failBootstrap=false;
  const automatic=new AutoStart(setup,{
    platform:'darwin',release:'24.0.0',home:join(root,'home'),uid:501,root,
    build:async()=>{builds++;},
    run:async(binary,args)=>{
      calls.push([binary,...args]);
      if(args[0]==='print' && !loaded) throw new Error('not loaded');
      if(args[0]==='bootstrap') {if(failBootstrap) throw new Error('bootstrap refused');loaded=true;}
      if(args[0]==='bootout') loaded=false;
    },
  });
  return {root,data,config,setup,automatic,calls,builds:()=>builds,setBootstrapFailure:(v:boolean)=>{failBootstrap=v;},clean:()=>rmSync(root,{recursive:true,force:true})};
}

test('automatic startup installs a native timer once and pause persists across subsequent loads',async()=>{
  const f=fixture();
  try {
    assert.equal((await f.automatic.status()).installed,false);
    const enabled=await f.automatic.enable();
    assert.equal(enabled.enabled,true);assert.equal(enabled.loaded,true);assert.equal(f.builds(),1);
    assert.equal(statSync(f.automatic.plistPath).mode & 0o777,0o600);
    assert.equal(statSync(f.automatic.directory).mode & 0o777,0o700);
    assert.equal(existsSync(join(f.automatic.directory,'paused')),false);
    await f.automatic.enable();assert.equal(f.builds(),1);
    assert.equal(f.calls.filter(c=>c[1]==='bootstrap').length,1);
    const disabled=await f.automatic.disable();assert.equal(disabled.enabled,false);assert.equal(disabled.loaded,false);assert.equal(existsSync(f.automatic.plistPath),false);
    assert.equal(existsSync(join(f.automatic.directory,'paused')),true);
    await f.automatic.disable();assert.equal(f.calls.filter(c=>c[1]==='bootout').length,1);
    await f.automatic.enable();assert.equal((await f.automatic.status()).enabled,true);
    assert.equal(readFileSync(f.config,'utf8').includes('100@s.whatsapp.net'),true);
    assert.equal(readFileSync(join(f.data,'auth','creds.json'),'utf8').includes('do not expose'),true);
    assert.doesNotMatch(readFileSync(join(f.automatic.directory,'check.sh'),'utf8'),/do not expose|100@s/);
  } finally {f.clean();}
});

test('launchd configuration uses native intervals without a continuously running watcher',async()=>{
  const f=fixture();
  try {
    await f.automatic.enable();
    const text=readFileSync(f.automatic.plistPath,'utf8');
    assert.doesNotMatch(text,/<key>KeepAlive<\/key>/);
    if(process.platform==='darwin') {
      assert.equal((await exec('/usr/bin/plutil',['-extract','StartInterval','raw','-o','-',f.automatic.plistPath])).stdout.trim(),'60');
      assert.equal((await exec('/usr/bin/plutil',['-extract','ProgramArguments.0','raw','-o','-',f.automatic.plistPath])).stdout.trim(),'/bin/sh');
      assert.equal((await exec('/usr/bin/plutil',['-extract','ProgramArguments.1','raw','-o','-',f.automatic.plistPath])).stdout.trim(),join(f.automatic.directory,'check.sh'));
    }
    assert.ok(launchAgentPlist('label','/tmp/a&b','/tmp/log').includes('a&amp;b'));
  } finally {f.clean();}
});

test('unsupported platforms, unrelated jobs, live locks, and owner mismatches remain untouched',async()=>{
  const f=fixture();
  try {
    const unsupported=new AutoStart(f.setup,{platform:'linux',home:join(f.root,'other-home')});
    await assert.rejects(unsupported.enable(),/macOS/);assert.equal((await unsupported.status()).supported,false);
    assert.equal(existsSync(join(f.data,'autostart')),false);
    writeFileSync(join(f.data,'run.lock'),'999');
    await assert.rejects(f.automatic.enable(),/locked/);assert.equal(readFileSync(join(f.data,'run.lock'),'utf8'),'999');
    rmSync(join(f.data,'run.lock'));
    mkdirSync(join(f.root,'home','Library','LaunchAgents'),{recursive:true});
    writeFileSync(f.automatic.plistPath,'unrelated job');
    await assert.rejects(f.automatic.enable(),/different contents/);
    await assert.rejects(f.automatic.disable(),/different contents/);
    assert.equal(readFileSync(f.automatic.plistPath,'utf8'),'unrelated job');
    assert.equal(f.calls.some(c=>c[1]==='bootout'),false);
    rmSync(f.automatic.plistPath);
    writeFileSync(join(f.data,'auth','creds.json'),JSON.stringify({registered:true,me:{id:'900@s.whatsapp.net'}}));
    await assert.rejects(f.automatic.enable(),/authorized WhatsApp account/);
    assert.equal(existsSync(f.automatic.plistPath),false);
  } finally {f.clean();}
});

test('failed installation stays paused and never silently enables at login',async()=>{
  const f=fixture();
  try {
    f.setBootstrapFailure(true);
    await assert.rejects(f.automatic.enable(),/remains paused/);
    assert.equal(existsSync(join(f.automatic.directory,'paused')),true);
    assert.equal(existsSync(join(f.automatic.directory,'control.lock')),false);
    assert.equal((await f.automatic.status()).enabled,false);
    f.setBootstrapFailure(false);await f.automatic.enable();assert.equal((await f.automatic.status()).enabled,true);
  } finally {f.clean();}
});

test('background status tracks lifecycle without recording messages or account data',()=>{
  const f=fixture();
  try {
    mkdirSync(join(f.data,'autostart'));
    writeFileSync(join(f.data,'run.lock'),String(process.pid));
    const reporter=backgroundReporter(f.data);
    reporter.report('connected');reporter.report('command-accepted');reporter.report('reply-sent');
    assert.equal(readBackgroundStatus(f.data)?.connected,true);
    reporter.report('t3-unavailable');assert.equal(readBackgroundStatus(f.data)?.t3Available,false);
    reporter.report('t3-recovered');assert.equal(readBackgroundStatus(f.data)?.t3Available,true);
    reporter.report('t3-auto-stop');assert.equal(readBackgroundStatus(f.data)?.stopReason,'t3_unavailable');
    reporter.report('disconnected',{action:'stop',text:'do not expose'});
    assert.equal(existsSync(join(f.data,'autostart','paused')),true);
    assert.doesNotMatch(readFileSync(join(f.data,'autostart','status.json'),'utf8'),/do not expose|100@s/);
    assert.equal(statSync(join(f.data,'autostart','status.json')).mode & 0o777,0o600);
    writeFileSync(join(f.data,'run.lock'),'999');assert.equal(readBackgroundStatus(f.data),undefined);
    reporter.close(); // Must not overwrite the new owner.
    assert.equal(JSON.parse(readFileSync(join(f.data,'autostart','status.json'),'utf8')).state,'running');
  } finally {f.clean();}
});

test('native idle checks launch only for a live local backend, respecting pause and runtime locks',{skip:process.platform!=='darwin'},async()=>{
  const f=fixture();
  let responseStatus=200,requests=0;
  const server=createServer((_req,res)=>{requests++;res.writeHead(responseStatus);res.end('{}');});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const runtime=join(f.root,'runtime.json'),script=join(f.root,'check.sh'),entry=join(f.root,'launch.sh'),started=join(f.root,'started');
    mkdirSync(join(f.data,'autostart'));
    writeFileSync(entry,'#!/bin/sh\n[ -f "$T3_WHATSAPP_CONFIG" ] || exit 1\nprintf started > "$T3_WHATSAPP_AUTOSTART_DATA_DIR/../started"\n');
    const render=()=>writeFileSync(script,autoStartScript({config:f.config,dataDir:f.data,node:'/bin/sh',entry,root:f.root,runtimeFile:runtime,path:'/usr/bin:/bin'}));
    render();
    const check=()=>exec('/bin/sh',[script],{timeout:5000});
    await check();assert.equal(existsSync(started),false); // Missing runtime: no Node, no HTTP.
    const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
    writeFileSync(runtime,JSON.stringify({pid:process.pid,origin}));
    writeFileSync(join(f.data,'autostart','paused'),'paused');await check();assert.equal(requests,0);
    rmSync(join(f.data,'autostart','paused'));writeFileSync(join(f.data,'run.lock'),'999');await check();assert.equal(requests,0);
    rmSync(join(f.data,'run.lock'));
    writeFileSync(runtime,JSON.stringify({pid:0,origin}));await check();assert.equal(requests,0);
    writeFileSync(runtime,JSON.stringify({pid:process.pid,origin:'https://external.example:443'}));await check();assert.equal(requests,0);
    writeFileSync(runtime,JSON.stringify({pid:process.pid,origin}));
    responseStatus=503;await check();assert.equal(existsSync(started),false);
    responseStatus=200;await check();assert.equal(readFileSync(started,'utf8'),'started');
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));f.clean();}
});

test('setup can enable and pause the background job without tying it to its own lifetime',async()=>{
  const f=fixture();const local=await startSetupServer(f.setup,f.automatic);
  const headers={Authorization:'Bearer '+local.token,Origin:local.origin,'Content-Type':'application/json'};
  const post=(path:string)=>fetch(local.origin+'/api/'+path,{method:'POST',headers,body:'{}'});
  try {
    assert.equal((await post('auto/enable')).status,200);
    assert.equal((await post('pair')).status,400); // Pause before re-pairing.
    const state=await (await fetch(local.origin+'/api/state',{headers})).json() as {automatic:{enabled:boolean}};
    assert.equal(state.automatic.enabled,true);
    await local.close();
    assert.equal((await f.automatic.status()).loaded,true);
    assert.equal(f.calls.some(c=>c[1]==='bootout'),false);
    await f.automatic.disable();assert.equal((await f.automatic.status()).enabled,false);
  } finally {await local.close();f.clean();}
});

test('local T3 probes require a live PID, loopback origin, and a valid descriptor',async()=>{
  const f=fixture();
  let valid=false,redirect=false;
  const server=createServer((_req,res)=>{
    if(redirect) {res.writeHead(302,{Location:'https://external.example'});res.end();return;}
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(valid ? {environmentId:'local-test',serverVersion:'test'} : {}));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const runtime=join(f.root,'runtime.json'),origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
    assert.equal(await localT3Available(runtime),false);
    writeFileSync(runtime,JSON.stringify({pid:0,origin}));assert.equal(await localT3Available(runtime),false);
    writeFileSync(runtime,JSON.stringify({pid:process.pid,origin:'https://external.example'}));assert.equal(await localT3Available(runtime),false);
    writeFileSync(runtime,JSON.stringify({pid:process.pid,origin}));assert.equal(await localT3Available(runtime),false);
    valid=true;assert.equal(await localT3Available(runtime),true);
    redirect=true;assert.equal(await localT3Available(runtime),false);
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));f.clean();}
});

test('background entry waits without opening WhatsApp and pauses on owner mismatch',async()=>{
  const f=fixture();
  try {
    mkdirSync(join(f.data,'autostart'));
    const entry=join(process.cwd(),'src','autostart-entry.ts');
    const env={...process.env,T3_WHATSAPP_CONFIG:f.config,T3_WHATSAPP_AUTOSTART_DATA_DIR:f.data,T3_WHATSAPP_AUTOSTART_RUNTIME_FILE:join(f.root,'missing-runtime.json')};
    await exec(process.execPath,['--import','tsx',entry],{env,timeout:5000});
    assert.equal(existsSync(join(f.data,'run.lock')),false);
    assert.equal(existsSync(join(f.data,'bridge.sqlite')),false);
    assert.equal(existsSync(join(f.data,'autostart','paused')),false);
    writeFileSync(join(f.data,'auth','creds.json'),JSON.stringify({registered:true,me:{id:'900@s.whatsapp.net'}}));
    await assert.rejects(exec(process.execPath,['--import','tsx',entry],{env,timeout:5000}),e=>{
      assert.doesNotMatch((e as {stderr:string}).stderr,/900@s|100@s/);return true;
    });
    assert.equal(existsSync(join(f.data,'autostart','paused')),true);
    assert.equal(existsSync(join(f.data,'run.lock')),false);
    assert.equal(existsSync(join(f.data,'bridge.sqlite')),false);
  } finally {f.clean();}
});

function readyForCompletion(f:ReturnType<typeof fixture>) {
  f.setup.checks=async(options=f.setup.defaults())=>Setup.prototype.checks.call(f.setup,options,async()=>({}));
}
const preferences={t3Binary:'t3',noProject:'~/.t3/scratch',access:'self',retentionDays:0};

test('finishing new setup enables automatic startup by default without a second enable action',async()=>{
  const f=fixture(false);readyForCompletion(f);
  const local=await startSetupServer(f.setup,f.automatic);
  const headers={Authorization:'Bearer '+local.token,Origin:local.origin,'Content-Type':'application/json'};
  const complete=(input:unknown)=>fetch(local.origin+'/api/complete',{method:'POST',headers,body:JSON.stringify(input)});
  try {
    const response=await complete({settings:preferences});assert.equal(response.status,200);
    const result=await response.json() as {completed:boolean;automatic:{enabled:boolean}};
    assert.equal(result.completed,true);assert.equal(result.automatic.enabled,true);
    assert.equal(existsSync(f.config),true);assert.equal(f.builds(),1);
    const repeated=await complete({});assert.equal(repeated.status,200);
    assert.equal((await repeated.json() as {completed:boolean}).completed,true);
    assert.equal(f.builds(),1);assert.equal(f.calls.filter(call=>call[1]==='bootstrap').length,1);
    await local.close();assert.equal((await f.automatic.status()).enabled,true);
  } finally {await local.close();f.clean();}
});

test('an explicit opt-out remains off on subsequent setup completion',async()=>{
  const f=fixture(false);readyForCompletion(f);
  const local=await startSetupServer(f.setup,f.automatic);
  const headers={Authorization:'Bearer '+local.token,Origin:local.origin,'Content-Type':'application/json'};
  const complete=(input:unknown)=>fetch(local.origin+'/api/complete',{method:'POST',headers,body:JSON.stringify(input)});
  try {
    const first=await complete({settings:preferences,automatic:false});assert.equal(first.status,200);
    const before=await f.automatic.status();assert.equal(before.enabled,false);assert.equal(before.paused,true);
    await complete({});assert.equal((await f.automatic.status()).enabled,false);
    assert.equal(f.calls.some(call=>call[1]==='bootstrap'),false);assert.equal(f.builds(),0);
    await complete({automatic:true});assert.equal((await f.automatic.status()).enabled,true);
  } finally {await local.close();f.clean();}
});

test('completion reports startup failure while preserving the successfully saved configuration',async()=>{
  const f=fixture(false);readyForCompletion(f);f.setBootstrapFailure(true);
  const local=await startSetupServer(f.setup,f.automatic);
  const headers={Authorization:'Bearer '+local.token,Origin:local.origin,'Content-Type':'application/json'};
  try {
    const response=await fetch(local.origin+'/api/complete',{method:'POST',headers,body:JSON.stringify({settings:preferences})});
    const result=await response.json() as {completed:boolean;startupError:string;automatic:{enabled:boolean;paused:boolean}};
    assert.equal(result.completed,false);assert.match(result.startupError,/settings are saved/);
    assert.equal(result.automatic.enabled,false);assert.equal(result.automatic.paused,true);
    assert.equal(f.setup.summary().existing,true);assert.equal(f.setup.summary().session.authorized,true);
    assert.equal(readFileSync(join(f.data,'auth','creds.json'),'utf8').includes('do not expose'),true);
  } finally {await local.close();f.clean();}
});

test('completion saves preferences on unsupported platforms without installing a background job',async()=>{
  const f=fixture(false);readyForCompletion(f);
  const automatic=new AutoStart(f.setup,{platform:'linux',home:join(f.root,'unsupported-home'),run:async()=>{assert.fail('No service command should run');}});
  const local=await startSetupServer(f.setup,automatic);
  const headers={Authorization:'Bearer '+local.token,Origin:local.origin,'Content-Type':'application/json'};
  try {
    const response=await fetch(local.origin+'/api/complete',{method:'POST',headers,body:JSON.stringify({settings:preferences})});
    const result=await response.json() as {completed:boolean;automatic:{supported:boolean;enabled:boolean}};
    assert.equal(result.completed,true);assert.equal(result.automatic.supported,false);assert.equal(result.automatic.enabled,false);
    assert.equal(f.setup.summary().existing,true);assert.equal(existsSync(automatic.directory),false);
  } finally {await local.close();f.clean();}
});

function settingsRequest(local:Awaited<ReturnType<typeof startSetupServer>>,input:unknown) {
  return fetch(local.origin+'/api/settings',{method:'POST',headers:{Authorization:'Bearer '+local.token,Origin:local.origin,'Content-Type':'application/json'},body:JSON.stringify(input)});
}
test('Settings can be read without pausing and saving reconnects an owned automatic job while preserving routes',async()=>{
  const routes=[{chatJid:'200@g.us',project:'project-a'}];
  const f=fixture(true,{accountWide:true,projects:{app:'project-a'},routes});
  await f.automatic.enable();
  const local=await startSetupServer(f.setup,f.automatic);
  try {
    const credentials=readFileSync(join(f.data,'auth','creds.json'),'utf8');
    await fetch(local.origin+'/api/state',{headers:{Authorization:'Bearer '+local.token}});
    assert.equal(f.calls.filter(call=>call[1]==='bootout').length,0);
    const result=await settingsRequest(local,{settings:{...f.setup.defaults(),retentionDays:7},automatic:true});
    assert.equal(result.status,200);assert.equal((await result.json() as {saved:boolean}).saved,true);
    const config=JSON.parse(readFileSync(f.config,'utf8'));
    assert.equal(config.history.retentionDays,7);assert.equal(config.accountWide,true);
    assert.deepEqual(config.routes,routes);assert.deepEqual(config.projects,{app:'project-a'});
    assert.equal(f.calls.filter(call=>call[1]==='bootout').length,1);
    assert.equal(f.calls.filter(call=>call[1]==='bootstrap').length,2);
    assert.equal((await f.automatic.status()).enabled,true);
    assert.equal(readFileSync(join(f.data,'auth','creds.json'),'utf8'),credentials);
  } finally {await local.close();f.clean();}
});
test('invalid Settings are rejected before pausing the bot or changing configuration',async()=>{
  const f=fixture();await f.automatic.enable();
  const local=await startSetupServer(f.setup,f.automatic);
  try {
    const before=readFileSync(f.config,'utf8');
    const result=await settingsRequest(local,{settings:{...f.setup.defaults(),noProject:'different-workspace'},automatic:true});
    assert.equal(result.status,400);assert.equal(readFileSync(f.config,'utf8'),before);
    assert.equal(f.calls.some(call=>call[1]==='bootout'),false);
    assert.equal((await f.automatic.status()).enabled,true);
  } finally {await local.close();f.clean();}
});
test('Settings never stops an unrelated runtime or changes its lock',async()=>{
  const f=fixture();await f.automatic.enable();
  const local=await startSetupServer(f.setup,f.automatic);
  try {
    const before=readFileSync(f.config,'utf8');writeFileSync(join(f.data,'run.lock'),'999');
    const response=await settingsRequest(local,{settings:{...f.setup.defaults(),retentionDays:7},automatic:true});
    assert.equal(response.status,409);assert.equal(readFileSync(join(f.data,'run.lock'),'utf8'),'999');
    assert.equal(readFileSync(f.config,'utf8'),before);
    assert.equal(f.calls.some(call=>call[1]==='bootout'),false);
  } finally {await local.close();f.clean();}
});
test('saving Settings keeps a paused installation paused and supports explicitly turning automatic startup off',async()=>{
  const f=fixture();await f.automatic.disable();
  const local=await startSetupServer(f.setup,f.automatic);
  try {
    assert.equal((await settingsRequest(local,{settings:{...f.setup.defaults(),retentionDays:7}})).status,200);
    assert.equal((await f.automatic.status()).paused,true);assert.equal(f.builds(),0);
    await f.automatic.enable();
    assert.equal((await settingsRequest(local,{settings:{...f.setup.defaults(),retentionDays:30},automatic:false})).status,200);
    const status=await f.automatic.status();assert.equal(status.enabled,false);assert.equal(status.loaded,false);assert.equal(status.paused,true);
    assert.equal(f.builds(),1);assert.equal(JSON.parse(readFileSync(f.config,'utf8')).history.retentionDays,30);
  } finally {await local.close();f.clean();}
});
test('Settings reports saved preferences separately from a failed reconnect',async()=>{
  const f=fixture();await f.automatic.enable();
  const local=await startSetupServer(f.setup,f.automatic);f.setBootstrapFailure(true);
  try {
    const response=await settingsRequest(local,{settings:{...f.setup.defaults(),retentionDays:7},automatic:true});
    assert.equal(response.status,200);
    const result=await response.json() as {saved:boolean;startupError:string;automatic:{paused:boolean;enabled:boolean}};
    assert.equal(result.saved,true);assert.match(result.startupError,/Settings are saved/);
    assert.equal(result.automatic.paused,true);assert.equal(result.automatic.enabled,false);
    assert.equal(JSON.parse(readFileSync(f.config,'utf8')).history.retentionDays,7);
  } finally {await local.close();f.clean();}
});
