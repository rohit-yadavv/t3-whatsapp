import {createHash} from 'node:crypto';
import {constants,openSync,closeSync,fstatSync,readFileSync,lstatSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,basename,dirname,extname} from 'node:path';

export interface WorkReference {threadId:string;runId:string;label:string}
export interface Handoff {work:WorkReference;delivery:'t3'|'whatsapp'}
export interface Document {path:string;fileName:string;mimetype:string;sha256:string}
export type BotResponse =
  | {v:1;kind:'reply';text:string;files:string[]}
  | ({v:1;kind:'handoff';text:string} & Handoff);
export interface Completion {originalInstruction:string;work:WorkReference;result:string}
export interface DeliveryContext {outputDirectory:string;recentHandoffs:Handoff[];completion?:Completion}
const fileNamePattern=/^[a-z0-9][a-z0-9._ -]{0,119}$/i;
function object(value:unknown):value is Record<string,unknown> {return Boolean(value && typeof value==='object' && !Array.isArray(value));}
export function parseResponse(text:string):BotResponse {
  const value:unknown=JSON.parse(text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i,'$1'));
  if (!object(value) || value.v!==1 || typeof value.text!=='string' || !value.text.trim()) throw new Error('Invalid WhatsApp response contract.');
  if (value.kind==='reply' && value.text.length<=12000) {
    const files=value.files ?? [];
    if (!Array.isArray(files) || files.length>3 || !files.every(name=>typeof name==='string' && fileNamePattern.test(name)) || new Set(files).size!==files.length) throw new Error('Invalid response attachments.');
    return {v:1,kind:'reply',text:value.text,files};
  }
  if (value.kind==='handoff' && value.text.length<=500 && ['t3','whatsapp'].includes(String(value.delivery)) && object(value.work)) {
    const {threadId,runId,label}=value.work;
    if ([threadId,runId,label].every(item=>typeof item==='string' && item.trim().length>0 && item.length<=200)) {
      return {v:1,kind:'handoff',text:value.text,delivery:value.delivery as Handoff['delivery'],work:{threadId:threadId as string,runId:runId as string,label:label as string}};
    }
  }
  throw new Error('Invalid WhatsApp response contract.');
}
export function whatsappText(text:string):string {
  return text.replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g,(_match,label:string,url:string)=>/^https?:\/\//i.test(url) ? `${label}: ${url}` : label)
    .replace(/<?t3-thread:\/\/[^\s>]+>?/g,'T3')
    .replace(/(?:file:\/\/[^\s]+|(?:^|\s)\/(?:Users|home|private|tmp|var|etc)\/[^\s<>()]+)/g,' [file in T3]')
    .trim();
}
const mimetypes:Record<string,string>={'.md':'text/markdown','.txt':'text/plain','.html':'text/html','.pdf':'application/pdf','.json':'application/json','.csv':'text/csv','.png':'image/png','.jpg':'image/jpeg','.zip':'application/zip'};
/** Only files explicitly staged by the agent in this request's output folder can leave the machine. */
export function prepareDocuments(directory:string,names:string[]):Document[] {
  if (!names.length) return [];
  if (!lstatSync(directory).isDirectory()) throw new Error('Attachment output directory must be a real directory.');
  const outgoing=join(dirname(dirname(directory)),'outgoing-files');
  mkdirSync(outgoing,{recursive:true,mode:0o700});
  return names.map(name=>{
    if (!fileNamePattern.test(name) || basename(name)!==name) throw new Error('Invalid attachment filename.');
    const fd=openSync(join(directory,name),constants.O_RDONLY | constants.O_NOFOLLOW);
    let contents:Buffer;
    try {
      const stat=fstatSync(fd);
      if (!stat.isFile() || stat.size>10*1024*1024) throw new Error('Attachments must be regular files of at most 10 MiB.');
      contents=readFileSync(fd);
    } finally {closeSync(fd);}
    const sha256=createHash('sha256').update(contents).digest('hex');
    const path=join(outgoing,`${basename(directory)}-${sha256}-${name}`);
    try {writeFileSync(path,contents,{mode:0o400,flag:'wx'});}
    catch(error) {
      if ((error as NodeJS.ErrnoException).code!=='EEXIST' || createHash('sha256').update(readFileSync(path)).digest('hex')!==sha256) throw error;
    }
    return {path,fileName:name,mimetype:mimetypes[extname(name).toLowerCase()] ?? 'application/octet-stream',sha256};
  });
}
export function documentContent(document:Document) {
  const contents=readFileSync(document.path);
  if (createHash('sha256').update(contents).digest('hex')!==document.sha256) throw new Error('Staged attachment changed; delivery held for review.');
  return {document:contents,fileName:document.fileName,mimetype:document.mimetype};
}
