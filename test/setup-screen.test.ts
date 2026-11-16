import test from 'node:test';
import assert from 'node:assert/strict';
import {accessSetting, setupScreen, type SetupScreenState} from '../src/setup-screen.js';
const fresh:SetupScreenState={existing:false,session:{authorized:false},runtimeOwner:'none',automatic:{enabled:false,paused:false},runtime:{state:'idle'}};

test('setup begins with detection, then links directly without a technical configuration step',()=>{
  assert.equal(setupScreen(undefined,false,false),'loading');
  assert.equal(setupScreen(fresh,false,false),'loading');
  assert.equal(setupScreen(fresh,false,true),'t3');
  assert.equal(setupScreen(fresh,true,true),'pair');
});
test('a linked account advances to preferences and a saved installation can finish even with T3 offline',()=>{
  const linked={...fresh,session:{authorized:true}};
  assert.equal(setupScreen(linked,true,true),'preferences');
  assert.equal(setupScreen({...linked,existing:true},true,true),'finish');
  assert.equal(setupScreen({...linked,existing:true},false,true),'finish');
});
test('returning enabled and paused installations open their status screen instead of onboarding',()=>{
  const saved={...fresh,existing:true,session:{authorized:true}};
  assert.equal(setupScreen({...saved,automatic:{enabled:true,paused:false}},false,true),'dashboard');
  assert.equal(setupScreen({...saved,automatic:{enabled:false,paused:true}},false,true),'dashboard');
  assert.equal(setupScreen({...saved,runtimeOwner:'background'},true,true),'dashboard');
  assert.equal(setupScreen({...saved,runtimeOwner:'foreground',runtime:{state:'running'}},true,true),'dashboard');
});
test('external locks block pairing and edits without disturbing the owner',()=>{
  const conflict:SetupScreenState={...fresh,runtimeOwner:'external',existing:true,session:{authorized:true}};
  for(const override of [undefined,'preferences','settings','pair','dashboard'] as const)assert.equal(setupScreen(conflict,true,true,override),'blocked');
});
test('owned pairing stays visible until it finishes, including on a paused existing installation',()=>{
  assert.equal(setupScreen({...fresh,existing:true,runtimeOwner:'foreground',runtime:{state:'pairing'},automatic:{enabled:false,paused:true}},true,true),'pair');
});
test('settings require an authorized saved session and relinking respects T3 availability',()=>{
  const saved={...fresh,existing:true,session:{authorized:true}};
  assert.equal(setupScreen(saved,true,true,'preferences'),'preferences');
  assert.equal(setupScreen(fresh,true,true,'preferences'),'pair');
  assert.equal(setupScreen(saved,true,true,'pair'),'pair');
  assert.equal(setupScreen(saved,false,true,'pair'),'t3');
});

test('Settings has its own screen without returning a saved installation to onboarding',()=>{
  const saved={...fresh,existing:true,session:{authorized:true},automatic:{enabled:true,paused:false}};
  assert.equal(setupScreen(saved,true,true,'settings'),'settings');
  assert.equal(setupScreen(saved,false,true,'settings'),'settings');
  assert.equal(setupScreen(fresh,true,true,'settings'),'pair');
});
test('concrete current access selections preserve existing routes unless deliberately changed',()=>{
  assert.equal(accessSetting('all','all',true),'existing');
  assert.equal(accessSetting('self','self',true),'existing');
  assert.equal(accessSetting('selected','existing',true),'existing');
  assert.equal(accessSetting('selected','all',true),'all');
  assert.equal(accessSetting('all','self',true),'self');
  assert.equal(accessSetting('self','self',false),'self');
});
