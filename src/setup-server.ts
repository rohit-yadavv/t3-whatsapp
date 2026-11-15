import {randomBytes, timingSafeEqual} from 'node:crypto';
import {createServer, type IncomingMessage} from 'node:http';
import {closeSync, mkdirSync, openSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {Setup, setupOptions, SetupRuntime} from './setup.js';
import {setupPage} from './setup-page.js';

async function body(req:IncomingMessage) {
  if (req.headers['content-type']!=='application/json') throw new Error('Expected application/json.');
  req.setEncoding('utf8');
  let data='';
  for await (const chunk of req) {
    data+=chunk;
    if (Buffer.byteLength(data)>16384) throw new Error('Request is too large.');
  }
  return JSON.parse(data);
}
export async function startSetupServer(setup=new Setup()) {
  mkdirSync(setup.dataDir,{recursive:true,mode:0o700});
  const lock=join(setup.dataDir,'setup.lock');
  const fd=openSync(lock,'wx',0o600);
  writeFileSync(fd,String(process.pid));closeSync(fd);
  const token=randomBytes(32).toString('hex');
  const runtime=new SetupRuntime(setup);
  let origin='',host='',mutating=false,closing=false;
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Content-Type-Options','nosniff');
    const nonce=randomBytes(18).toString('base64');
    res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`);
    const json=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
    if (req.headers.host!==host || (req.headers.origin && req.headers.origin!==origin)) return json(403,{error:'Only the local setup origin is allowed.'});
    if (req.method==='GET' && req.url==='/') {res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(setupPage(nonce));return;}
    const authorization=Buffer.from(req.headers.authorization ?? '');
    const expected=Buffer.from('Bearer '+token);
    if (authorization.length!==expected.length || !timingSafeEqual(authorization,expected)) return json(401,{error:'Reopen the complete setup URL from your terminal.'});
    if (req.method==='GET' && req.url==='/api/state') return json(200,{...setup.summary(),runtime:runtime.snapshot()});
    if (req.method!=='POST' || req.headers.origin!==origin) return json(403,{error:'Use a same-origin setup request.'});
    if (mutating || closing) return json(409,{error:'Another operation is in progress. Wait for it to finish.'});
    mutating=true;
    try {
      const input=await body(req);
      switch(req.url) {
        case '/api/check': return json(200,{checks:await setup.checks(setupOptions.parse(input))});
        case '/api/pair': runtime.start(true);return json(200,{started:true});
        case '/api/save': {
          const options=setupOptions.parse(input);
          const checks=await setup.checks(options);
          if (checks.some(c=>!c.ok)) return json(409,{error:checks.filter(c=>!c.ok).map(c=>c.message+' '+(c.next ?? '')).join('\n')});
          return json(200,setup.save(options));
        }
        case '/api/start': {
          if (!setup.summary().existing) throw new Error('Save configuration before starting.');
          const checks=await setup.checks();
          if (checks.some(c=>!c.ok)) return json(409,{error:checks.filter(c=>!c.ok).map(c=>c.message+' '+(c.next ?? '')).join('\n')});
          runtime.start(false);return json(200,{started:true});
        }
        case '/api/stop': await runtime.stop();return json(200,{stopped:true});
        default: return json(404,{error:'Unknown setup operation.'});
      }
    } catch(e) {
      // No validation inputs, filesystem errors, identifiers, or child logs in browser errors.
      const message=e instanceof Error && !['ZodError','SyntaxError'].includes(e.name) && !('code' in e) ? e.message : 'Setup could not complete this operation. Check the inputs and local file permissions.';
      json(400,{error:message});
    } finally {mutating=false;}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  try {
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve());});
  } catch(e) {rmSync(lock,{force:true});throw e;}
  host=`127.0.0.1:${(server.address() as {port:number}).port}`;origin=`http://${host}`;
  return {url:origin+'/#'+token,origin,token,runtime,async close(){
    if (closing) return;
    closing=true;
    try {
      await new Promise<void>((resolve,reject)=>server.close(e=>e ? reject(e) : resolve()));
      await runtime.stop();
    } finally {rmSync(lock,{force:true});}
  }};
}
