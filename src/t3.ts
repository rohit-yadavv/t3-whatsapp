import { spawn } from 'node:child_process';
import { z } from 'zod';

const submissionSchema = z.object({threadId:z.string().min(1), runId:z.string().min(1)});
const snapshotSchema = z.object({
  thread:z.object({
    threadId:z.string().min(1),
    status:z.enum(['idle','preparing','starting','queued','running','waiting','completed','failed','cancelled','interrupted','rolled_back']),
    latestRunId:z.string().nullable(),
    pendingRequestCount:z.number().int().nonnegative(),
    link:z.string().nullable().optional(),
  }),
  messages:z.array(z.object({role:z.enum(['user','assistant']),runId:z.string().nullable(),text:z.string()})),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export interface T3 {
  submit(project: string, prompt: string, thread?: string): Promise<{threadId: string; runId: string}>;
  show(thread: string): Promise<Snapshot>;
}
interface CommandOptions { timeoutMs?: number; killGraceMs?: number; maxOutputBytes?: number }
export function command(binary: string, args: string[], input = '', options: CommandOptions = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // No shell; prompt travels via stdin, never as a command or process argument.
    const child = spawn(binary, args, {stdio:['pipe','pipe','pipe']});
    let stdout = '', stderr = '', outputBytes = 0, settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const terminate = (error: Error) => {
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, options.killGraceMs ?? 1000);
      killTimer.unref();
      finish(error);
    };
    const timer = setTimeout(() => terminate(new Error('T3 CLI timed out; submission may have succeeded. Check T3 before retrying.')), options.timeoutMs ?? 60000);
    child.on('error', e => finish(e));
    child.stdin.on('error', () => {});
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (settled) return;
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > (options.maxOutputBytes ?? 2_000_000)) {
        terminate(new Error('T3 response exceeded the output limit.'));
        return;
      }
      stdout += chunk;
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    child.on('close', code => {
      clearTimeout(killTimer);
      if (code !== 0) return finish(new Error(`T3 CLI exited ${code}. ${stderr}`));
      try { finish(undefined, JSON.parse(stdout)); }
      catch { finish(new Error('Unexpected T3 CLI JSON response.')); }
    });
    child.stdin.end(input);
  });
}
export class T3Cli implements T3 {
  constructor(private binary: string) {}
  async submit(project: string, prompt: string, thread?: string) {
    const args = thread
      ? ['thread','send',thread,'-','--json']
      : ['thread','start',project,'-','--title','WhatsApp task','--json'];
    const result = submissionSchema.safeParse(await command(this.binary, args, prompt));
    if (!result.success || (thread && result.data.threadId !== thread)) {
      throw new Error('Unexpected T3 submission response. Check T3 before retrying.');
    }
    return result.data;
  }
  async show(thread: string): Promise<Snapshot> {
    const result = snapshotSchema.safeParse(await command(this.binary, ['thread','show',thread,'--messages','50','--json']));
    if (!result.success || result.data.thread.threadId !== thread) throw new Error('Unexpected T3 thread snapshot.');
    return result.data;
  }
}
