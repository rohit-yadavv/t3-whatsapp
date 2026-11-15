import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { z } from 'zod';

const chatPattern = /^(?:\d+(?:-\d+)?@g\.us|\d+@(?:s\.whatsapp\.net|lid))$/;
const aliasPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const target = z.string().trim().min(1);
const route = z.union([
  z.object({chatJid:z.string().regex(chatPattern),project:target}).strict(),
  // Read old group-only configs without discarding existing routes.
  z.object({groupJid:z.string().regex(/^\d+(?:-\d+)?@g\.us$/),project:target}).strict()
    .transform(value => ({chatJid:value.groupJid,project:value.project})),
]);
const schema = z.object({
  t3Binary:z.string().min(1).default('t3'),
  dataDir:z.string().default('.data'),
  selfCommands:z.boolean().default(false),
  accountWide:z.boolean().default(false),
  allowedSenderJids:z.array(z.string().regex(/^\d+@(s\.whatsapp\.net|lid)$/)).min(1),
  projects:z.record(z.string().regex(aliasPattern),target).default({}),
  routes:z.array(route).default([]),
  pollIntervalMs:z.number().int().min(5000).default(15000),
  maxMessageAgeSeconds:z.number().int().min(30).max(3600).default(300),
}).strict().superRefine((config,ctx) => {
  if (config.accountWide && !config.selfCommands) ctx.addIssue({code:'custom',message:'Account-wide commands require selfCommands: true.'});
  if (new Set(config.routes.map(r=>r.chatJid)).size !== config.routes.length) ctx.addIssue({code:'custom',message:'Each chat must have exactly one configured mapping.'});
  if (!config.routes.length && !Object.keys(config.projects).length) ctx.addIssue({code:'custom',message:'Configure at least one project.'});
});
export type Config = z.infer<typeof schema>;
export function isSupportedChat(jid: string): boolean { return chatPattern.test(jid); }
export function projectCatalog(config: Config): Map<string,string> {
  const catalog = new Map<string,string>();
  for (const [name,project] of Object.entries(config.projects)) {
    const alias=name.toLowerCase();
    if (catalog.has(alias)) throw new Error(`Duplicate project alias: ${alias}`);
    catalog.set(alias,project);
  }
  for (const route of config.routes) {
    if ([...catalog.values()].includes(route.project)) continue;
    const alias=basename(route.project).toLowerCase().replace(/[^a-z0-9_-]+/g,'-');
    if (!aliasPattern.test(alias) || catalog.has(alias)) throw new Error('Give each route project a unique alias in projects.');
    catalog.set(alias,route.project);
  }
  return catalog;
}
export function loadConfig(path = process.env.T3_WHATSAPP_CONFIG ?? 'config.json'): Config {
  const file=resolve(path);
  const config=schema.parse(JSON.parse(readFileSync(file,'utf8')));
  config.dataDir=resolve(dirname(file),config.dataDir);
  projectCatalog(config);
  return config;
}
