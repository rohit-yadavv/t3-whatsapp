import {existsSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

export interface BackgroundSnapshot {
  pid:number;
  state:'starting'|'running'|'idle';
  connected:boolean;
  commandAccepted:boolean;
  replySent:boolean;
  t3Available?:boolean;
  stopReason?:'t3_unavailable';
}
export function writePrivateJson(path:string, value:unknown) {
  const temporary=path+'.tmp';
  writeFileSync(temporary,JSON.stringify(value)+'\n',{mode:0o600});
  renameSync(temporary,path);
}
export function readBackgroundStatus(dataDir:string):BackgroundSnapshot|undefined {
  try {
    const value=JSON.parse(readFileSync(join(dataDir,'autostart','status.json'),'utf8')) as BackgroundSnapshot;
    if (!Number.isInteger(value.pid) || value.pid<=0) return;
    process.kill(value.pid,0);
    if (readFileSync(join(dataDir,'run.lock'),'utf8').trim()!==String(value.pid)) return;
    return value;
  } catch {return;}
}
export function backgroundReporter(dataDir:string) {
  const directory=join(dataDir,'autostart');
  const path=join(directory,'status.json');
  const snapshot:BackgroundSnapshot={pid:process.pid,state:'starting',connected:false,commandAccepted:false,replySent:false};
  const save=()=>writePrivateJson(path,snapshot);
  save();
  return {
    report(event:string,details:Record<string,unknown>={}) {
      switch(event) {
        case 'connected': snapshot.state='running';snapshot.connected=true;break;
        case 'disconnected':
          snapshot.connected=false;
          if(details.action==='stop') writeFileSync(join(directory,'paused'),'WhatsApp needs attention. Open setup to verify the session.\n',{mode:0o600});
          break;
        case 'command-accepted': snapshot.commandAccepted=true;break;
        case 'reply-sent': snapshot.replySent=true;break;
        case 't3-unavailable': snapshot.t3Available=false;break;
        case 't3-recovered': snapshot.t3Available=true;break;
        case 't3-auto-stop': snapshot.stopReason='t3_unavailable';break;
        default:return;
      }
      save();
    },
    close() {
      // A new owner must never be overwritten by an old process's exit handler.
      if(existsSync(join(dataDir,'run.lock')) && readFileSync(join(dataDir,'run.lock'),'utf8').trim()!==String(process.pid)) return;
      snapshot.state='idle';snapshot.connected=false;save();
    },
  };
}
