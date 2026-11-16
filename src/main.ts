import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync, rmSync, renameSync, chmodSync, closeSync, mkdirSync, openSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import makeWASocket, { DEFAULT_CONNECTION_CONFIG, jidNormalizedUser, useMultiFileAuthState, type WAMessage } from '@whiskeysockets/baileys';
import pino from 'pino';
import qr from 'qrcode-terminal';
import { loadConfig, projectCatalog, isSupportedChat, type Config } from './config.js';
import { hasSelfPrefix, normalize, shouldHandleUpsert } from './messages.js';
import { Store } from './store.js';
import { T3Cli, command } from './t3.js';
import { Bridge } from './bridge.js';
import {documentContent,type Document} from './responses.js';
import {HistoryStore} from './history.js';
import {HistoryRecorder,isMessageMutation,shouldImportHistory} from './history-recorder.js';
import { Worker } from './worker.js';
import { disconnectAction, streamErrorReason } from './connection.js';
import { pairingQrPng } from './pairing-qr.js';
import { T3Availability, T3_SHUTDOWN_GRACE_MS } from './t3-availability.js';
import { backgroundReporter } from './background-status.js';
import { localT3Available } from './local-t3.js';

process.umask(0o077);
// Setup uses the existing runtime over private IPC, never terminal-log parsing.
const setupManaged = Boolean(process.send);
let background: ReturnType<typeof backgroundReporter> | undefined;
function setupEvent(event: string, details: Record<string, unknown> = {}) {
  try {background?.report(event,details);} catch { /* Status reporting must not alter delivery outcomes. */ }
  if (process.connected) process.send?.({event, ...details}, () => {});
}
const pairingOnly = process.argv[2] === 'pair';
const config: Config = pairingOnly ? {
  t3Binary:'t3', dataDir:resolve(process.env.T3_WHATSAPP_DATA_DIR ?? '.data'),
  selfCommands:false, accountWide:false, noProject:'~/.t3/scratch', projects:{}, allowedSenderJids:[], routes:[], pollIntervalMs:15000, maxMessageAgeSeconds:300,
} : loadConfig();
const error = (e: unknown) => console.error(e instanceof Error ? e.message : 'Bridge operation failed.');

