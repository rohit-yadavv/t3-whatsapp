import {fork, type ChildProcess} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {historyOptions, loadConfig, projectCatalog, validateConfig, type Config} from './config.js';
import {command} from './t3.js';

export const setupOptions = z.object({
  t3Binary:z.string().trim().min(1).max(4096),
  noProject:z.string().trim().min(1).max(4096),
  access:z.enum(['self','all','existing']),
  retentionDays:z.number().int().min(0).max(3650),
}).strict();
export type SetupOptions = z.infer<typeof setupOptions>;
export type Check = {code:string;ok:boolean;message:string;next?:string};
export type Probe = (binary:string, args:string[]) => Promise<unknown>;
const probe:Probe = (binary,args) => command(binary,args,'',{timeoutMs:10000});

function fingerprint(contents:string|undefined) {
  return contents === undefined ? 'missing' : createHash('sha256').update(contents).digest('hex');
}
function readOptional(path:string):string|undefined {
  try {return readFileSync(path,'utf8');}
  catch(e) {if ((e as NodeJS.ErrnoException).code==='ENOENT') return;throw e;}
}
export function pairedAccount(dataDir:string):string[] {
  const text=readOptional(join(dataDir,'auth','creds.json'));
  if (!text) return [];
  const creds=JSON.parse(text) as {me?:{id?:string;lid?:string}};
  // Baileys resumes web/QR sessions from creds.me, not the phone-code
  // `registered` flag (which can remain false after a successful QR login).
  const id=creds.me?.id;
  if(typeof id!=='string' || !/^\d+(?::\d+)?@(s\.whatsapp\.net|lid)$/.test(id)) return [];
  return [...new Set([id,creds.me?.lid].filter((id):id is string=>typeof id==='string')
    .map(id=>id.replace(/:\d+(?=@)/,''))
    .filter(id=>/^\d+@(s\.whatsapp\.net|lid)$/.test(id)))];
}

