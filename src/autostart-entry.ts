import {existsSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {loadConfig} from './config.js';
import {pairedAccount} from './setup.js';
import {localT3Available} from './local-t3.js';

// Started only by the native launchd check. No IPC parent or frontend process.
process.umask(0o077);
const expected=resolve(process.env.T3_WHATSAPP_AUTOSTART_DATA_DIR ?? process.argv[2] ?? '.data');
const paused=join(expected,'autostart','paused');
try {
  if(!existsSync(paused) && !existsSync(join(expected,'run.lock'))) {
    const config=loadConfig();
    if(config.dataDir!==expected) throw new Error('data_directory_changed');
    const ids=pairedAccount(expected);
    if(!ids.length || (config.selfCommands && !ids.some(id=>config.allowedSenderJids.includes(id)))) throw new Error('session_needs_attention');
    const runtimeFile=process.env.T3_WHATSAPP_AUTOSTART_RUNTIME_FILE;
    if(runtimeFile && await localT3Available(runtimeFile)) await import('./main.js');
  }
} catch {
  writeFileSync(paused,'Automatic startup needs attention. Open setup and run checks before enabling it again.\n',{mode:0o600});
  console.error('Automatic startup paused. Open setup and run checks; credentials and pending work were preserved.');
  process.exitCode=1;
}
