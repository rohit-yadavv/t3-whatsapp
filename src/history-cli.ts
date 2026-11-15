import {HistoryStore,type HistoryRead} from './history.js';

// A short-lived, read-only process. It never loads credentials, writes history, or contacts WhatsApp.
function main(args:string[]) {
  const flags=new Map<string,string>();let operation:HistoryRead['operation']|undefined;
  for(let i=0;i<args.length;i++) {
    const arg=args[i];
    if(['recent','search','get'].includes(arg) && !operation){operation=arg as HistoryRead['operation'];continue;}
    if(!['--database','--scope','--query','--id','--limit','--cursor','--offset'].includes(arg) || flags.has(arg) || !args[i+1])throw new Error('Usage: history --database PATH --scope TOKEN recent|search|get [--query TEXT] [--id ID] [--limit N] [--cursor CURSOR] [--offset N]');
    flags.set(arg,args[++i]);
  }
  if(!operation || !flags.get('--database') || !flags.get('--scope'))throw new Error('A database, scoped token, and read operation are required.');
  if((flags.has('--query') && operation!=='search') || (flags.has('--id') && operation!=='get') || (flags.has('--offset') && operation!=='get'))throw new Error('Flags do not match the read operation.');
  const store=new HistoryStore(flags.get('--database')!,true);
  try {
    const result=store.read(flags.get('--scope')!,{operation,query:flags.get('--query'),id:flags.get('--id'),limit:flags.has('--limit') ? Number(flags.get('--limit')) : undefined,cursor:flags.get('--cursor'),offset:flags.has('--offset') ? Number(flags.get('--offset')) : undefined});
    process.stdout.write(JSON.stringify(result)+'\n');
  } finally {store.close();}
}
try{main(process.argv.slice(2));}catch(error){console.error(error instanceof Error ? error.message : 'History read failed.');process.exitCode=1;}
