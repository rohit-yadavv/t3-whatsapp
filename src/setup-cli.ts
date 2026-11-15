import {spawn} from 'node:child_process';
import {Setup} from './setup.js';
import {startSetupServer} from './setup-server.js';

process.umask(0o077);
const args=process.argv.slice(2).filter(arg=>arg!=='--');
try {
  const setup=new Setup();
  if (args[0]==='doctor') {
    const checks=await setup.checks();
    const report={...setup.summary(),checks,ready:checks.every(check=>check.ok),whatsappLiveVerified:false};
    if (args.includes('--json')) console.log(JSON.stringify(report));
    else {
      for (const check of checks) console.log(`${check.ok ? 'OK' : 'ACTION'}: ${check.message}${check.next ? '\n  '+check.next : ''}`);
      console.log('A saved session is not proof of a live connection. Use pnpm setup to connect and test.');
    }
    if (!report.ready) process.exitCode=1;
  } else if (args[0]==='config' && args[1]==='show') {
    console.log(JSON.stringify(setup.summary(),null,args.includes('--json') ? undefined : 2));
  } else if (args.length===0 || args.every(arg=>arg==='--no-open')) {
    const local=await startSetupServer(setup);
    console.log(`Open local setup: ${local.url}`);
    console.log('Keep this URL private. Ctrl+C stops setup and any bridge it starts.');
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
  } else throw new Error('Usage: pnpm setup [--no-open], pnpm doctor [--json], or pnpm config:show [--json]');
} catch(e) {
  const message=e instanceof Error && !['ZodError','SyntaxError'].includes(e.name) && !('code' in e) ? e.message : 'Could not read configuration or acquire the setup lock. Check local configuration, permissions, and existing setup processes. No session was replaced.';
  if (args.includes('--json')) console.log(JSON.stringify({ready:false,checks:[{code:'setup_invalid',ok:false,message}]}));
  else console.error(message);
  process.exitCode=1;
}
