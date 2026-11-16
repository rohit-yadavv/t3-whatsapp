import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile, fork} from 'node:child_process';
import {Script} from 'node:vm';
import {promisify} from 'node:util';
import {request} from 'node:http';
import {existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {loadConfig} from '../src/config.js';
import {pairedAccount, Setup, SetupRuntime} from '../src/setup.js';
import {setupPage} from '../src/setup-page.js';
import {startSetupServer} from '../src/setup-server.js';

function fixture() {
  const dir=mkdtempSync(join(tmpdir(),'t3-setup-'));
  const path=join(dir,'config.json'),data=join(dir,'.data');
  function pair(id='100:4@s.whatsapp.net',lid='200:3@lid') {
    mkdirSync(join(data,'auth'),{recursive:true});
    writeFileSync(join(data,'auth','creds.json'),JSON.stringify({registered:true,me:{id,lid},secret:'never expose this'}));
  }
  return {dir,path,data,pair,clean:()=>rmSync(dir,{recursive:true,force:true})};
}
const options={t3Binary:'t3',noProject:'~/.t3/scratch',access:'self' as const,retentionDays:0};

test('first setup creates own-account authorization and private self-only configuration',()=>{
  const f=fixture();
  try {
    const setup=new Setup(f.path);
    assert.equal(setup.defaults().access,'self');assert.equal(setup.defaults().retentionDays,0);
    assert.throws(()=>setup.save(options),/Link WhatsApp/);
    f.pair();
    assert.deepEqual(pairedAccount(f.data),['100@s.whatsapp.net','200@lid']);
    setup.save(options);
    const config=loadConfig(f.path);
    assert.equal(config.selfCommands,true);assert.equal(config.accountWide,false);
    assert.deepEqual(config.allowedSenderJids,['100@s.whatsapp.net','200@lid']);
    assert.deepEqual(config.routes.map(route=>route.chatJid),config.allowedSenderJids);
    assert.equal(config.history?.retentionDays,0);
    assert.equal(statSync(f.path).mode & 0o777,0o600);
    assert.equal(existsSync(join(f.data,'run.lock')),false);
    assert.equal(setup.summary().existing,true);
    assert.doesNotMatch(JSON.stringify(setup.summary()),/never expose|100@|200@/);
  } finally {f.clean();}
});

test('rerunning setup preserves routes, aliases, authorization, history limits, and runtime data',()=>{
  const f=fixture();
  try {
    f.pair();
    writeFileSync(f.path,JSON.stringify({allowedSenderJids:['100@s.whatsapp.net'],selfCommands:true,accountWide:true,projects:{web:'/web'},routes:[{chatJid:'300@g.us',project:'/web'}],history:{retentionDays:7,maxReadMessages:25},pollIntervalMs:20000}));
    const setup=new Setup(f.path);
    writeFileSync(join(f.data,'bridge.sqlite'),'existing database');
    const credentials=readFileSync(join(f.data,'auth','creds.json'),'utf8');
    setup.save({...options,access:'existing',retentionDays:30});
    setup.save({...options,access:'existing',retentionDays:30});
    const config=loadConfig(f.path);
    assert.equal(config.accountWide,true);assert.deepEqual(config.allowedSenderJids,['100@s.whatsapp.net']);
    assert.deepEqual(config.projects,{web:'/web'});assert.deepEqual(config.routes,[{chatJid:'300@g.us',project:'/web'}]);
    assert.equal(config.history?.maxReadMessages,25);assert.equal(config.history?.retentionDays,30);
    assert.equal(config.pollIntervalMs,20000);
    assert.equal(readFileSync(join(f.data,'bridge.sqlite'),'utf8'),'existing database');
    assert.equal(readFileSync(join(f.data,'auth','creds.json'),'utf8'),credentials);
  } finally {f.clean();}
});

test('separate-account settings preserve sender authorization without authorizing an own-account switch',()=>{
  const f=fixture();
  try {
    f.pair('900@s.whatsapp.net','901@lid');
    const original={selfCommands:false,allowedSenderJids:['100@s.whatsapp.net'],routes:[{chatJid:'300@g.us',project:'/project'}]};
    writeFileSync(f.path,JSON.stringify(original));
    const setup=new Setup(f.path);
    const settings={...options,access:'existing' as const,retentionDays:7};
    setup.validateSettings(settings);
    setup.save(settings);
    const config=loadConfig(f.path);
    assert.equal(config.selfCommands,false);
    assert.deepEqual(config.allowedSenderJids,original.allowedSenderJids);
    assert.deepEqual(config.routes,original.routes);
    assert.equal(config.history?.retentionDays,7);
    const saved=readFileSync(f.path,'utf8');
    for(const access of ['self','all'] as const) {
      assert.throws(()=>setup.save({...settings,access}),/authorization/);
      assert.equal(readFileSync(f.path,'utf8'),saved);
    }
  } finally {f.clean();}
});

test('setup refuses mismatched accounts, workspace changes, external edits, and active locks',()=>{
  const f=fixture();
  try {
    f.pair();writeFileSync(f.path,JSON.stringify({allowedSenderJids:['100@s.whatsapp.net'],selfCommands:true}));
    const setup=new Setup(f.path),original=readFileSync(f.path,'utf8');
    assert.throws(()=>setup.save({...options,noProject:'/different'}),/workspace/);
    f.pair('900@s.whatsapp.net','901@lid');
    assert.throws(()=>setup.save(options),/authorization/);assert.equal(readFileSync(f.path,'utf8'),original);
    f.pair();writeFileSync(join(f.data,'run.lock'),'999');
    assert.throws(()=>setup.save(options),/locked/);assert.equal(readFileSync(join(f.data,'run.lock'),'utf8'),'999');
    rmSync(join(f.data,'run.lock'));
    writeFileSync(f.path,original+'\n');
    assert.throws(()=>setup.save(options),/changed outside/);
    assert.equal(readFileSync(f.path,'utf8'),original+'\n');
    assert.equal(existsSync(join(f.data,'run.lock')),false);
  } finally {f.clean();}
});

test('checks are read-only, bounded by the T3 adapter, and distinguish saved from live sessions',async()=>{
  const f=fixture();
  try {
    const setup=new Setup(f.path),calls:string[][]=[];
    const result=await setup.checks(options,async(binary,args)=>{calls.push([binary,...args]);return {};});
    assert.deepEqual(calls,[['t3','thread','list','--project','~/.t3/scratch','--json']]);
    assert.equal(result.find(c=>c.code==='needs_pairing')?.ok,false);
    assert.equal(existsSync(f.data),false);
    const failed=await setup.checks(options,async()=>{throw new Error('private output');});
    assert.equal(failed[0].code,'t3_unavailable');assert.doesNotMatch(JSON.stringify(failed),/private output/);
    f.pair();assert.equal((await setup.checks(options,async()=>({})))[1].code,'session_saved');
  } finally {f.clean();}
});

test('local server protects pairing and configuration with token, host, origin, and request limits',async()=>{
  const f=fixture();const local=await startSetupServer(new Setup(f.path));
  const headers={Authorization:'Bearer '+local.token,Origin:local.origin,'Content-Type':'application/json'};
  try {
    const page=await fetch(local.origin);
    assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy')!,/frame-ancestors 'none'/);
    assert.equal(page.headers.get('cache-control'),'no-store');
    const markup=await page.text();
    assert.match(markup,/<img class="brand-logo" src="\/assets\/logo\.png"/);
    const logo=await fetch(local.origin+'/assets/logo.png');
    assert.equal(logo.headers.get('content-type'),'image/png');
    assert.deepEqual(Buffer.from(await logo.arrayBuffer()),readFileSync(resolve('assets/logo.png')));
    assert.doesNotMatch(markup,new RegExp(local.token));assert.doesNotMatch(markup,/localStorage|sessionStorage/);
    assert.equal((await fetch(local.origin+'/api/state')).status,401);
    assert.equal((await fetch(local.origin+'/api/state',{headers:{...headers,Origin:'https://other.test'}})).status,403);
    const wrongHost=await new Promise<number|undefined>((resolveStatus,reject)=>{
      const req=request(local.origin+'/api/state',{headers:{...headers,Host:'evil.test'}},res=>{res.resume();resolveStatus(res.statusCode);});
      req.on('error',reject);req.end();
    });
    assert.equal(wrongHost,403);
    const state=await (await fetch(local.origin+'/api/state',{headers})).json() as {existing:boolean};
    assert.equal(state.existing,false);
    assert.equal((await fetch(local.origin+'/api/pair',{method:'POST',headers:{Authorization:headers.Authorization,'Content-Type':'application/json'},body:'{}'})).status,403);
    assert.equal((await fetch(local.origin+'/api/save',{method:'POST',headers,body:JSON.stringify({...options,allowedSenderJids:['900@s.whatsapp.net']})})).status,400);
    assert.equal((await fetch(local.origin+'/api/save',{method:'POST',headers,body:JSON.stringify({x:'a'.repeat(17000)})})).status,400);
    assert.equal((await fetch(local.origin+'/api/start',{method:'POST',headers,body:'{}'})).status,400);
    assert.equal(existsSync(f.path),false);
    await assert.rejects(startSetupServer(new Setup(f.path)),/Setup is already running/);
    assert.equal(local.runtime.state,'idle');
  } finally {await local.close();assert.equal(existsSync(join(f.data,'setup.lock')),false);f.clean();}
});

test('doctor reports missing setup as structured JSON without connecting or creating local data',async()=>{
  const f=fixture();
  try {
    const exec=promisify(execFile);
    const result=await exec(process.execPath,['--import','tsx',resolve('src/setup-cli.ts'),'doctor','--json'],{env:{...process.env,T3_WHATSAPP_CONFIG:f.path},timeout:15000}).catch(e=>e as {stdout:string;stderr:string});
    const report=JSON.parse(result.stdout);
    assert.equal(report.ready,false);assert.equal(report.whatsappLiveVerified,false);
    assert.equal(report.checks.some((c:{code:string})=>c.code==='needs_pairing'),true);
    assert.equal(existsSync(f.data),false);
  } finally {f.clean();}
});

test('setup serves valid browser JavaScript without external dependencies',()=>{
  const markup=setupPage('test-nonce');
  const script=/<script nonce="test-nonce">([\s\S]*?)<\/script>/.exec(markup)?.[1];
  assert.ok(script);assert.doesNotThrow(()=>new Script(script));
  assert.doesNotMatch(markup,/<(?:script|link)[^>]+(?:src|href)="https?:/);
});

test('setup API saves verified preferences and prevents overlapping operations',async()=>{
  const f=fixture();f.pair();const setup=new Setup(f.path);
  let release:()=>void=()=>{};
  let enteredResolve:()=>void=()=>{};
  const entered=new Promise<void>(resolve=>{enteredResolve=resolve;});
  let waiting=false;
  setup.checks=async(options=setup.defaults())=>{
    if(waiting) {enteredResolve();await new Promise<void>(resolve=>{release=resolve;});}
    return Setup.prototype.checks.call(setup,options,async()=>({}));
  };
  const local=await startSetupServer(setup);
  const headers={Authorization:'Bearer '+local.token,Origin:local.origin,'Content-Type':'application/json'};
  const post=(path:string,data:unknown)=>fetch(local.origin+'/api/'+path,{method:'POST',headers,body:JSON.stringify(data)});
  try {
    const response=await post('save',{...options,access:'all',retentionDays:7});
    assert.equal(response.status,200);
    const config=loadConfig(f.path);assert.equal(config.accountWide,true);assert.equal(config.history?.retentionDays,7);
    assert.equal(setup.defaults().retentionDays,7);
    waiting=true;
    const first=post('check',options);
    await entered;
    assert.equal((await post('save',options)).status,409);
    release();assert.equal((await first).status,200);
    assert.equal(loadConfig(f.path).accountWide,true);
  } finally {release();await local.close();f.clean();}
});

test('setup-owned runtime reports IPC events and stops only its child',async()=>{
  const f=fixture();
  let runtime:SetupRuntime|undefined;
  try {
    const script=join(f.dir,'runtime.cjs');
    writeFileSync(script,`process.send({event:'connected'});process.send({event:'command-accepted'});process.send({event:'reply-sent'});setInterval(()=>{},1000);process.on('SIGTERM',()=>process.exit(0));`);
    f.pair();const setup=new Setup(f.path);setup.save(options);
    let spawned:ReturnType<typeof fork>|undefined;
    const launch=((_entry,args,settings)=>{spawned=fork(script,args,settings);return spawned;}) as typeof fork;
    runtime=new SetupRuntime(setup,launch);
    runtime.start(false);
    await new Promise<void>((resolveReady,reject)=>{
      const timer=setTimeout(()=>reject(new Error('No IPC ready event')),5000);
      spawned!.on('message',(m:unknown)=>{if((m as {event:string}).event==='reply-sent'){clearTimeout(timer);resolveReady();}});
    });
    assert.equal(runtime.connected,true);assert.equal(runtime.commandAccepted,true);assert.equal(runtime.replySent,true);
    assert.throws(()=>runtime!.start(true),/already active/);
    await runtime.stop();assert.equal(runtime.connected,false);assert.equal(runtime.state,'idle');
    assert.equal(spawned!.exitCode,0);
    writeFileSync(join(f.data,'run.lock'),'999');
    assert.throws(()=>runtime!.start(true),/locked/);
    assert.equal(readFileSync(join(f.data,'run.lock'),'utf8'),'999');
  } finally {await runtime?.stop();f.clean();}
});

test('setup reports effective access and session readiness without exposing account identifiers',()=>{
  const f=fixture();
  try {
    f.pair();const setup=new Setup(f.path);setup.save(options);
    assert.deepEqual(setup.summary().session,{saved:true,authorized:true});
    assert.equal(setup.summary().access,'self');
    setup.save({...options,access:'all'});assert.equal(setup.summary().access,'all');
    f.pair('900@s.whatsapp.net','901@lid');
    assert.deepEqual(setup.summary().session,{saved:true,authorized:false});
    assert.doesNotMatch(JSON.stringify(setup.summary()),/100@s|200@lid|900@s|901@lid|never expose/);
  } finally {f.clean();}
});

test('setup identifies an external runtime conflict without adopting or stopping its owner',async()=>{
  const f=fixture();const local=await startSetupServer(new Setup(f.path));
  const headers={Authorization:'Bearer '+local.token};
  try {
    const before=await (await fetch(local.origin+'/api/state',{headers})).json() as {runtimeOwner:string};
    assert.equal(before.runtimeOwner,'none');
    writeFileSync(join(f.data,'run.lock'),'999');
    const during=await (await fetch(local.origin+'/api/state',{headers})).json() as {runtimeOwner:string;runtimeLocked:boolean};
    assert.equal(during.runtimeOwner,'external');assert.equal(during.runtimeLocked,true);
    assert.equal(readFileSync(join(f.data,'run.lock'),'utf8'),'999');
    await local.close();assert.equal(readFileSync(join(f.data,'run.lock'),'utf8'),'999');
  } finally {await local.close();f.clean();}
});

test('web QR sessions are recognized from the saved account even when registered is false',()=>{
  const f=fixture();
  try {
    f.pair();
    const creds=join(f.data,'auth','creds.json');
    const data=JSON.parse(readFileSync(creds,'utf8'));data.registered=false;
    writeFileSync(creds,JSON.stringify(data));
    assert.deepEqual(pairedAccount(f.data),['100@s.whatsapp.net','200@lid']);
    const setup=new Setup(f.path);setup.save(options);
    assert.deepEqual(setup.summary().session,{saved:true,authorized:true});
    const ready=new Setup(f.path);assert.deepEqual(ready.summary().session,{saved:true,authorized:true});
    // A flag or a secondary ID alone is not enough without a valid primary account.
    writeFileSync(creds,JSON.stringify({registered:true,me:{lid:'200@lid'}}));
    assert.deepEqual(pairedAccount(f.data),[]);
    writeFileSync(creds,JSON.stringify({registered:false}));assert.deepEqual(pairedAccount(f.data),[]);
  } finally {f.clean();}
});

test('successful session verification advances setup without requiring a new QR',async()=>{
  const f=fixture();let runtime:SetupRuntime|undefined;
  try {
    f.pair();
    const creds=join(f.data,'auth','creds.json'),data=JSON.parse(readFileSync(creds,'utf8'));data.registered=false;writeFileSync(creds,JSON.stringify(data));
    const setup=new Setup(f.path);setup.save(options);
    const script=join(f.dir,'verify.cjs');
    writeFileSync(script,"process.send({event:'setup-paired'},()=>process.exit(0));");
    let child:ReturnType<typeof fork>|undefined;
    const launch=((_entry,args,settings)=>{child=fork(script,args,settings);return child;}) as typeof fork;
    runtime=new SetupRuntime(setup,launch);runtime.start(true);
    await new Promise<void>(resolveDone=>child!.once('close',()=>resolveDone()));
    assert.equal(runtime.state,'paired');assert.equal(runtime.qr,undefined);
    assert.deepEqual(setup.summary().session,{saved:true,authorized:true});
    const {setupScreen}=await import('../src/setup-screen.js');
    assert.equal(setupScreen({...setup.summary(),runtimeOwner:'none',runtime:runtime.snapshot(),automatic:{enabled:false,paused:false}},true,true),'finish');
  } finally {await runtime?.stop();f.clean();}
});
