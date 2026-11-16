export interface SetupScreenState {
  existing:boolean;
  session:{authorized:boolean};
  runtimeOwner:'none'|'external'|'foreground'|'background';
  automatic:{enabled:boolean;paused:boolean};
  runtime:{state:string};
}
export type SetupScreen='loading'|'t3'|'blocked'|'pair'|'preferences'|'settings'|'finish'|'dashboard';
/** Shared with the bundled client; keep this function independent of module values. */
export function setupScreen(state:SetupScreenState|undefined,ready:boolean,checked:boolean,override?:'preferences'|'settings'|'pair'|'dashboard'):SetupScreen {
  if(!state)return 'loading';
  if(state.runtimeOwner==='external')return 'blocked';
  if(override==='settings'&&state.existing&&state.session.authorized)return 'settings';
  if(override==='preferences'&&state.session.authorized)return 'preferences';
  if(state.runtime.state==='pairing')return 'pair';
  if(override==='pair')return ready?'pair':'t3';
  if(state.existing&&(state.automatic.enabled||state.automatic.paused||state.runtimeOwner==='background'||state.runtimeOwner==='foreground'||override==='dashboard'))return 'dashboard';
  // A saved installation can enable auto-start while T3 is offline.
  if(state.existing&&state.session.authorized)return 'finish';
  if(!checked)return 'loading';
  if(!ready)return 't3';
  if(!state.session.authorized)return 'pair';
  return 'preferences';
}

/** Showing a concrete current selection must not rewrite existing routing rules. */
export function accessSetting(current:'self'|'all'|'selected',selected:'self'|'all'|'existing',configured:boolean):'self'|'all'|'existing' {
  return configured&&current===selected ? 'existing' : selected;
}
