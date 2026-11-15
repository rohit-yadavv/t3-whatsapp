export type ProjectCommand =
  | {kind:'projects'}
  | {kind:'map';alias:string}
  | {kind:'unmap'}
  | {kind:'task';instruction:string;alias?:string;error?:string};

/** Only the sender's instruction is parsed, never the quoted issue text. */
export function parseProjectCommand(instruction: string, projects: ReadonlyMap<string,string>): ProjectCommand {
  const text=instruction.trim();
  if (/^projects$/i.test(text)) return {kind:'projects'};
  const mapping=/^use\s+#?([a-z0-9][a-z0-9_-]{0,63})\s+for\s+this\s+chat$/i.exec(text);
  if (mapping) return {kind:'map',alias:mapping[1].toLowerCase()};
  if (/^unmap\s+this\s+chat$/i.test(text)) return {kind:'unmap'};
  const tags=[...text.matchAll(/(?:^|\s)#([a-z0-9][a-z0-9_-]{0,63})(?=\s|$)/gi)];
  // A leading hashtag is an explicit selector, including typos. Elsewhere,
  // only known project aliases are selectors; ordinary issue tags survive.
  if (text.startsWith('#') && !tags.some(tag=>tag.index===0)) return {kind:'task',instruction:text,error:'Invalid project selector. Use #project-name followed by your task.'};
  const selectors=tags.filter(tag=>tag.index===0 || projects.has(tag[1].toLowerCase()));
  const aliases=[...new Set(selectors.map(tag=>tag[1].toLowerCase()))];
  if (aliases.length>1) return {kind:'task',instruction:text,error:'Use one #project-name per command.'};
  if (!aliases.length) return {kind:'task',instruction:text};
  const alias=aliases[0];
  const body=text.replace(/(^|\s)#([a-z0-9][a-z0-9_-]{0,63})(?=\s|$)/gi,(match,before:string,name:string)=>name.toLowerCase()===alias ? before : match).trim();
  return {kind:'task',alias,instruction:body};
}
