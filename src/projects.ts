export interface ProjectHint {name?:string;target?:string}
export interface ProjectContext {source:'message'|'mapping';projects:ProjectHint[]}
export type ProjectCommand =
  | {kind:'projects'}
  | {kind:'map';alias:string}
  | {kind:'unmap'}
  | {kind:'task';instruction:string;projects:ProjectHint[]};

/** Hashtags are prompt hints, never routing commands. Quoted data is not parsed. */
export function parseProjectCommand(instruction: string, projects: ReadonlyMap<string,string>): ProjectCommand {
  const text=instruction.trim();
  if (/^projects$/i.test(text)) return {kind:'projects'};
  const mapping=/^use\s+#?([a-z0-9][a-z0-9_-]{0,63})\s+for\s+this\s+chat$/i.exec(text);
  if (mapping) return {kind:'map',alias:mapping[1].toLowerCase()};
  if (/^unmap\s+this\s+chat$/i.test(text)) return {kind:'unmap'};
  const names=[...new Set([...text.matchAll(/(?:^|\s)#([a-z0-9][a-z0-9_-]{0,63})(?=\s|$)/gi)].map(tag=>tag[1].toLowerCase()).filter(name=>projects.has(name) || /[a-z]/i.test(name)))];
  return {kind:'task',instruction:text,projects:names.map(name=>({name,target:projects.get(name)}))};
}