/** Shared by the browser and JSON diagnostics. Never opens a WhatsApp connection. */
export class Setup {
  readonly configPath:string;
  readonly dataDir:string;
  private initial:Config|undefined;
  private revision:string;
  constructor(path=process.env.T3_WHATSAPP_CONFIG ?? 'config.json') {
    this.configPath=resolve(path);
    const contents=readOptional(this.configPath);
    this.revision=fingerprint(contents);
    this.initial=contents===undefined ? undefined : loadConfig(this.configPath);
    this.dataDir=this.initial?.dataDir ?? resolve(dirname(this.configPath),process.env.T3_WHATSAPP_DATA_DIR ?? '.data');
  }
  defaults():SetupOptions {
    const localT3=join(homedir(),'.t3','bin','t3');
    return {
      t3Binary:this.initial?.t3Binary ?? (existsSync(localT3) ? localT3 : 't3'),
      noProject:this.initial?.noProject ?? '~/.t3/scratch',
      access:this.initial ? 'existing' : 'self',
      retentionDays:this.initial ? historyOptions(this.initial).retentionDays : 0,
    };
  }
  async checks(options=this.defaults(), run:Probe=probe):Promise<Check[]> {
    const checks:Check[]=[];
    try {
      for (const project of new Set([options.noProject,...(this.initial ? projectCatalog(this.initial).values() : [])])) {
        await run(options.t3Binary,['thread','list','--project',project,'--json']);
      }
      checks.push({code:'t3_ready',ok:true,message:'T3 is reachable and the configured workspaces are available.'});
    } catch {
      checks.push({code:'t3_unavailable',ok:false,message:'Could not reach T3 with these settings.',next:'Open T3 Code, check the CLI path and No project workspace, then check again.'});
    }
    try {
      const ids=pairedAccount(this.dataDir);
      const match=!this.initial?.selfCommands || ids.some(id=>this.initial!.allowedSenderJids.includes(id));
      checks.push(ids.length && match
        ? {code:'session_saved',ok:true,message:'A paired session is saved. Connect to verify it is still valid.'}
        : {code:ids.length ? 'account_mismatch' : 'needs_pairing',ok:false,message:ids.length ? 'The paired account does not match the configured owner.' : 'WhatsApp needs to be linked.',next:ids.length ? 'Keep the existing authorization intact; check which account this installation should use.' : 'Open setup and link your account using WhatsApp → Linked devices.'});
    } catch {
      checks.push({code:'session_invalid',ok:false,message:'The saved session could not be read.',next:'Inspect the local session before attempting recovery. Do not delete it automatically.'});
    }
    const busy=existsSync(join(this.dataDir,'run.lock'));
    checks.push({code:busy ? 'runtime_locked' : 'runtime_idle',ok:!busy,message:busy ? 'A runtime lock exists; setup will not replace or stop its owner.' : 'The data directory is available.',...(busy ? {next:'Stop the existing bridge or pairing process before changing settings. For a stale lock, verify its owner has exited first.'} : {})});
    return checks;
  }
  summary() {
    let ids:string[]=[];
    try{ids=pairedAccount(this.dataDir);}catch{}
    const session={saved:ids.length>0,authorized:ids.length>0&&(!this.initial?.selfCommands || ids.some(id=>this.initial!.allowedSenderJids.includes(id)))};
    const routes=this.initial?.routes ?? [];
    const access=this.initial?.accountWide ? 'all' : routes.length && routes.every(route=>ids.includes(route.chatJid)) ? 'self' : this.initial ? 'selected' : 'self';
    return {configPath:this.configPath,dataDir:this.dataDir,existing:existsSync(this.configPath),settings:this.defaults(),session,access,runtimeLocked:existsSync(join(this.dataDir,'run.lock'))};
  }
  assertIdle() {
    if (existsSync(join(this.dataDir,'run.lock'))) throw new Error('The data directory is locked. Stop the existing bridge or pairing process first.');
  }
  assertCurrent() {
    if (fingerprint(readOptional(this.configPath))!==this.revision) throw new Error('Configuration changed outside setup. Restart setup to load those changes.');
  }
  private prepare(input:unknown) {
    const options=setupOptions.parse(input);
    const current=readOptional(this.configPath);
    if (fingerprint(current)!==this.revision) throw new Error('Configuration changed outside setup. Restart setup to load those changes.');
    const ids=pairedAccount(this.dataDir);
    if (!ids.length) throw new Error('Link WhatsApp before saving configuration.');
    const previous=current===undefined ? undefined : validateConfig(JSON.parse(current));
    if (previous && (previous.selfCommands || options.access!=='existing') && !ids.some(id=>previous.allowedSenderJids.includes(id))) {
      throw new Error('The paired account does not match existing authorization. Setup will not replace it.');
    }
    if (previous && options.noProject!==previous.noProject) {
      throw new Error('Changing the No project workspace can affect pending work. Keep the existing workspace during setup.');
    }
    if (options.access==='existing' && !previous) throw new Error('There are no existing access settings to preserve.');
    return validateConfig({
      ...(previous ?? {dataDir:this.dataDir,allowedSenderJids:ids,projects:{},routes:[]}),
      t3Binary:options.t3Binary,noProject:options.noProject,
      ...(options.access==='existing' ? {} : {
        selfCommands:true,accountWide:options.access==='all',
        routes:options.access==='self' ? ids.map(chatJid=>({chatJid,project:options.noProject})) : previous?.routes ?? [],
      }),
      history:{...historyOptions(previous ?? {}),retentionDays:options.retentionDays},
    });
  }
  validateSettings(input:unknown) {this.prepare(input);}
  save(input:unknown) {
    const options=setupOptions.parse(input);
    this.assertIdle();
    mkdirSync(this.dataDir,{recursive:true,mode:0o700});
    const lock=join(this.dataDir,'run.lock');
    const fd=openSync(lock,'wx',0o600);
    try {
      writeFileSync(fd,String(process.pid));
      const config=this.prepare(options);
      mkdirSync(dirname(this.configPath),{recursive:true,mode:0o700});
      const temporary=this.configPath+'.setup.tmp';
      const out=openSync(temporary,'wx',0o600);
      try {
        writeFileSync(out,JSON.stringify(config,null,2)+'\n');
        closeSync(out);
        renameSync(temporary,this.configPath);
        chmodSync(this.configPath,0o600);
      } catch(e) {try {closeSync(out);}catch {}rmSync(temporary,{force:true});throw e;}
      this.revision=fingerprint(readFileSync(this.configPath,'utf8'));
      this.initial=loadConfig(this.configPath);
      return {saved:true,restartRequired:true};
    } finally {closeSync(fd);rmSync(lock,{force:true});}
  }
}

