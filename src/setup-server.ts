import {randomBytes, timingSafeEqual} from 'node:crypto';
import {createServer, type IncomingMessage} from 'node:http';
import {mkdirSync, readFileSync} from 'node:fs';
import {Setup, setupOptions, SetupRuntime} from './setup.js';
import {setupPage} from './setup-page.js';
import {AutoStart} from './autostart.js';
import {acquireSetupLock} from './setup-lock.js';
import {z} from 'zod';
import {setTimeout as delay} from 'node:timers/promises';

const completion=z.object({settings:setupOptions.optional(),automatic:z.boolean().optional()}).strict();
const settingsChange=z.object({settings:setupOptions,automatic:z.boolean().optional()}).strict();

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
export async function startSetupServer(setup=new Setup(),automatic=new AutoStart(setup)) {
  mkdirSync(setup.dataDir,{recursive:true,mode:0o700});
  const releaseLock=acquireSetupLock(setup.dataDir);
  const token=randomBytes(32).toString('hex');
  const runtime=new SetupRuntime(setup);
  let origin='',host='',mutating=false,closing=false;
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Content-Type-Options','nosniff');
    const nonce=randomBytes(18).toString('base64');
    res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`);
    const json=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
    if (req.headers.host!==host || (req.headers.origin && req.headers.origin!==origin)) return json(403,{error:'Only the local setup origin is allowed.'});
    if (req.method==='GET' && req.url==='/assets/logo.png') {
      try {
        const logo=readFileSync(new URL('../assets/logo.png',import.meta.url));
        res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'public, max-age=3600'});res.end(logo);
      } catch {json(404,{error:'Brand asset unavailable.'});}
      return;
    }
    if (req.method==='GET' && req.url==='/') {res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(setupPage(nonce));return;}
    const authorization=Buffer.from(req.headers.authorization ?? '');
    const expected=Buffer.from('Bearer '+token);
    if (authorization.length!==expected.length || !timingSafeEqual(authorization,expected)) return json(401,{error:'Reopen the complete setup URL from your terminal.'});
    if (req.method==='GET' && req.url==='/api/state') {
      const auto=await automatic.status();
      const foreground=runtime.snapshot();
      const summary=setup.summary();
      const runtimeOwner=auto.runtime ? 'background' : ['pairing','starting','running'].includes(foreground.state) ? 'foreground' : summary.runtimeLocked ? 'external' : 'none';
      return json(200,{...summary,automatic:auto,runtime:auto.runtime ?? foreground,runtimeOwner});
    }
    if (req.method!=='POST' || req.headers.origin!==origin) return json(403,{error:'Use a same-origin setup request.'});
    if (mutating || closing) return json(409,{error:'Another operation is in progress. Wait for it to finish.'});
    mutating=true;
    try {
      const input=await body(req);
      switch(req.url) {
        case '/api/settings': {
          const request=settingsChange.parse(input);
          if(!setup.summary().existing) throw new Error('Finish initial setup before editing settings.');
          setup.validateSettings(request.settings);
          const before=await automatic.status();
          const foreground=runtime.snapshot();
          if(foreground.state==='pairing') throw new Error('Finish or cancel account linking before changing settings.');
          const wasForeground=['starting','running'].includes(foreground.state);
          if(setup.summary().runtimeLocked&&!before.runtime&&!wasForeground) return json(409,{error:'Another process is running the bot. Stop it from its own terminal before applying settings.'});
          const resumeAutomatic=request.automatic ?? before.enabled;
          if(before.supported&&(before.enabled||before.loaded||before.runtime)) await automatic.disable();
          if(wasForeground) await runtime.stop();
          const deadline=Date.now()+15000;
          while(setup.summary().runtimeLocked&&Date.now()<deadline) await delay(100);
          if(setup.summary().runtimeLocked) throw new Error('The bot is still stopping. Settings were not saved; try again when it has stopped.');
          setup.save(request.settings);
          try {
            if(before.supported) {
              if(resumeAutomatic) await automatic.enable();else await automatic.disable();
            }
            if(wasForeground&&!(before.supported&&resumeAutomatic)) runtime.start(false);
            return json(200,{saved:true,automatic:await automatic.status()});
          } catch {
            return json(200,{saved:true,automatic:await automatic.status(),startupError:'Settings are saved, but the bot could not restart. Resume it from the connection screen after checking startup permissions.'});
          }
        }
        case '/api/complete': {
          const request=completion.parse(input);
          const before=await automatic.status();
          if(before.enabled) {
            if(!request.settings&&request.automatic!==false) return json(200,{completed:true,automatic:before});
            throw new Error('Pause automatic startup before changing setup.');
          }
          if(request.settings) {
            const checks=await setup.checks(request.settings);
            if(checks.some(check=>!check.ok)) return json(409,{error:checks.filter(check=>!check.ok).map(check=>check.message+' '+(check.next ?? '')).join('\n')});
            setup.save(request.settings);
          } else {
            setup.assertCurrent();setup.assertIdle();
            const summary=setup.summary();
            if(!summary.existing||!summary.session.authorized) throw new Error('Link your account and save preferences before finishing setup.');
          }
          if(!before.supported) return json(200,{completed:true,automatic:before});
          // Completion defaults to automatic startup, while a saved Pause or
          // explicit opt-out stays in effect unless deliberately changed.
          try {
            const result=(request.automatic ?? !before.paused) ? await automatic.enable() : await automatic.disable();
            return json(200,{completed:true,automatic:result});
          } catch {
            return json(200,{completed:false,automatic:await automatic.status(),startupError:'Your settings are saved, but automatic startup could not be updated. Check macOS Background Items permissions and try again.'});
          }
        }
        case '/api/check': return json(200,{checks:await setup.checks(setupOptions.parse(input))});
        case '/api/pair':
          if((await automatic.status()).enabled) throw new Error('Pause automatic startup before linking an account.');
          runtime.start(true);return json(200,{started:true});
        case '/api/save': {
          if((await automatic.status()).enabled) throw new Error('Pause automatic startup before changing configuration.');
          const options=setupOptions.parse(input);
          const checks=await setup.checks(options);
          if (checks.some(c=>!c.ok)) return json(409,{error:checks.filter(c=>!c.ok).map(c=>c.message+' '+(c.next ?? '')).join('\n')});
          return json(200,setup.save(options));
        }
        case '/api/start': {
          if((await automatic.status()).enabled) throw new Error('Automatic startup is enabled. Use Pause before starting a terminal-owned test.');
          if (!setup.summary().existing) throw new Error('Save configuration before starting.');
          const checks=await setup.checks();
          if (checks.some(c=>!c.ok)) return json(409,{error:checks.filter(c=>!c.ok).map(c=>c.message+' '+(c.next ?? '')).join('\n')});
          runtime.start(false);return json(200,{started:true});
        }
        case '/api/auto/enable':
          await runtime.stop();return json(200,await automatic.enable());
        case '/api/auto/disable': return json(200,await automatic.disable());
        case '/api/stop':
          if((await automatic.status()).installed) await automatic.disable();
          await runtime.stop();return json(200,{stopped:true});
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
  } catch(e) {releaseLock();throw e;}
  host=`127.0.0.1:${(server.address() as {port:number}).port}`;origin=`http://${host}`;
  return {url:origin+'/#'+token,origin,token,runtime,async close(){
    if (closing) return;
    closing=true;
    try {
      await new Promise<void>((resolve,reject)=>server.close(e=>e ? reject(e) : resolve()));
      await runtime.stop();
    } finally {releaseLock();}
  }};
}
