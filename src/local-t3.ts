import {readFileSync} from 'node:fs';

/** Inspect T3's runtime descriptor, never its database or authentication files. */
export async function localT3Available(runtimeFile:string):Promise<boolean> {
  try {
    const runtime=JSON.parse(readFileSync(runtimeFile,'utf8')) as {pid?:unknown;origin?:unknown};
    if(typeof runtime.pid!=='number' || !Number.isInteger(runtime.pid) || runtime.pid<=0 || typeof runtime.origin!=='string') return false;
    const url=new URL(runtime.origin);
    if(url.protocol!=='http:' || !['127.0.0.1','localhost'].includes(url.hostname) || url.username || url.password || url.pathname!=='/' || url.search || url.hash) return false;
    process.kill(runtime.pid,0);
    const response=await fetch(new URL('/.well-known/t3/environment',url),{signal:AbortSignal.timeout(2000),redirect:'error'});
    if(!response.ok) {await response.body?.cancel();return false;}
    const descriptor=await response.json() as {environmentId?:unknown;serverVersion?:unknown};
    return typeof descriptor.environmentId==='string' && descriptor.environmentId.length>0 && typeof descriptor.serverVersion==='string' && descriptor.serverVersion.length>0;
  } catch {return false;}
}