/** Only controls children started by this setup session; never adopts another PID. */
export class SetupRuntime {
  private child?:ChildProcess;
  private exit?:Promise<void>;
  state='idle';
  connected=false;
  commandAccepted=false;
  replySent=false;
  qr?:string;
  error?:string;
  t3Available?:boolean;
  stopReason?:'t3_unavailable';
  constructor(private setup:Setup, private launch:typeof fork=fork) {}
  snapshot() {
    return {state:this.state,connected:this.connected,commandAccepted:this.commandAccepted,replySent:this.replySent,error:this.error,qr:this.qr,t3Available:this.t3Available,stopReason:this.stopReason};
  }
  start(pair:boolean) {
    if (this.child) throw new Error('A setup-owned process is already active. Stop it before continuing.');
    this.setup.assertIdle();
    this.setup.assertCurrent();
    if (!pair) loadConfig(this.setup.configPath);
    this.state=pair ? 'pairing' : 'starting';
    this.connected=false;this.commandAccepted=false;this.replySent=false;this.qr=undefined;this.error=undefined;
    this.t3Available=undefined;this.stopReason=undefined;
    const entry=fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? './main.ts' : './main.js',import.meta.url));
    const child=this.launch(entry,pair ? ['pair'] : [],{
      env:{...process.env,T3_WHATSAPP_CONFIG:this.setup.configPath,T3_WHATSAPP_DATA_DIR:this.setup.dataDir},
      stdio:['ignore','ignore','ignore','ipc'],
    });
    this.child=child;
    let paired=false;
    child.on('message',(message:unknown)=>{
      if (!message || typeof message!=='object' || !('event' in message)) return;
      const m=message as {event:string;png?:string};
      if (m.event==='setup-qr') this.qr=m.png;
      if (m.event==='pairing-accepted') this.qr=undefined;
      if (m.event==='setup-paired') {paired=true;this.qr=undefined;}
      if (m.event==='connected' && !pair) {this.state='running';this.connected=true;}
      if (m.event==='disconnected') {this.connected=false;this.qr=undefined;}
      if (m.event==='command-accepted') this.commandAccepted=true;
      if (m.event==='reply-sent') this.replySent=true;
      if (m.event==='t3-unavailable') this.t3Available=false;
      if (m.event==='t3-recovered') this.t3Available=true;
      if (m.event==='t3-auto-stop') {this.t3Available=false;this.stopReason='t3_unavailable';}
    });
    child.on('error',()=>{this.error='Could not launch the runtime. Check the Node installation and run doctor.';});
    this.exit=new Promise(resolveExit=>child.once('close',code=>{
      this.child=undefined;this.connected=false;this.qr=undefined;
      this.state=code===0 ? (paired ? 'paired' : 'idle') : 'error';
      if (code!==0) this.error='The runtime stopped. Run doctor and inspect local diagnostics before retrying; do not replay pending work automatically.';
      resolveExit();
    }));
  }
  async stop() {
    const child=this.child;
    if (!child) return;
    child.kill('SIGTERM');
    const timer=setTimeout(()=>child.kill('SIGKILL'),12000);
    try {await this.exit;} finally {clearTimeout(timer);}
  }
}
