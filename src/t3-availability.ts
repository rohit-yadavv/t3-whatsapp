/** Read-only checks; no agent turns or automatic retries of user work. */
export const T3_SHUTDOWN_GRACE_MS = 5 * 60 * 1000;
export const T3_CHECK_INTERVAL_MS = 60 * 1000;
export type AvailabilityEvent = 't3-unavailable' | 't3-recovered' | 't3-auto-stop';

export class T3Availability {
  private unavailableSince?:number;
  private nextCheck=0;
  private checking=false;
  private stopped=false;
  constructor(
    private check:()=>Promise<unknown>,
    private shutdown:()=>void,
    private event:(event:AvailabilityEvent)=>void=()=>{},
    private now:()=>number=()=>performance.now(),
  ) {}
  async tick() {
    if (this.stopped || this.checking || this.now()<this.nextCheck) return;
    this.checking=true;
    this.nextCheck=this.now()+T3_CHECK_INTERVAL_MS;
    try {
      let available=false;
      try {await this.check();available=true;} catch { /* An unavailable CLI/backend starts the grace period. */ }
      if (this.stopped) return;
      const time=this.now();
      if (available) {
        if (this.unavailableSince!==undefined) {
          this.unavailableSince=undefined;
          this.event('t3-recovered');
        }
      } else if (this.unavailableSince===undefined) {
        this.unavailableSince=time;
        this.event('t3-unavailable');
      } else if (time-this.unavailableSince>=T3_SHUTDOWN_GRACE_MS) {
        this.stopped=true;
        this.event('t3-auto-stop');
        this.shutdown();
      }
    } finally {this.checking=false;}
  }
  stop() {this.stopped=true;}
}
