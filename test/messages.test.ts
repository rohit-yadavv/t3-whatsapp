import test from 'node:test';
import assert from 'node:assert/strict';
import { instructionText, normalize, shouldHandleUpsert } from '../src/messages.js';

test('own append events are accepted only in self mode and only after startup', () => {
  const m=normalize({key:{id:'m',remoteJid:'300@g.us',fromMe:true},messageTimestamp:100,message:{conversation:'@bot test'}});
  assert.equal(shouldHandleUpsert('append',m,true,100),true);
  assert.equal(shouldHandleUpsert('notify',m,true,100),true);
  assert.equal(shouldHandleUpsert('append',m,false,100),false);
  assert.equal(shouldHandleUpsert('append',m,true,101),false);
  assert.equal(shouldHandleUpsert('notify',m,true,101),false);
  assert.equal(shouldHandleUpsert('append',{...m,fromMe:false},true,100),false);
});
test('typed prefix is stripped only in explicit single-account mode', () => {
  assert.equal(instructionText('  @BOT Explain this',true),'Explain this');
  assert.equal(instructionText('@bot Explain this',false),'@bot Explain this');
  assert.equal(instructionText('Explain @bot usage',true),'Explain @bot usage');
});

test('wrapped quoted media and quoted stickers are rejected as attachments', () => {
  for (const quotedMessage of [
    {viewOnceMessage:{message:{imageMessage:{caption:'image'}}}},
    {ephemeralMessage:{message:{videoMessage:{caption:'video'}}}},
    {stickerMessage:{}},
  ]) {
    const m=normalize({key:{id:'m',remoteJid:'300@g.us'},message:{extendedTextMessage:{text:'@bot inspect',contextInfo:{quotedMessage}}}});
    assert.equal(m.hasMedia,true);
  }
});
test('numeric references inside instructions are preserved', () => {
  assert.equal(instructionText('@bot inspect account @123',true),'inspect account @123');
  assert.equal(instructionText('@100 inspect account @123',false),'inspect account @123');
});
