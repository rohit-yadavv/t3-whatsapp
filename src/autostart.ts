import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {homedir, release} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {loadConfig} from './config.js';
import {readBackgroundStatus} from './background-status.js';
import {pairedAccount, type Setup} from './setup.js';

const execute=promisify(execFile);
type Run=(binary:string,args:string[],options?:{cwd?:string})=>Promise<void>;
const run:Run=async(binary,args,options={})=>{await execute(binary,args,{...options,timeout:120000,maxBuffer:500000});};
export interface AutoStartOptions {
  platform?:string;
  release?:string;
  home?:string;
  uid?:number;
  root?:string;
  node?:string;
  runtimeFile?:string;
  run?:Run;
  build?:()=>Promise<void>;
}
const shellQuote=(value:string)=>"'"+value.replace(/'/g,"'\\''")+"'";
const xml=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');

/** Native idle check. Node loads only after the configured local T3 backend responds. */
export function autoStartScript(input:{config:string;dataDir:string;node:string;entry:string;root:string;runtimeFile:string;t3Home?:string;path:string}) {
  return `#!/bin/sh
umask 077
# Managed by T3 WhatsApp. No credentials, AI calls, or persistent watcher.
[ ! -f ${shellQuote(join(input.dataDir,'autostart','paused'))} ] || exit 0
[ -f ${shellQuote(input.config)} ] || exit 0
[ ! -e ${shellQuote(join(input.dataDir,'run.lock'))} ] || exit 0
runtime=${shellQuote(input.runtimeFile)}
pid=$(/usr/bin/plutil -extract pid raw -expect integer -o - "$runtime" 2>/dev/null) || exit 0
case "$pid" in ''|*[!0-9]*) exit 0;; esac
[ "$pid" -gt 0 ] && kill -0 "$pid" 2>/dev/null || exit 0
origin=$(/usr/bin/plutil -extract origin raw -expect string -o - "$runtime" 2>/dev/null) || exit 0
case "$origin" in
  http://127.0.0.1:*) port=\${origin#http://127.0.0.1:};;
  http://localhost:*) port=\${origin#http://localhost:};;
  *) exit 0;;
esac
case "$port" in ''|*[!0-9]*) exit 0;; esac
[ "$port" -gt 0 ] && [ "$port" -le 65535 ] || exit 0
/usr/bin/curl --noproxy '*' --connect-timeout 1 --max-time 2 --fail --silent --output /dev/null "$origin/.well-known/t3/environment" || exit 0
export T3_WHATSAPP_CONFIG=${shellQuote(input.config)}
export T3_WHATSAPP_AUTOSTART_DATA_DIR=${shellQuote(input.dataDir)}
export T3_WHATSAPP_AUTOSTART_RUNTIME_FILE=${shellQuote(input.runtimeFile)}
export PATH=${shellQuote(input.path)}
${input.t3Home ? 'export T3CODE_HOME='+shellQuote(input.t3Home) : ''}
cd ${shellQuote(input.root)} || exit 0
exec ${shellQuote(input.node)} ${shellQuote(input.entry)}
`;
}
export function launchAgentPlist(label:string,script:string,log:string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(label)}</string>
<key>ProgramArguments</key><array><string>/bin/sh</string><string>${xml(script)}</string></array>
<key>StartInterval</key><integer>60</integer>
<key>RunAtLoad</key><true/>
<key>ExitTimeOut</key><integer>15</integer>
<key>ProcessType</key><string>Background</string>
<key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>/dev/null</string>
<key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>\n`;
}

export class AutoStart {
  private options:AutoStartOptions;
  private run:Run;
  readonly directory:string;
  readonly label:string;
  readonly plistPath:string;
  readonly service:string;
  private domain:string;
  constructor(private setup:Setup,options:AutoStartOptions={}) {
    this.options=options;this.run=options.run ?? run;
    this.directory=join(setup.dataDir,'autostart');
    this.label='com.t3-whatsapp.'+createHash('sha256').update(setup.configPath).digest('hex').slice(0,16);
    this.plistPath=join(options.home ?? homedir(),'Library','LaunchAgents',this.label+'.plist');
    this.domain='gui/'+(options.uid ?? process.getuid?.() ?? 0);this.service=this.domain+'/'+this.label;
  }
  private supported() {return (this.options.platform ?? process.platform)==='darwin' && Number((this.options.release ?? release()).split('.')[0])>=21;}
  private plist() {return launchAgentPlist(this.label,join(this.directory,'check.sh'),join(this.directory,'error.log'));}
  private assertOwned() {
    const owner=join(this.directory,'owner.json');
    if(existsSync(owner) && JSON.parse(readFileSync(owner,'utf8')).configPath!==this.setup.configPath) throw new Error('This data directory already belongs to another automatic startup configuration. It was left untouched.');
    if(existsSync(this.plistPath) && readFileSync(this.plistPath,'utf8')!==this.plist()) throw new Error('An automatic startup job with different contents already exists. It was left untouched.');
  }
  private async mutate<T>(action:()=>Promise<T>) {
    if(!this.supported()) throw new Error('Automatic startup currently requires macOS 12 or later.');
    mkdirSync(this.directory,{recursive:true,mode:0o700});
    const lock=join(this.directory,'control.lock');
    let fd:number;
    try{fd=openSync(lock,'wx',0o600);}catch{throw new Error('Another automatic startup operation is active. Wait for it to finish; verify the owner before removing a stale control.lock.');}
    try{writeFileSync(fd,String(process.pid));return await action();}
    finally{closeSync(fd);rmSync(lock,{force:true});}
  }
  private async loaded() {
    if(!this.supported()) return false;
    try{await this.run('/bin/launchctl',['print',this.service]);return true;}catch{return false;}
  }
  async status() {
    const supported=this.supported(),installed=existsSync(this.plistPath);
    let managed=false;
    if(installed) {try{this.assertOwned();managed=true;}catch{}}
    const paused=existsSync(join(this.directory,'paused'));
    return {supported,installed,managed,paused,enabled:managed&&!paused,loaded:managed&&await this.loaded(),runtime:managed ? readBackgroundStatus(this.setup.dataDir) : undefined};
  }
  async enable() {
    return this.mutate(()=>this.install());
  }
  private async install() {
    this.setup.assertCurrent();this.assertOwned();
    const current=await this.status();
    if(current.enabled && current.loaded) return current;
    if(current.loaded) await this.pause();
    this.setup.assertIdle();
    const config=loadConfig(this.setup.configPath);
    const ids=pairedAccount(config.dataDir);
    if(!ids.length || (config.selfCommands && !ids.some(id=>config.allowedSenderJids.includes(id)))) throw new Error('Link and verify the authorized WhatsApp account before enabling automatic startup.');
    const root=this.options.root ?? resolve(dirname(fileURLToPath(import.meta.url)),'..');
    const entry=join(root,'dist','autostart-entry.js');
    try {
      if(this.options.build) await this.options.build();
      else await this.run('pnpm',['run','build'],{cwd:root});
    } catch {throw new Error('Could not build the background runtime. Run pnpm build and resolve the reported errors.');}
    if(!existsSync(entry)) throw new Error('The built background entry is missing. Run pnpm build before enabling automatic startup.');
    const wasPaused=existsSync(join(this.directory,'paused'));
    mkdirSync(this.directory,{recursive:true,mode:0o700});chmodSync(this.directory,0o700);
    // Keep a failed/partial installation paused, including across login.
    writeFileSync(join(this.directory,'paused'),'Installing automatic startup.\n',{mode:0o600});
    const script=autoStartScript({
      config:this.setup.configPath,dataDir:this.setup.dataDir,node:this.options.node ?? process.execPath,entry,root,
      runtimeFile:this.options.runtimeFile ?? join(resolve(process.env.T3CODE_HOME ?? join(homedir(),'.t3')),'userdata','server-runtime.json'),
      t3Home:process.env.T3CODE_HOME ? resolve(process.env.T3CODE_HOME) : undefined,
      path:[dirname(this.options.node ?? process.execPath),...(process.env.PATH ?? '/usr/bin:/bin').split(':')].join(':'),
    });
    writeFileSync(join(this.directory,'check.sh'),script,{mode:0o700});
    writeFileSync(join(this.directory,'owner.json'),JSON.stringify({configPath:this.setup.configPath})+'\n',{mode:0o600});
    mkdirSync(dirname(this.plistPath),{recursive:true});
    const temporary=this.plistPath+'.tmp';
    writeFileSync(temporary,this.plist(),{mode:0o600});renameSync(temporary,this.plistPath);
    try {
      await this.run('/bin/launchctl',['bootstrap',this.domain,this.plistPath]);
      rmSync(join(this.directory,'paused'));
      await this.run('/bin/launchctl',['kickstart',this.service]);
    } catch {
      writeFileSync(join(this.directory,'paused'),'Automatic startup could not be loaded. Open setup to try again.\n',{mode:0o600});
      throw new Error('macOS could not enable automatic startup. It remains paused; check Background Items permissions and try again.');
    }
    return {...await this.status(),previouslyPaused:wasPaused};
  }
  async disable() {
    return this.mutate(()=>this.pause());
  }
  private async pause() {
    this.assertOwned();
    mkdirSync(this.directory,{recursive:true,mode:0o700});
    writeFileSync(join(this.directory,'paused'),'Paused by the user.\n',{mode:0o600});
    if(!existsSync(this.plistPath)) return this.status();
    if(await this.loaded()) {
      try{await this.run('/bin/launchctl',['bootout',this.service]);}
      catch{throw new Error('Automatic startup is paused, but macOS could not stop its job. Check its status before continuing.');}
    }
    rmSync(this.plistPath,{force:true});
    return this.status();
  }
}