if (process.argv[2] === 'doctor') {
  const projects=[...new Set([config.noProject,...projectCatalog(config).values()])];
  for (const project of projects) await command(config.t3Binary,['thread','list','--project',project,'--json']);
  console.log(`Configuration is valid; T3 Code is reachable and all ${projects.length} configured projects are registered.`);
  console.log('WhatsApp pairing is checked when you start the bridge.');
} else {
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  chmodSync(config.dataDir, 0o700);
  const lock = join(config.dataDir, 'run.lock');
  let fd: number;
  try {
    fd = openSync(lock, 'wx', 0o600);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    let owner = 'unknown';
    try { owner = readFileSync(lock, 'utf8').trim(); } catch {}
    console.error(`The WhatsApp data directory is already locked (PID ${owner}).`);
    console.error('Stop the other pnpm pair/dev/start process with Ctrl+C before starting this one.');
    console.error('If the process crashed, confirm its PID is no longer running before removing .data/run.lock.');
    process.exit(1);
  }
  let closeStore: (() => void) | undefined;
  let closeHistory: (() => void) | undefined;
  // Register cleanup before any fallible startup I/O or network awaits.
  process.once('exit', () => {
    try { closeStore?.(); } catch {}
    try { closeHistory?.(); } catch {}
    try {
      rmSync(join(config.dataDir, 'pairing-qr.png'), {force:true});
      rmSync(join(config.dataDir, 'pairing-qr.png.tmp'), {force:true});
      if (readFileSync(lock, 'utf8').trim() === String(process.pid)) unlinkSync(lock);
    } catch {}
  });
  try { writeFileSync(fd, String(process.pid)); } finally { closeSync(fd); }
  if (process.env.T3_WHATSAPP_AUTOSTART_DATA_DIR===config.dataDir && !pairingOnly) {
    background=backgroundReporter(config.dataDir);
    process.once('exit',()=>{try{background?.close();}catch{}});
  }
  const startedAtSeconds = Math.floor(Date.now() / 1000);
  const store = new Store(join(config.dataDir, 'bridge.sqlite'), !pairingOnly);
  closeStore = () => store.close();
  const historyStore=pairingOnly ? undefined : new HistoryStore(join(config.dataDir,'history.sqlite'));
  closeHistory=()=>historyStore?.close();
  const history=historyStore ? new HistoryRecorder(config,historyStore,join(config.dataDir,'history.sqlite'),(chat,id)=>store.isOutgoing(chat,id)) : undefined;
  const bridge = new Bridge(config, store, new T3Cli(config.t3Binary), error,history);
  let socket: ReturnType<typeof makeWASocket> | undefined;
  let connected = false, stopped = false, reconnects = 0, ackRetries = 0, openedAt = 0;
  const qrImage = join(config.dataDir, 'pairing-qr.png');
  let qrSequence = 0, qrOpened = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let t3Availability: T3Availability | undefined;
  let credentialsSaved: Promise<void> = Promise.resolve();
  const worker = new Worker(bridge, store, () => !pairingOnly && connected && !stopped, async (outgoing, quote) => {
    if (!socket) throw new Error('WhatsApp is disconnected.');
    const content=outgoing.document ? documentContent(JSON.parse(outgoing.document) as Document) : {text:outgoing.text};
    const result = await socket.sendMessage(outgoing.group_jid, content, {
      quoted:quote as WAMessage, messageId:outgoing.id,
    });
    if (!result) throw new Error('WhatsApp did not confirm the send.');
    setupEvent('reply-sent');
    try{history?.capture(result);}catch(e){error(e);}
    return result.message ?? {};
  }, error);
  function clearPairingQr() {
    qrSequence++;
    rmSync(qrImage, {force:true});
  }
  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });
  if (setupManaged) process.on('disconnect', () => { void shutdown(); });
  process.on('uncaughtException', e => { error(e); void shutdown(1); });
  process.on('unhandledRejection', e => { error(e); void shutdown(1); });
  const { state, saveCreds } = await useMultiFileAuthState(join(config.dataDir, 'auth'));
  if (stopped) process.exit(0);
  history?.bind([state.creds.me?.id,state.creds.me?.lid].filter((id):id is string=>Boolean(id)));
  function diagnostic(event: string, details: Record<string,string|number|boolean|null> = {}) {
    // Explicit fields only. Never serialize errors, credentials, QR data, or raw messages.
    const record = {time:new Date().toISOString(),event,...details};
    appendFileSync(join(config.dataDir, 'connection.ndjson'), JSON.stringify(record)+'\n', {mode:0o600});
    console.log(`[WhatsApp] ${event}`, JSON.stringify(details));
    setupEvent(event, details);
  }
  // Keep the protocol paired with this Baileys release; newer Web versions can
  // authenticate successfully while failing to deliver incoming messages.
  const version = DEFAULT_CONNECTION_CONFIG.version;
  diagnostic('protocol-version', {version:version.join('.'),source:'bundled'});

  function connect() {
    if (stopped) return;
    const current = makeWASocket({
      auth: state, version, logger: pino({level:'silent'}),
      markOnlineOnConnect: false, syncFullHistory: false,
      shouldSyncHistoryMessage: message => shouldImportHistory(Boolean(history?.enabled && history.options.importRecent),message.syncType),
      getMessage: async key => key.id ? store.message(key.id) : undefined,
    });
    socket = current;
    current.ev.on('creds.update', () => {
      credentialsSaved = credentialsSaved.then(saveCreds).catch(e => { error(e); void shutdown(1); });
    });
    current.ev.on('connection.update', update => {
      if (current !== socket || stopped) return;
      if(update.receivedPendingNotifications) diagnostic('messages-ready');
      if (update.isNewLogin) {
        diagnostic('pairing-accepted');
        clearPairingQr();
      }
      if (update.qr) {
        diagnostic('qr-ready');
        console.log('Scan locally using the bot account: WhatsApp → Linked devices → Link a device. Keep this QR private.');
        if (!setupManaged) qr.generate(update.qr, {small:true});
        const sequence = ++qrSequence;
        void pairingQrPng(update.qr).then(png => {
          if (stopped || connected || current !== socket || sequence !== qrSequence) return;
          const temporary = qrImage + '.tmp';
          writeFileSync(temporary, png, {mode:0o600});
          renameSync(temporary, qrImage);
          setupEvent('setup-qr', {png:png.toString('base64')});
          console.log(`Full-size QR image: ${qrImage}`);
          console.log('Scan the image in Preview, rather than the terminal blocks. Use the newest QR; keep pairing running.');
          if (pairingOnly && !setupManaged && process.platform === 'darwin' && !qrOpened) {
            qrOpened = true;
            const viewer = spawn('open', [qrImage], {stdio:'ignore'});
            viewer.on('error', () => console.error(`Open the QR image manually: ${qrImage}`));
            viewer.unref();
          }
        }).catch(error);
      }
      if (update.connection === 'open') {
        clearPairingQr();
        history?.bind([current.user?.id,current.user?.lid].filter((id):id is string=>Boolean(id)));
        diagnostic('connected');
        if(history)diagnostic('history-ready',{enabled:history.enabled,retentionDays:history.options.retentionDays,recentImport:history.options.importRecent});
        connected = true; reconnects = 0; openedAt = Date.now();
        console.log('WhatsApp connected. Only configured groups and authorized senders can start tasks.');
        if (config.selfCommands) console.log(config.accountWide ? 'Account-wide mode: use @bot #project-name followed by a task in any personal chat, group, or Message yourself.' : 'Single-account mode: type @bot followed by a task in your configured chat.');
        if (pairingOnly) {
          if (setupManaged) {
            credentialsSaved=credentialsSaved.then(saveCreds);
            void credentialsSaved.then(() => {
              setupEvent('setup-paired');
              void shutdown();
            }).catch(e => { error(e); void shutdown(1); });
            return;
          }
          console.log('Bot identifiers:', [current.user?.id, current.user?.lid].filter(Boolean).map(id=>jidNormalizedUser(id!)).join(', '));
          void current.groupFetchAllParticipating().then(groups => {
            console.log('Joined groups (private local setup output):');
            for (const g of Object.values(groups)) console.log(`${g.id}  ${g.subject}`);
            console.log('Add a group ID and your own sender JIDs to config.json. Press Ctrl+C before running pnpm dev.');
          }).catch(error);
        }
        console.log(`Local review items: ${store.tasks('review').length} tasks. Data: ${config.dataDir}`);
        void worker.tick();
      }
      if (update.connection === 'close') {
        const wasConnected = connected;
        connected = false;
        const reason = (update.lastDisconnect?.error as {output?:{statusCode?:number}} | undefined)?.output?.statusCode;
        const streamReason = streamErrorReason(update.lastDisconnect?.error);
        if (wasConnected && Date.now() - openedAt >= 60000) ackRetries = 0;
        const action = disconnectAction(reason, streamReason, ackRetries);
        if (reason === 500 && streamReason === 'ack' && action === 'retry') ackRetries++;
        diagnostic('disconnected', {code:reason ?? null,action,streamReason:streamReason ?? null});
        if (action === 'stop') {
          console.error(`WhatsApp stopped (${reason}). Check the phone and connection.ndjson before trying again.`);
          void shutdown(1); return;
        }
        const delay = action === 'restart' ? 0 : Math.min(30000, 1000 * 2 ** Math.min(reconnects++,5));
        // A successful QR link normally requests a restart (515). Persist the
        // credentials before making the replacement socket and keep this version.
        void credentialsSaved.then(() => {
          if (!stopped) reconnectTimer = setTimeout(connect, delay);
        });
      }
    });
    current.ev.on('messaging-history.set', event=>{if(current===socket && !stopped && shouldImportHistory(Boolean(history?.enabled && history.options.importRecent),event.syncType))history?.import(event.messages);});
    current.ev.on('messages.update', event=>{if(current===socket && !stopped)history?.update(event);});
    current.ev.on('messages.delete', event=>{if(current===socket && !stopped)history?.delete(event);});
    current.ev.on('chats.delete', chats=>{if(current===socket && !stopped)for(const jid of chats)history?.delete({jid,all:true});});
    current.ev.on('messages.upsert', event => {
      if (current !== socket || stopped) return;
      diagnostic('message-batch',{count:event.messages.length,type:event.type,requested:Boolean(event.requestId)});
      if (pairingOnly) {
        for (const raw of event.messages) {
          const m=normalize(raw);
          if (!m.fromMe && m.group.endsWith('@g.us')) console.log('Setup identifiers:', JSON.stringify({groupJid:m.group,senderJid:m.sender,senderAlt:m.senderAlt || undefined}));
        }
        return;
      }
      const ids = [current.user?.id, current.user?.lid].filter((id): id is string => Boolean(id)).map(jidNormalizedUser);
      let acceptedAny = false;
      for (const raw of event.messages) {
        history?.capture(raw);
        const message = normalize(raw);
        if(event.requestId || isMessageMutation(raw))continue;
        if (message.timestamp>=startedAtSeconds && !store.isOutgoing(message.group,message.id))void history?.requestRecent(raw,(count,key,timestamp)=>current.fetchMessageHistory(count,key,timestamp));
        if (!shouldHandleUpsert(event.type, message, config.selfCommands, startedAtSeconds)) continue;
        const accepted = bridge.accept(message, ids);
        if (accepted) setupEvent('command-accepted');
        acceptedAny ||= accepted;
        if (isSupportedChat(message.group) && (config.accountWide || config.routes.some(route => route.chatJid === message.group)) && (accepted || hasSelfPrefix(message.text) || store.isOutgoing(message.group,message.quotedId))) {
          diagnostic('command-check', {accepted, fromMe:message.fromMe, hasPrefix:hasSelfPrefix(message.text), type:event.type});
        }
      }
      if (acceptedAny) void worker.tick();
    });
  }
  if (!pairingOnly) {
    t3Availability=new T3Availability(
      async () => {
        const runtimeFile=process.env.T3_WHATSAPP_AUTOSTART_RUNTIME_FILE;
        if(runtimeFile) {
          if(!await localT3Available(runtimeFile)) throw new Error('T3 backend unavailable.');
        } else await command(config.t3Binary,['thread','list','--project',config.noProject,'--json'],'',{timeoutMs:5000});
      },
      () => { void shutdown(); },
      event => diagnostic(event,{graceMinutes:T3_SHUTDOWN_GRACE_MS/60000}),
    );
    void t3Availability.tick();
  }
  timer = setInterval(() => { history?.prune(); void t3Availability?.tick(); void worker.tick(); }, config.pollIntervalMs);
  async function shutdown(code = 0) {
    if (stopped) return;
    t3Availability?.stop();
    stopped = true; clearPairingQr(); clearInterval(timer); clearTimeout(reconnectTimer);
    socket?.end(undefined);
    let saved = false;
    void credentialsSaved.then(() => { saved = true; }, () => { saved = true; });
    const deadline = Date.now() + 10000;
    const wait = setInterval(() => {
      if ((!worker.running && saved) || Date.now() >= deadline) {
        clearInterval(wait);
        // Unfinished side effects remain marked for review on restart.
        process.exit(worker.running || !saved ? 1 : code);
      }
    },100);
  }
  connect();
}
