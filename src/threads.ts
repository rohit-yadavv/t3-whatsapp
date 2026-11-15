import type {ThreadSummary} from './t3.js';

export function parseThreadSelector(text: string): {instruction:string; name?:string; error?:string} {
  const selectors=[...text.matchAll(/(^|\s)~(?:"([^"\n]{1,120})"|([a-z0-9][a-z0-9_-]{0,119}))(?=\s|$)/gi)];
  const starts=[...text.matchAll(/(?:^|\s)~/g)];
  if (!starts.length) return {instruction:text};
  if (selectors.length!==1 || starts.length!==1) return {instruction:text,error:'Choose one thread using ~thread-name or ~"Thread title".'};
  const match=selectors[0],name=(match[2] ?? match[3]).trim();
  if (!name) return {instruction:text,error:'A thread selector needs a name.'};
  return {name,instruction:(text.slice(0,match.index)+match[1]+text.slice(match.index!+match[0].length)).trim()};
}
export function threadKey(name: string): string { return name.trim().replace(/\s+/g,' ').toLowerCase(); }
export function matchThreads(name: string, threads: ThreadSummary[]): ThreadSummary[] {
  const key=threadKey(name);
  const exact=threads.filter(thread=>threadKey(thread.title)===key);
  if (exact.length) return exact;
  const slug=(value:string)=>threadKey(value).replace(/[-_\s]+/g,' ');
  const normalized=threads.filter(thread=>slug(thread.title)===slug(name));
  if (normalized.length) return normalized;
  // Literal partial matches only: no execution of user-supplied regular expressions.
  return threads.filter(thread=>threadKey(thread.title).includes(key));
}
export function isCaptureRequest(instruction: string): boolean {
  return /^(?:save|record|note|remember)\s+(?:this|that|it)\b/i.test(instruction.trim())
    || /^(?:add|record|note|remember)\b[\s\S]*\b(?:todo|to-do|backlog|for later)\b/i.test(instruction.trim());
}
