import {accessSetting, setupScreen} from './setup-screen.js';

/** Bundled local UI. No CDN, build-time framework, or browser-persisted credentials. */
export function setupPage(nonce:string) {return String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>T3 WhatsApp · Connect</title>
<link rel="icon" type="image/png" href="/assets/logo.png">
<style nonce="${nonce}">
:root{color-scheme:light;--bg:#f7fbf8;--surface:#fff;--ink:#082c23;--muted:#5b7066;--line:#dce9e1;--green:#176b4f;--green-soft:#edf6f0;--amber:#8a591c;--red:#a3332d;--radius:12px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);line-height:1.55;-webkit-font-smoothing:antialiased}button,input,select{font:inherit}button,a,input,select,summary{-webkit-tap-highlight-color:transparent}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #8abc9f;outline-offset:4px}button{border:0}h1,h2,p{margin:0}h1{font-size:34px;line-height:1.18;letter-spacing:-1.3px;font-weight:650}h2{font-size:17px;letter-spacing:-.35px;font-weight:650}p{color:var(--muted)}[hidden]{display:none!important}
.topbar{height:70px;background:var(--bg)}.topbar-inner{height:100%;max-width:904px;padding:0 32px;margin:auto;display:flex;align-items:center;justify-content:space-between;gap:20px;border-bottom:1px solid var(--line)}.brand{display:flex;align-items:center;gap:7px;min-width:0}.brand-logo{display:block;width:48px;height:48px;object-fit:contain;flex:none}.brand-name{font-size:15px;font-weight:650;letter-spacing:-.3px;line-height:1.2;color:var(--ink);white-space:nowrap}.header-right{display:flex;align-items:center;gap:20px}.text-button{background:none;color:var(--muted);padding:5px 0;font-size:13px;font-weight:550}.text-button:hover{color:var(--ink)}.nav-settings{padding:8px 13px;border:1px solid #cfe2d6;background:#f3f9f5;border-radius:7px;color:var(--green)}.nav-settings:hover{background:#e9f4ed}
main{max-width:904px;padding:32px 32px 0;margin:auto}.progress{display:flex;align-items:center;gap:14px;margin:0 0 26px;padding:0;list-style:none;max-width:560px}.progress li{display:flex;align-items:center;gap:9px;white-space:nowrap;color:#697161;font-size:12px;font-weight:550}.progress li:not(:last-child)::after{content:'';width:50px;height:1px;background:#dce1d6;margin-left:5px}.step-number{width:23px;height:23px;display:grid;place-items:center;border:1px solid #d5dbcf;border-radius:50%;font-size:11px;background:var(--bg)}.progress [aria-current=step]{color:var(--ink)}.progress [aria-current=step] .step-number{background:var(--ink);border-color:var(--ink);color:white}.progress .complete{color:var(--green)}.progress .complete .step-number{background:var(--green-soft);border-color:#cfdfd0;color:var(--green)}
.page-heading{margin-bottom:25px}.page-heading>p{font-size:14px;margin-top:10px;max-width:570px}.connection-strip{display:flex;align-items:center;gap:26px;margin:0 0 22px;font-size:12px}.connection{display:flex;align-items:center;gap:7px}.connection-label{color:var(--muted)}.status-dot{width:6px;height:6px;border-radius:50%;background:#a0a69b}.connection[data-state=ok] .status-dot{background:#33805b}.connection[data-state=waiting] .status-dot{background:#b88d44}.connection[data-state=error] .status-dot{background:#ae4940}.connection-value{font-weight:550}.panel{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}.panel-body{padding:30px}.pair-layout{display:grid;grid-template-columns:1fr 320px;min-height:300px}.pair-copy{padding:28px}.pair-copy>p{margin-top:6px;font-size:13px}.instructions{display:grid;gap:22px;margin:27px 0;padding:0;list-style:none}.instructions li{display:flex;gap:12px;align-items:flex-start}.instruction-number{flex:none;border:1px solid var(--line);border-radius:6px;width:25px;height:25px;display:grid;place-items:center;font:11px ui-monospace,SFMono-Regular,monospace;color:var(--muted)}.instructions p{color:var(--ink);font-size:13px;line-height:1.7}.instructions strong{font-weight:600}.qr-side{border-left:1px solid var(--line);padding:26px;background:#f3f9f5;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px}.qr-well{height:228px;width:228px;max-width:100%;border:1px solid #dbe1d4;border-radius:10px;background:white;display:grid;place-items:center;padding:12px;position:relative}.qr-well[data-state=idle]{background:transparent;border-color:transparent}.qr-empty{display:flex;flex-direction:column;align-items:center;gap:17px;text-align:center}.qr-symbol{width:50px;height:50px;border:1px solid var(--line);border-radius:10px;display:grid;place-items:center;font:600 15px ui-monospace,SFMono-Regular,monospace;color:#76826d;letter-spacing:-1px}.qr-empty p{font-size:12px;max-width:170px}.qr-well img{position:absolute;inset:12px;display:block;width:calc(100% - 24px);height:calc(100% - 24px);object-fit:contain;image-rendering:pixelated}.spinner{height:26px;width:26px;border:2px solid #e0e7d9;border-top-color:var(--green);border-radius:50%;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
.button{display:inline-flex;align-items:center;justify-content:center;gap:9px;min-height:40px;padding:9px 16px;border-radius:7px;font-size:13px;font-weight:600;line-height:1.5;white-space:nowrap;background:white;color:var(--ink);border:1px solid #d4dbce}.button:hover:not(:disabled){background:#f3f5ef}.button.primary{color:white;background:var(--green);border-color:var(--green)}.button.primary:hover:not(:disabled){background:#10563e}.button-arrow{font-size:16px;font-weight:400}.panel-footer{padding:16px 28px;border-top:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:20px;background:#fcfcfa}.panel-footer p{font-size:12px;max-width:450px}.actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:23px}.notice{border:1px solid #d5e3d1;background:var(--green-soft);color:#31533a;padding:12px 15px;border-radius:8px;margin-bottom:20px;font-size:13px;white-space:pre-wrap}.notice[data-error=true]{border-color:#edcfc9;background:#fff5f0;color:#87372e}
.centered{text-align:center;padding:42px 30px}.centered h2{font-size:21px;letter-spacing:-.65px;margin-top:17px}.centered>p{max-width:440px;margin:9px auto 0;font-size:13px}.centered .actions{justify-content:center}.state-symbol{width:46px;height:46px;margin:auto;border:1px solid #dce5d7;border-radius:12px;background:#f1f6ed;color:var(--green);display:grid;place-items:center;font-size:20px;font-weight:500}.loading{min-height:280px;display:flex;align-items:center;justify-content:center;gap:12px;color:var(--muted)}
fieldset{border:0;padding:0;margin:0 0 27px}legend,.field-label{font-size:13px;font-weight:600;margin-bottom:10px;display:block}.access-options{display:grid;grid-template-columns:1fr 1fr;gap:12px}.access-option{position:relative;border:1px solid #dbe1d5;border-radius:8px;padding:17px;display:flex;gap:11px;align-items:flex-start;cursor:pointer}.access-option:has(input:checked){border-color:#3a9570;background:#f0f8f3;box-shadow:0 0 0 1px #3a9570}.access-option input{accent-color:var(--green);width:15px;height:15px;margin:3px 0 0;flex:none}.access-option strong{display:block;font-size:13px;font-weight:600;margin-bottom:4px}.access-option small{display:block;color:var(--muted);font-size:12px;line-height:1.65}.access-option.existing{grid-column:1/-1}.field-row{display:grid;grid-template-columns:1fr 235px;gap:24px;align-items:center;padding-top:25px;border-top:1px solid var(--line)}.field-row .field-label{margin-bottom:5px}.field-help{font-size:12px;max-width:420px}select,input[type=text]{font-size:13px;background:white;border:1px solid #cbd3c4;border-radius:7px;padding:10px 12px;color:var(--ink);width:100%;min-height:40px}select{cursor:pointer}.startup-choice{display:flex;align-items:center;gap:10px;margin-top:23px;font-size:13px;cursor:pointer}.startup-choice input{accent-color:var(--green);width:16px;height:16px;margin:0}.privacy-note{margin-top:15px;font-size:12px;line-height:1.75;max-width:620px}.setting-lock{display:flex;justify-content:space-between;align-items:center;gap:15px;padding:13px 16px;background:var(--green-soft);border:1px solid var(--line);border-radius:8px;margin-bottom:20px}.setting-lock p{font-size:12px;color:var(--muted)}.summary-list{list-style:none;padding:0;margin:0}.summary-list li{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:14px 0;border-bottom:1px solid #eceee7;font-size:13px}.summary-list li:last-child{border-bottom:0}.summary-list span:first-child{color:var(--muted)}.summary-list strong{font-weight:550;text-align:right}.ready-intro{display:flex;align-items:center;gap:15px;padding-bottom:24px;margin-bottom:12px;border-bottom:1px solid var(--line)}.ready-intro .state-symbol{flex:none;margin:0}.ready-intro p{font-size:13px;margin-top:3px}
.dashboard-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:20px}.dashboard-heading h1{font-size:31px}.dashboard-status{display:grid;grid-template-columns:1fr 1fr}.service{padding:25px 28px}.service+ .service{border-left:1px solid var(--line)}.service-top{display:flex;justify-content:space-between;gap:10px;align-items:center;font-size:13px;font-weight:600}.service-name{display:flex;align-items:center;gap:10px}.service-state{font-size:11px;color:var(--muted);font-weight:500}.service p{font-size:12px;margin-top:12px;line-height:1.7}.dashboard-bottom{padding:22px 28px;border-top:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:20px}.dashboard-bottom strong{font-size:13px;font-weight:600}.dashboard-bottom p{font-size:12px;margin-top:4px}.test-box{margin-top:19px;padding:21px 25px;background:#edf6f0;border:1px solid #e0e6d9;border-radius:10px;display:flex;align-items:center;justify-content:space-between;gap:24px}.test-box strong{font-size:13px;display:block;font-weight:600}.test-box p{font-size:12px;margin-top:4px}.copy-command{flex:none;min-width:94px;cursor:pointer;background:#fff;border:1px solid #dbe2d4;border-radius:6px;padding:9px 14px;font:13px ui-monospace,SFMono-Regular,monospace;color:#36573d}.copy-command:hover{background:var(--green-soft);border-color:var(--green)}.copy-command code{font:inherit;user-select:text}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.details{margin-top:23px;border-bottom:1px solid var(--line);padding-bottom:18px}.details summary{font-size:12px;color:var(--muted);cursor:pointer;list-style:none;display:flex;align-items:center;gap:7px}.details summary::before{content:'+';font:15px ui-monospace,SFMono-Regular,monospace}.details[open] summary::before{content:'−'}.details-content{padding:21px 0 3px}.details-intro{font-size:12px;margin-bottom:18px}.technical-fields{display:grid;grid-template-columns:1fr 1fr;gap:16px}.technical-fields label{display:block;font-size:12px;font-weight:550;margin-bottom:7px}.technical-fields small{display:block;color:var(--muted);font-size:11px;margin-top:6px}.diagnostics{font:11px/1.8 ui-monospace,SFMono-Regular,monospace;color:var(--muted);overflow-wrap:anywhere;padding:14px 0;margin:0}.details .button{font-size:12px;min-height:34px;padding:6px 12px}
@media(max-width:700px){.topbar{height:64px}.topbar-inner{padding:0 16px}.brand{gap:7px}.brand-logo{width:44px;height:44px}.brand-name{font-size:14px}.header-right{gap:12px}.nav-settings{padding:7px 10px}main{padding:28px 20px 0}h1{font-size:29px}.progress{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:27px;max-width:100%}.progress li{font-size:11px;gap:6px;flex-direction:column;align-items:flex-start;white-space:normal;line-height:1.4}.progress li:not(:last-child)::after{display:none}.connection-strip{gap:18px;font-size:11px;flex-wrap:wrap}.pair-layout{grid-template-columns:1fr}.pair-copy{padding:25px}.pair-copy>p{max-width:330px}.instructions{gap:17px;margin:22px 0}.qr-side{grid-row:1;border-left:0;border-top:0;border-bottom:1px solid var(--line);padding:24px}.qr-well{height:228px;width:228px}.panel-body{padding:24px}.panel-footer{padding:17px 22px;align-items:flex-start;flex-direction:column;gap:13px}.panel-footer .button{width:100%}.access-options{grid-template-columns:1fr}.access-option.existing{grid-column:auto}.field-row{grid-template-columns:1fr;gap:12px}.technical-fields{grid-template-columns:1fr}.dashboard-status{grid-template-columns:1fr}.service{padding:22px}.service+ .service{border-left:0;border-top:1px solid var(--line)}.dashboard-heading{align-items:flex-start}.dashboard-heading h1{font-size:28px}.dashboard-bottom{padding:21px;align-items:flex-start;flex-direction:column}.dashboard-bottom>.button{width:100%}.test-box{align-items:flex-start;padding:20px;gap:14px}.copy-command{padding:8px 10px}.setting-lock{align-items:flex-start;flex-direction:column}.summary-list strong{max-width:60%}.centered{padding:32px 22px}}
@media(prefers-reduced-motion:reduce){.spinner{animation:none}}
</style>
</head>
<body>
<header class="topbar"><div class="topbar-inner"><div class="brand"><img class="brand-logo" src="/assets/logo.png" alt="" width="48" height="48"><span class="brand-name">T3 WhatsApp</span></div><nav class="header-right" aria-label="App navigation"><button id="settings" class="text-button nav-settings" hidden>Settings</button></nav></div></header>
<main>
<ol class="progress" id="progress" aria-label="Setup progress"><li data-progress="0"><span class="step-number">1</span>Connect account</li><li data-progress="1"><span class="step-number">2</span>Preferences</li><li data-progress="2"><span class="step-number">3</span>Finish setup</li></ol>
<div class="notice" id="notice" role="status" aria-live="polite" hidden></div>
<div class="page-heading" id="page-heading"><h1 id="title">Getting things ready.</h1><p id="subtitle">Checking your connection to T3 Code.</p></div>
<div class="connection-strip" id="connections" hidden><div class="connection" id="t3-connection"><span class="status-dot"></span><span class="connection-label">T3 Code</span><span class="connection-value" id="t3-label">Checking</span></div><div class="connection" id="wa-connection"><span class="status-dot"></span><span class="connection-label">WhatsApp</span><span class="connection-value" id="wa-label">Not linked</span></div></div>
<section id="loading-panel" class="panel" aria-label="Loading setup"><div class="loading"><div class="spinner" aria-hidden="true"></div><span>Checking this computer…</span></div></section>
<section id="t3-panel" class="panel" hidden><div class="centered"><h2>Open T3 Code to continue.</h2><p>Keep T3 running on this computer. Once it’s available, we’ll help you link WhatsApp.</p><div class="actions"><button class="button primary" id="retry-t3">Check connection <span class="button-arrow" aria-hidden="true">↻</span></button></div></div></section>
<section id="blocked-panel" class="panel" hidden><div class="centered"><h2>Another session needs attention.</h2><p>A bot or account-linking session may already be open. Finish or close that session, then check again here.</p><p>We’ll leave its work and your saved account untouched.</p><div class="actions"><button class="button primary" id="retry-lock">Check again <span class="button-arrow" aria-hidden="true">↻</span></button></div></div></section>
<section id="pair-panel" class="panel" hidden><div class="pair-layout"><div class="pair-copy"><h2>On your phone</h2><ol class="instructions"><li><span class="instruction-number">1</span><p>Open <strong>WhatsApp</strong> on your phone.</p></li><li><span class="instruction-number">2</span><p>Go to <strong>Settings → Linked devices</strong><br>and tap <strong>Link a device</strong>.</p></li><li><span class="instruction-number">3</span><p>Point your phone at the QR code.</p></li></ol></div><div class="qr-side"><div class="qr-well" id="qr-well" data-state="idle"><div id="qr-empty" class="qr-empty"><div class="qr-symbol" aria-hidden="true" hidden></div><p id="pair-status" hidden></p><button id="pair" class="button primary">Connect WhatsApp</button></div><img id="qr" alt="Private WhatsApp device linking QR code" hidden></div><button id="cancel-pair" class="text-button" hidden>Cancel linking</button></div></div></section>
<section id="preferences-panel" class="panel" hidden><div class="panel-body"><div class="setting-lock" id="settings-lock" hidden><p>Changes apply when you save.</p></div><fieldset id="access-fields"><legend>Where should the bot work?</legend><div class="access-options"><label class="access-option"><input type="radio" name="access" value="self" checked><span><strong>Message yourself</strong><small>A private place to start.<br>Use the bot in your self-chat.</small></span></label><label class="access-option"><input type="radio" name="access" value="all"><span><strong>All my chats</strong><small>Use your own commands in<br>personal chats and groups.</small></span></label><label class="access-option existing" id="existing-access" hidden><input type="radio" name="access" value="existing"><span><strong>Selected chats</strong><small id="existing-access-description">Use your configured chat list.</small></span></label></div></fieldset><div class="field-row"><div><label class="field-label" for="history">Conversation history</label><p class="field-help">Save recent messages locally so T3 can look up context.</p></div><select id="history"><option value="0">Don’t save history</option><option value="7">Keep for 7 days</option><option value="30">Keep for 30 days</option><option value="90">Keep for 90 days</option></select></div><p class="privacy-note">When enabled, history includes ordinary messages from everyone in enabled chats. Relevant context may be sent to your AI provider. Turning history off clears it when the bot starts; task records and files are kept separately.</p><label class="startup-choice" id="startup-choice"><input id="auto-start" type="checkbox" data-startup checked>Start automatically with T3</label></div><div class="panel-footer"><button id="preferences-back" class="text-button">Back</button><button id="save" class="button primary">Finish setup <span class="button-arrow" aria-hidden="true">→</span></button></div></section>
<section id="finish-panel" class="panel" hidden><div class="panel-body"><div class="ready-intro"><div class="state-symbol" aria-hidden="true">✓</div><div><h2>Your account is linked.</h2><p>One last thing: choose how the bot runs.</p></div></div><ul class="summary-list"><li><span>Chat access</span><strong id="access-summary">Message yourself</strong></li><li><span>History</span><strong id="history-summary">Off</strong></li><li><span>When T3 closes</span><strong>Stops after 5 minutes</strong></li></ul><label class="startup-choice" id="finish-startup-choice"><input id="finish-auto-start" type="checkbox" data-startup checked>Start automatically with T3</label></div><div class="panel-footer"><p id="finish-description">Automatic startup is on by default. Finish setup to run with T3.</p><button id="enable-auto" class="button primary">Finish setup <span class="button-arrow" aria-hidden="true">→</span></button></div></section>
<section id="dashboard-panel" hidden><div class="panel"><div class="dashboard-status"><div class="service"><div class="service-top"><span class="service-name">T3 Code</span><span id="dash-t3-state" class="service-state">Connected</span></div><p id="dash-t3-description">Ready to receive your requests.</p></div><div class="service"><div class="service-top"><span class="service-name">WhatsApp</span><span id="dash-wa-state" class="service-state">Connected</span></div><p id="dash-wa-description">Only your account can issue commands.</p></div></div><div class="dashboard-bottom"><div><strong id="run-mode">Runs automatically with T3</strong><p id="run-description">You can close this page and its terminal.</p></div><button class="button" id="dashboard-action">Pause bot</button></div></div><div class="test-box"><div><strong id="test-title">Try your first request</strong><p id="test-description">Send this in Message yourself on WhatsApp.</p></div><button type="button" class="copy-command" id="copy-command" aria-label="Copy @bot hi" title="Copy @bot hi"><code>@bot hi</code></button><span class="sr-only" id="copy-feedback" role="status" aria-live="polite"></span></div></section>
<details class="details" id="details"><summary>Connection details &amp; troubleshooting</summary><div class="details-content"><p class="details-intro">These values are detected automatically. Change them only if T3 can’t be reached.</p><div class="technical-fields"><div><label for="binary">T3 executable</label><input id="binary" type="text" spellcheck="false" autocomplete="off"><small>The local command used to connect to T3.</small></div><div><label for="workspace">Conversation workspace</label><input id="workspace" type="text" spellcheck="false" autocomplete="off"><small>Existing conversation workspaces are preserved.</small></div></div><p class="diagnostics" id="diagnostics">No checks have run yet.</p><div class="actions"><button id="check" class="button">Check connection</button><button id="relink" class="text-button" hidden>Link account again</button><button id="manual" class="text-button" hidden>Run a foreground test</button></div><p class="privacy-note">Your computer must stay awake and online. Answer permission requests in T3 Code. If a previous session crashed, verify its process has exited before removing its lock; never delete session data to repair it. This version’s automatic startup requires macOS 12 or later and keeps using this checkout and Node installation.</p></div></details>

</main>
<script nonce="${nonce}">
const token=location.hash.slice(1);
history.replaceState(null,'',location.pathname);
const $=id=>document.getElementById(id);
let state,checkResults=[],busy=false,checking=false,override,dirty=false,lastCheck=0,lastError;
let lastScreen='loading',pairRequested=false;
const panelNames=['loading','t3','blocked','pair','preferences','finish','dashboard'];
function notice(message,error=false){$('notice').textContent=message;$('notice').dataset.error=String(error);$('notice').hidden=!message;}
function options(){return {t3Binary:$('binary').value.trim(),noProject:$('workspace').value.trim(),access:preserveAccess(state.access,document.querySelector('input[name=access]:checked').value,state.existing),retentionDays:Number($('history').value)};}
async function api(path,data){
 const response=await fetch('/api/'+path,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})});
 const result=await response.json();
 if(!response.ok)throw new Error(result.error||'Could not complete this step. Try again.');
 return result;
}
function t3Ready(){return state?.runtime.t3Available===false?false:checkResults.some(check=>check.code==='t3_ready'&&check.ok);}
function accessLabel(){return state?.access==='all'?'All personal chats and groups':state?.access==='selected'?'Your selected chats':'Message yourself only';}
const selectScreen=${setupScreen.toString()};
const preserveAccess=${accessSetting.toString()};
function chooseScreen(){return selectScreen(state,t3Ready(),checkResults.length>0,override);}
function controls(){
 const auto=state?.automatic;
 document.querySelectorAll('button').forEach(button=>button.disabled=busy);
 const editingBlocked=chooseScreen()!=='settings'&&Boolean(auto?.enabled||state?.runtimeLocked);
 $('access-fields').disabled=busy||editingBlocked;
 $('history').disabled=busy||editingBlocked;
 $('save').disabled=busy||editingBlocked;
 document.querySelectorAll('[data-startup]').forEach(input=>input.disabled=busy||editingBlocked||!auto?.supported);
 $('pair').disabled=busy||state?.runtime.state==='pairing'||auto?.enabled;
 $('cancel-pair').disabled=busy;
 $('settings').disabled=busy;
}
function render(){
 const screen=chooseScreen(),r=state?.runtime,a=state?.automatic;
 panelNames.forEach(name=>$(name+'-panel').hidden=name!==(screen==='settings'?'preferences':screen));
 const headers={loading:['Getting things ready.','Checking your connection to T3 Code.'],t3:['Let’s connect to T3.','Your coding agent needs to be available before we link WhatsApp.'],blocked:['Let’s finish the other session.','Your saved account and ongoing work will stay in place.'],pair:['Connect WhatsApp.','Link your account to T3.'],settings:['Settings','Manage chat access, history, and automatic startup.'],preferences:['Choose where it works.','Start privately, and change these preferences whenever you need.'],finish:['Ready when you are.','Your account and preferences are saved.'],dashboard:['You’re connected.','Your WhatsApp companion is ready for your next request.']};
 $('title').textContent=headers[screen][0];$('subtitle').textContent=headers[screen][1];
 $('progress').hidden=screen==='dashboard'||screen==='settings';
 const progress=screen==='preferences'?1:screen==='finish'?2:0;
 document.querySelectorAll('[data-progress]').forEach(item=>{
  const n=Number(item.dataset.progress);item.classList.toggle('complete',n<progress);
  item.querySelector('.step-number').textContent=n<progress?'✓':String(n+1);
  if(n===progress)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current');
 });
 $('connections').hidden=['loading','dashboard','settings','blocked'].includes(screen);
 if(!state){controls();return;}
 $('settings').hidden=!['dashboard','finish','settings'].includes(screen);
 $('settings').textContent=screen==='settings'?'Back':'Settings';
 $('settings').setAttribute('aria-label',screen==='settings'?'Cancel settings and return to connection':'Settings');
 const linked=state.session.authorized;
 $('t3-connection').dataset.state=t3Ready()?'ok':'waiting';$('t3-label').textContent=t3Ready()?'Connected':'Waiting';
 $('wa-connection').dataset.state=r.connected?'ok':linked?'ok':'waiting';$('wa-label').textContent=r.connected?'Connected':linked?'Account linked':'Not linked';
 $('existing-access-description').textContent='Use your configured chat list. Project mappings are preserved.';
 $('existing-access').hidden=!state.existing||state.access!=='selected';
 const running=a.enabled||state.runtimeOwner==='foreground';
 $('settings-lock').hidden=screen!=='settings';
 $('settings-lock').querySelector('p').textContent=running
  ?a.enabled&&!$('auto-start').checked?'Saving turns off automatic startup and stops the background bot.':'Changes apply when you save. The bot reconnects briefly.'
  :a.paused?'The bot is paused. Saving keeps it paused unless you enable automatic startup.':'Changes apply when you save.';
 $('preferences-back').textContent=screen==='settings'?'Cancel':state.existing?'Back to connection':'Back';
 $('save').textContent=screen==='settings'?(running&&(!a.enabled||$('auto-start').checked)?'Save and reconnect':'Save changes'):'Finish setup →';
 $('startup-choice').hidden=$('finish-startup-choice').hidden=!a.supported;
 $('access-summary').textContent=accessLabel();
 const days=state.settings.retentionDays;$('history-summary').textContent=days?days+' days, stored locally':'Off';
 $('enable-auto').textContent=a.supported?'Finish setup →':'Start for this session →';
 $('finish-description').textContent=a.supported?'The bot starts with T3 by default. You can close this page and its terminal after setup.':'Automatic startup isn’t available on this platform yet. Keep the setup terminal open for this session.';
 const pairing=r.state==='pairing';
 $('qr-well').dataset.state=r.qr?'ready':pairing?'loading':'idle';
 $('qr').hidden=!r.qr;$('qr-empty').hidden=Boolean(r.qr);
 if(r.qr){const src='data:image/png;base64,'+r.qr;if($('qr').src!==src)$('qr').src=src;}else $('qr').removeAttribute('src');
 $('pair-status').hidden=!pairing;$('pair-status').textContent=pairing?'Connecting to WhatsApp…':'';
 $('pair').hidden=pairing;
 const symbol=$('qr-empty').querySelector('.qr-symbol');symbol.hidden=!pairing;symbol.classList.toggle('spinner',pairing);symbol.textContent='';
 $('cancel-pair').hidden=!pairing;
 $('relink').hidden=!state.existing;
 $('manual').hidden=!state.existing||a.enabled||state.runtimeLocked;
 $('dash-t3-state').textContent=t3Ready()?'Available':'Waiting for T3';
 $('dash-t3-description').textContent=t3Ready()?'Ready to receive your requests.':'Open T3 Code on this computer to resume.';
 $('dash-wa-state').textContent=r.connected?'Connected':r.state==='starting'?'Connecting':linked?'Account linked':'Needs linking';
 $('dash-wa-description').textContent=r.connected?'Only your account can issue commands.':linked?'Your saved session is ready to reconnect.':'Link your account before starting the bot.';
 $('run-mode').textContent=a.enabled?'Runs automatically with T3':state.runtimeOwner==='foreground'?'Running for this session':a.paused?'Automatic startup paused':'Automatic startup is off';
 $('run-description').textContent=a.enabled?'You can close this page and its terminal.':state.runtimeOwner==='foreground'?'This test stops when the setup terminal closes.':'It will stay off until you enable it again.';
 $('dashboard-action').textContent=a.enabled||state.runtimeOwner==='foreground'?'Pause bot':a.supported?'Resume automatic startup':'Start for this session';
 if(screen==='dashboard'){
  if(!linked){$('title').textContent='Your account needs linking.';$('subtitle').textContent='Your preferences are saved. Reconnect WhatsApp to continue.';$('dashboard-action').textContent='Reconnect WhatsApp';}
  else if(a.enabled&&!a.loaded){$('title').textContent='Startup needs attention.';$('subtitle').textContent='macOS hasn’t loaded the background job. You can repair it here.';$('dashboard-action').textContent='Repair automatic startup';}
  else if(a.paused&&state.runtimeOwner==='none'){$('title').textContent='Paused, until you’re ready.';$('subtitle').textContent='Your account and preferences are saved. Resume whenever you need.';}
  else if(!r.connected){$('title').textContent=t3Ready()?'Connecting your account.':'Waiting for T3 Code.';$('subtitle').textContent=t3Ready()?'Your saved WhatsApp session will reconnect automatically.':'The bot will start when T3 is available on this computer.';}
  if(r.t3Available===false&&r.connected){$('title').textContent='Waiting for T3 Code.';$('subtitle').textContent='The bot stops after five minutes offline. Open T3 to keep it connected.';}
 }
 $('test-title').textContent=r.commandAccepted&&r.replySent?'Your first reply was sent':r.commandAccepted?'Your request reached T3':'Try your first request';
 $('test-description').textContent=r.commandAccepted&&r.replySent?'Check WhatsApp to confirm it arrived.':r.commandAccepted?'Waiting for the reply. Keep T3 available.':state.access==='self'?'Send this in Message yourself on WhatsApp.':'Send this in one of your enabled WhatsApp chats.';
 const diagnosis=checkResults.map(check=>(check.ok?'OK  ':'CHECK  ')+check.code+' · '+check.message+(check.next?'\n'+check.next:''));
 $('diagnostics').textContent=diagnosis.join('\n\n')||'Checks are running…';
 if(r.error&&r.error!==lastError){lastError=r.error;notice(r.error,true);}
 if(screen!==lastScreen){document.title='T3 WhatsApp · '+(screen==='dashboard'?'Connection':screen==='settings'?'Settings':'Setup');lastScreen=screen;}
 controls();
}
function fillSettings(){
 const settings=state.settings;
 $('binary').value=settings.t3Binary;$('workspace').value=settings.noProject;$('workspace').readOnly=state.existing;
 document.querySelector('input[name=access][value="'+(state.existing?(state.access==='selected'?'existing':state.access):settings.access)+'"]').checked=true;
 if(!$('history').querySelector('option[value="'+settings.retentionDays+'"]'))$('history').add(new Option('Keep for '+settings.retentionDays+' days',String(settings.retentionDays)));
 $('history').value=String(settings.retentionDays);document.querySelectorAll('[data-startup]').forEach(input=>input.checked=state.automatic.supported&&(override==='settings'?state.automatic.enabled:!state.automatic.paused));dirty=false;
}
async function fetchState(){state=await api('state');if(pairRequested&&state.runtime.state==='paired'){pairRequested=false;override=undefined;}render();return state;}
async function checkConnection(useDraft=false){
 checking=true;
 try{const result=await api('check',useDraft?options():state.settings);checkResults=result.checks;lastCheck=Date.now();render();}
 finally{checking=false;}
}
async function action(fn){
 if(busy)return;busy=true;notice('');controls();
 try{await fn();}catch(error){notice(error.message,true);}
 finally{busy=false;render();}
}
async function enable(){
 if(dirty)throw new Error('Save your updated settings before enabling the bot.');
 notice('Enabling automatic startup. This may take a few seconds.');
 await api(state.automatic.supported?'auto/enable':'start',{});
 override='dashboard';await fetchState();notice(state.automatic.supported?'Automatic startup is enabled. You can close this page and its terminal.':'The bot is running for this session. Keep the setup terminal open.');
}
let copyReset;
$('copy-command').onclick=async()=>{
 const command='@bot hi',button=$('copy-command');
 try{
  try{await navigator.clipboard.writeText(command);}
  catch{
   const text=document.createElement('textarea');text.value=command;text.className='sr-only';document.body.append(text);
   try{text.focus();text.select();if(!document.execCommand('copy'))throw new Error('Copy unavailable');}
   finally{text.remove();button.focus();}
  }
  clearTimeout(copyReset);button.querySelector('code').textContent='Copied!';$('copy-feedback').textContent='Copied @bot hi to clipboard.';
  copyReset=setTimeout(()=>{button.querySelector('code').textContent=command;$('copy-feedback').textContent='';},1600);
 }catch{notice('Couldn’t copy. Select @bot hi and copy it manually.',true);}
};
$('pair').onclick=()=>action(async()=>{override='pair';await api('pair',{});pairRequested=true;await fetchState();});
$('cancel-pair').onclick=()=>action(async()=>{pairRequested=false;await api('stop',{});override=undefined;await fetchState();});
$('retry-t3').onclick=$('retry-lock').onclick=$('check').onclick=()=>action(async()=>{await fetchState();await checkConnection(true);});
$('settings').onclick=()=>{override=chooseScreen()==='settings'?'dashboard':'settings';fillSettings();notice('');render();};
$('preferences-back').onclick=()=>{override=state.existing?'dashboard':'pair';fillSettings();notice('');render();};
async function complete(withSettings){
 if(!withSettings&&dirty)throw new Error('Save your updated preferences before finishing setup.');
 notice('Finishing setup…');
 const result=await api('complete',{...(withSettings?{settings:options()}:{}),automatic:$('auto-start').checked});
 await fetchState();fillSettings();override=state.automatic.supported?'dashboard':undefined;render();
 if(result.startupError){notice(result.startupError,true);return;}
 notice(state.automatic.enabled?'Setup complete. Automatic startup is on.':state.automatic.paused?'Preferences saved. Automatic startup stays off.':'Your preferences are saved.');
}
async function applySettings(){
 notice('Applying settings…');
 const result=await api('settings',{settings:options(),automatic:$('auto-start').checked});
 await fetchState();fillSettings();override='dashboard';render();
 notice(result.startupError||'Settings saved.',Boolean(result.startupError));
}
$('save').onclick=()=>action(()=>chooseScreen()==='settings'?applySettings():complete(true));
$('enable-auto').onclick=()=>action(async()=>{if(state.automatic.supported)await complete(false);else await enable();});
$('dashboard-action').onclick=()=>action(async()=>{
 if(!state.session.authorized){if(state.automatic.enabled)await api('stop',{});override='pair';await fetchState();return;}
 if(state.automatic.enabled&&!state.automatic.loaded){await api('auto/disable',{});await fetchState();await enable();return;}
 if(state.automatic.enabled||state.runtimeOwner==='foreground'){await api('stop',{});override='dashboard';await fetchState();return;}
 await enable();
});
$('relink').onclick=()=>action(async()=>{
 if(state.automatic.enabled||state.runtimeOwner==='foreground')throw new Error('Pause the bot before linking your account again.');
 override='pair';notice('Your saved session will be verified first. A QR appears only if linking is needed.');render();
});
$('manual').onclick=()=>action(async()=>{if(dirty)throw new Error('Save your settings before starting a test.');await api('start',{});override='dashboard';await fetchState();});
document.querySelectorAll('input,select').forEach(input=>input.addEventListener('change',()=>{if(input.matches('[data-startup]'))document.querySelectorAll('[data-startup]').forEach(other=>other.checked=input.checked);else dirty=true;render();}));
async function init(){
 if(!token){$('title').textContent='Reopen your setup link.';$('subtitle').textContent='Use the complete private URL from the setup terminal. This page doesn’t store your access token.';$('loading-panel').hidden=true;$('progress').hidden=true;$('details').hidden=true;return;}
 try{
  await fetchState();fillSettings();await checkConnection();render();
  setInterval(async()=>{
   if(busy||checking)return;
   try{await fetchState();if(Date.now()-lastCheck>=60000)await checkConnection();}
   catch{notice('Setup is no longer reachable. Reopen it to manage the bot. An enabled background bot keeps running independently.',true);}
  },2000);
 }catch(error){notice(error.message,true);}
}
init();
</script>
</body></html>`;}
