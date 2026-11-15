import test from 'node:test';
import assert from 'node:assert/strict';
import {parseProjectCommand} from '../src/projects.js';
const projects=new Map([['website','/website'],['mobile-app','/mobile']]);
test('project selectors match exact names case insensitively and strip only routing tags',()=>{
  assert.deepEqual(parseProjectCommand('#WEBSITE fix this',projects),{kind:'task',alias:'website',instruction:'fix this'});
  assert.deepEqual(parseProjectCommand('fix this #mobile-app',projects),{kind:'task',alias:'mobile-app',instruction:'fix this'});
  assert.deepEqual(parseProjectCommand('#website fix #css layout',projects),{kind:'task',alias:'website',instruction:'fix #css layout'});
});
test('unknown leading projects and conflicting selectors cannot fall back silently',()=>{
  assert.equal((parseProjectCommand('#missing fix',projects) as {alias:string}).alias,'missing');
  assert.ok((parseProjectCommand('#website #mobile-app fix',projects) as {error:string}).error);
  assert.ok((parseProjectCommand('#website.invalid fix',projects) as {error:string}).error);
});
test('mapping and project-list commands are explicit',()=>{
  assert.deepEqual(parseProjectCommand('use #WEBSITE for this chat',projects),{kind:'map',alias:'website'});
  assert.deepEqual(parseProjectCommand('projects',projects),{kind:'projects'});
  assert.deepEqual(parseProjectCommand('unmap this chat',projects),{kind:'unmap'});
  assert.deepEqual(parseProjectCommand('please use website to fix this',projects),{kind:'task',instruction:'please use website to fix this'});
});
