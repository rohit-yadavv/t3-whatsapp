import {closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, rmdirSync, unlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

function ownerIsDead(path:string):boolean {
  const owner=readFileSync(path,'utf8').trim();
  const pid=/^[1-9][0-9]*$/.test(owner) ? Number(owner) : NaN;
  if(!Number.isSafeInteger(pid)) throw new Error('The setup lock has an invalid owner record. Inspect setup.lock before removing it; no session was changed.');
  try {process.kill(pid,0);}
  catch(error) {
    if((error as NodeJS.ErrnoException).code==='ESRCH') return true;
    throw new Error(`Could not verify whether setup PID ${pid} has exited. Its lock was left untouched.`);
  }
  throw new Error(`Setup is already running (PID ${pid}). Close its setup terminal with Ctrl+C, then run pnpm run setup again. The existing process was left untouched.`);
}

/** Recover only a definitely exited setup owner, never a bot's run.lock. */
export function acquireSetupLock(dataDir:string):()=>void {
  const path=join(dataDir,'setup.lock');
  function create() {
    const fd=openSync(path,'wx',0o600);
    try {writeFileSync(fd,String(process.pid));return fstatSync(fd);}
    finally {closeSync(fd);}
  }
  let identity:ReturnType<typeof fstatSync>;
  try {identity=create();}
  catch(error) {
    if((error as NodeJS.ErrnoException).code!=='EEXIST') throw error;
    // Serialize stale-lock recovery so competing setup launches cannot remove
    // the replacement lock after another process has acquired it.
    const recovery=path+'.recovery';
    try {mkdirSync(recovery,{mode:0o700});}
    catch(error) {
      if((error as NodeJS.ErrnoException).code!=='EEXIST') throw error;
      throw new Error('Setup lock recovery is already in progress. Wait and retry. If a recovery crashed, verify no setup is running before removing setup.lock.recovery.');
    }
    try {
      try {identity=create();}
      catch(error) {
        if((error as NodeJS.ErrnoException).code!=='EEXIST') throw error;
        if(ownerIsDead(path)) unlinkSync(path);
        identity=create();
      }
    } finally {rmdirSync(recovery);}
  }
  let released=false;
  const release=()=>{
    if(released)return;
    released=true;process.removeListener('exit',release);
    try {
      const current=lstatSync(path);
      if(current.dev===identity.dev && current.ino===identity.ino && readFileSync(path,'utf8').trim()===String(process.pid)) unlinkSync(path);
    } catch { /* A future setup can recover the lock after this PID exits. */ }
  };
  process.once('exit',release);
  return release;
}
