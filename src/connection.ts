import { DisconnectReason } from '@whiskeysockets/baileys';

export type WebVersion = [number, number, number];
export function chooseVersion(live: {version: WebVersion; isLatest: boolean}, fallback: WebVersion): WebVersion {
  return live.isLatest ? live.version : fallback;
}

export function streamErrorReason(error: unknown): string | undefined {
  if (!(error && typeof error === 'object' && 'message' in error)) return;
  const message = error.message;
  if (typeof message !== 'string') return;
  const reason = /^Stream Errored \(([a-z -]{1,40})\)$/.exec(message)?.[1];
  if (!reason) return;
  return ['ack','conflict','restart required'].includes(reason) ? reason : 'other-stream-error';
}
export function disconnectAction(code: number | undefined, streamReason?: string, ackRetries = 0): 'stop' | 'restart' | 'retry' {
  // Baileys uses 500 for both bad sessions and some stream errors. Only the
  // exact known ack case gets bounded recovery; other 500s remain terminal.
  if (code === DisconnectReason.badSession && streamReason === 'ack' && ackRetries < 3) return 'retry';
  if (code === DisconnectReason.restartRequired) return 'restart';
  if ([DisconnectReason.loggedOut, DisconnectReason.connectionReplaced,
    DisconnectReason.badSession, DisconnectReason.forbidden,
    DisconnectReason.multideviceMismatch].includes(code ?? 0)) return 'stop';
  return 'retry';
}
