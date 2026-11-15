import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,truncateSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseResponse,whatsappText,prepareDocuments,documentContent} from '../src/responses.js';

test('response contract accepts direct replies and bounded handoffs without exposing protocol text',()=>{
  assert.deepEqual(parseResponse('{"v":1,"kind":"reply","text":"New Delhi."}'),{v:1,kind:'reply',text:'New Delhi.',files:[]});
  assert.equal(parseResponse('```json\n{"v":1,"kind":"reply","text":"Hi"}\n```'.replaceAll('\\n','\n')).kind,'reply');
  assert.equal(parseResponse(JSON.stringify({v:1,kind:'handoff',text:'Started review in T3.',delivery:'t3',work:{threadId:'w',runId:'r',label:'Review'}})).kind,'handoff');
  for (const value of ['A raw report',JSON.stringify({v:1,kind:'handoff',text:'x'.repeat(501),delivery:'t3',work:{threadId:'w',runId:'r',label:'Review'}}),JSON.stringify({v:1,kind:'reply',text:'Done',files:['../auth.json']})]) assert.throws(()=>parseResponse(value));
});
test('WhatsApp formatting converts public Markdown links and suppresses desktop-only file links',()=>{
  assert.equal(whatsappText('Report: [report.md](/Users/me/report.md)\nSources: [Docs](https://example.com/docs)'), 'Report: report.md\nSources: Docs: https://example.com/docs');
  assert.doesNotMatch(whatsappText('Created /Users/me/private/report.md <t3-thread://v2/environment/thread>'),/\/Users\/|t3-thread:/);
});
test('requested documents are captured immutably, survive source edits, and can be staged idempotently',()=>{
  const dir=mkdtempSync(join(tmpdir(),'t3-documents-')),output=join(dir,'deliveries','request');mkdirSync(output,{recursive:true});
  try {
    writeFileSync(join(output,'report.md'),'Original report');
    const [document]=prepareDocuments(output,['report.md']);
    assert.deepEqual(prepareDocuments(output,['report.md']),[document]);
    writeFileSync(join(output,'report.md'),'Edited later');
    assert.equal(documentContent(document).document.toString(),'Original report');assert.equal(document.mimetype,'text/markdown');
    chmodSync(document.path,0o600);writeFileSync(document.path,'tampered');assert.throws(()=>documentContent(document),/changed/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('documents cannot escape the output folder through filenames or symlinks and have a size limit',()=>{
  const dir=mkdtempSync(join(tmpdir(),'t3-files-')),output=join(dir,'deliveries','request');mkdirSync(output,{recursive:true});
  try {
    writeFileSync(join(dir,'private.txt'),'private');symlinkSync(join(dir,'private.txt'),join(output,'link.txt'));
    assert.throws(()=>prepareDocuments(output,['../private.txt']));assert.throws(()=>prepareDocuments(output,['link.txt']));
    writeFileSync(join(output,'big.txt'),'');truncateSync(join(output,'big.txt'),10*1024*1024+1);assert.throws(()=>prepareDocuments(output,['big.txt']),/10 MiB/);
    assert.equal(readFileSync(join(dir,'private.txt'),'utf8'),'private');
  } finally {rmSync(dir,{recursive:true,force:true});}
});
