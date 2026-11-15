import test from 'node:test';
import assert from 'node:assert/strict';
import {parseProjectCommand} from '../src/projects.js';
const projects=new Map([['website','/website'],['mobile-app','/mobile']]);
test('project hashtags supply resolved hints while preserving the sender instruction',()=>{
  assert.deepEqual(parseProjectCommand('#WEBSITE fix this',projects),{kind:'task',instruction:'#WEBSITE fix this',projects:[{name:'website',target:'/website'}]});
  assert.deepEqual(parseProjectCommand('fix this #mobile-app',projects),{kind:'task',instruction:'fix this #mobile-app',projects:[{name:'mobile-app',target:'/mobile'}]});
});
test('unknown names and multiple projects are passed to T3 instead of rejected',()=>{
  assert.deepEqual(parseProjectCommand('#missing #website compare',projects),{kind:'task',instruction:'#missing #website compare',projects:[{name:'missing',target:undefined},{name:'website',target:'/website'}]});
  assert.deepEqual(parseProjectCommand('check issue #123',projects),{kind:'task',instruction:'check issue #123',projects:[]});
});
test('mapping and project-list controls remain explicit',()=>{
  assert.deepEqual(parseProjectCommand('use #WEBSITE for this chat',projects),{kind:'map',alias:'website'});
  assert.deepEqual(parseProjectCommand('projects',projects),{kind:'projects'});
  assert.deepEqual(parseProjectCommand('unmap this chat',projects),{kind:'unmap'});
  assert.deepEqual(parseProjectCommand('please use website to fix this',projects),{kind:'task',instruction:'please use website to fix this',projects:[]});
});

test('aliases starting with digits still resolve while ordinary issue numbers remain text',()=>{
  const parsed=parseProjectCommand('#2026-site check #123',new Map([['2026-site','/site']]));
  assert.deepEqual(parsed,{kind:'task',instruction:'#2026-site check #123',projects:[{name:'2026-site',target:'/site'}]});
});
