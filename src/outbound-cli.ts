import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.js';

async function main(args: string[]) {
  const configPath = args[0] === '--config' ? args.splice(0, 2)[1] : undefined;
  const [operation, value, ...extra] = args;
  if (extra.length || !value || !['preview', 'confirm', 'status'].includes(operation)) {
    throw new Error('Usage: whatsapp [--config PATH] preview RECIPIENT < message.txt | confirm PREVIEW_ID | status PREVIEW_ID');
  }

  const { dataDir } = loadConfig(configPath);
  let endpoint: { pid: number; port: number; token: string };
  try {
    endpoint = JSON.parse(readFileSync(join(dataDir, 'outbound.json'), 'utf8'));
    if (!Number.isInteger(endpoint.pid) || endpoint.pid < 1 || !Number.isInteger(endpoint.port) ||
        endpoint.port < 1 || endpoint.port > 65535 || !/^[0-9a-f]{64}$/.test(endpoint.token)) {
      throw new Error('Invalid endpoint.');
    }
    process.kill(endpoint.pid, 0);
  } catch {
    throw new Error('The local WhatsApp bridge is unavailable. Start it with this configuration.');
  }

  let body: { id: string } | { recipient: string; text: string } = { id: value };
  if (operation === 'preview') {
    if (process.stdin.isTTY) throw new Error('Pass the proposed message on standard input.');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > 12000) throw new Error('Message exceeds 12,000 UTF-8 bytes.');
      chunks.push(chunk);
    }
    body = { recipient: value, text: Buffer.concat(chunks).toString('utf8') };
  }

  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${endpoint.port}/${operation}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${endpoint.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
      redirect: 'error',
    });
  } catch {
    throw new Error(operation === 'confirm'
      ? `Could not verify the send. Check status for ${value} before attempting another send.`
      : 'The local WhatsApp bridge did not respond.');
  }
  const result = await response.json().catch(() => ({ error: 'The local WhatsApp bridge did not accept the request.' }));
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!response.ok) process.exitCode = 1;
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'WhatsApp request failed.');
  process.exitCode = 1;
}
