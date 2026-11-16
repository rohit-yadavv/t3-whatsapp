/** Explain startup failures without printing configuration values or credentials. */
export function setupError(error:unknown):string {
  if(error instanceof Error) {
    if(error.name==='ZodError') {
      const issues=(error as Error & {issues?:Array<{path?:Array<string|number>}>}).issues ?? [];
      const fields=[...new Set(issues.map(issue=>issue.path?.join('.')||'root settings'))];
      return `Configuration is invalid${fields.length ? ' at '+fields.join(', ') : ''}. Fix these fields in your local config.json, then run pnpm run setup again. Saved sessions were not changed.`;
    }
    if(error.name==='SyntaxError') return 'The local configuration is not valid JSON. Fix its syntax, then run pnpm run setup again. Saved sessions were not changed.';
    const code=(error as NodeJS.ErrnoException).code;
    if(code==='EACCES'||code==='EPERM') return `Setup was denied permission (${code}) to access its local files or listen on localhost. Check the configuration/data directory permissions and terminal access. Saved sessions were not changed.`;
    if(code==='EEXIST') return 'Another setup operation is holding a local lock. Close any existing setup terminal and retry; verify an old owner has exited before removing its lock.';
    if(code==='ENOENT') return 'A required local file or directory was not found. Check the configured paths and installed dependencies, then run pnpm run setup again.';
    if(!code)return error.message;
    return `Setup could not complete a local operation (${code}). Check the configuration/data directory and existing setup processes. Saved sessions were not changed.`;
  }
  return 'Setup could not start. Check the local configuration, file permissions, and existing setup processes. Saved sessions were not changed.';
}
