import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

const schema = z.object({
  t3Binary: z.string().min(1).default('t3'),
  dataDir: z.string().default('.data'),
  selfCommands: z.boolean().default(false),
  allowedSenderJids: z.array(z.string().regex(/^\d+@(s\.whatsapp\.net|lid)$/)).min(1),
  routes: z.array(z.object({ groupJid: z.string().regex(/^\d+@g\.us$/), project: z.string().min(1) })).min(1),
  pollIntervalMs: z.number().int().min(5000).default(15000),
  maxMessageAgeSeconds: z.number().int().min(30).max(3600).default(300),
}).strict();
export type Config = z.infer<typeof schema>;
export function loadConfig(path = process.env.T3_WHATSAPP_CONFIG ?? 'config.json'): Config {
  const file = resolve(path);
  const config = schema.parse(JSON.parse(readFileSync(file, 'utf8')));
  if (new Set(config.routes.map(r => r.groupJid)).size !== config.routes.length) throw new Error('Each group must have exactly one route.');
  config.dataDir = resolve(dirname(file), config.dataDir);
  return config;
}
