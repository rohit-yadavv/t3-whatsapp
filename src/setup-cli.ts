import {spawn} from 'node:child_process';
import {Setup} from './setup.js';
import {startSetupServer} from './setup-server.js';
import {AutoStart} from './autostart.js';
import {setupError} from './setup-errors.js';

process.umask(0o077);
const args=process.argv.slice(2).filter(arg=>arg!=='--');
try {
  const setup=new Setup();
  const automatic=new AutoStart(setup);
  if (args[0]==='doctor') {
    const checks=await setup.checks();
    const auto=await automatic.status();
    if(auto.runtime) {
      const index=checks.findIndex(check=>check.code==='runtime_locked');
      if(index>=0) checks[index]={code:'runtime_running',ok:true,message:'The bot is running through automatic startup.'};
    }
    const report={...setup.summary(),automatic:auto,checks,ready:checks.every(check=>check.ok),whatsappLiveVerified:false};
    if (args.includes('--json')) console.log(JSON.stringify(report));
    else {
      for (const check of checks) console.log(`${check.ok ? 'OK' : 'ACTION'}: ${check.message}${check.next ? '\n  '+check.next : ''}`);
      console.log('A saved session is not proof of a live connection. Use pnpm run setup to connect and test.');
    }
    if (!report.ready) process.exitCode=1;
  } else if (args[0]==='config' && args[1]==='show') {
    console.log(JSON.stringify(setup.summary(),null,args.includes('--json') ? undefined : 2));
  } else if (args[0]==='autostart' && ['enable','disable','status'].includes(args[1])) {
    const result=await automatic[args[1] as 'enable'|'disable'|'status']();
    console.log(args.includes('--json') ? JSON.stringify(result) : JSON.stringify(result,null,2));
  } else if (args.length===0 || args.every(arg=>arg==='--no-open')) {
    const local=await startSetupServer(setup);
    console.log(`Open local setup: ${local.url}`);
    console.log('Keep this URL private. Ctrl+C closes setup and terminal-owned tests. Automatic startup continues independently.');
    if (!args.includes('--no-open')) {
      const launcher=process.platform==='darwin' ? 'open' : process.platform==='win32' ? undefined : 'xdg-open';
      if (launcher) {
        const browser=spawn(launcher,[local.url],{stdio:'ignore'});
        browser.on('error',()=>console.log('Open the setup URL above in your browser.'));
        browser.unref();
      }
    }
    const stop=()=>{void local.close().catch(()=>{process.exitCode=1;});};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
  } else throw new Error('Usage: pnpm run setup [--no-open], pnpm run doctor [--json], pnpm config:show [--json], or pnpm autostart enable|disable|status [--json]');
} catch(e) {
  const message=setupError(e);
  if (args.includes('--json')) console.log(JSON.stringify({ready:false,checks:[{code:'setup_invalid',ok:false,message}]}));
  else console.error(message);
  process.exitCode=1;
}
