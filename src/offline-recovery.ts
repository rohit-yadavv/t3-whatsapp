import type {BinaryNode} from '@whiskeysockets/baileys';

interface Socket {
  ws: {on(event:string, listener:(node:BinaryNode)=>void):unknown;off(event:string, listener:(node:BinaryNode)=>void):unknown};
  sendNode(node:BinaryNode):Promise<void>;
}

// rc14 requests only the first offline batch. Some sessions need another
// request after that batch goes quiet before WhatsApp delivers live messages.
export function recoverOfflineSync(socket:Socket, diagnostic:(event:string,details:Record<string,number|boolean>)=>void) {
  let active=false, stopped=false, finished=false, inFlight=false, requests=0, nodes=0;
  let timer:ReturnType<typeof setTimeout>|undefined;
  function arm() {
    clearTimeout(timer);
    if(!active || stopped || inFlight)return;
    timer=setTimeout(()=>{void request();},5000);
  }
  async function request() {
    if(!active || stopped || inFlight)return;
    if(requests>=50) {
      active=false;
      finished=true;
      diagnostic('offline-sync-limit',{requests,nodes});
      return;
    }
    requests++;
    inFlight=true;
    diagnostic('offline-sync-request',{requests,nodes});
    try {
      await socket.sendNode({tag:'ib',attrs:{},content:[{tag:'offline_batch',attrs:{count:'100'}}]});
    } catch {
      active=false;
      finished=true;
      if(!stopped)diagnostic('offline-sync-failed',{requests,nodes});
    } finally {
      inFlight=false;
      arm();
    }
  }
  function preview() {
    if(stopped || finished)return;
    active=true;
    diagnostic('offline-sync-preview',{requests,nodes});
    arm();
  }
  function frame(node:BinaryNode) {
    if(active && ['message','notification','receipt','call'].includes(node.tag) && node.attrs.offline!==undefined) {
      nodes++;
      arm();
    }
  }
  function complete() {
    if(stopped)return;
    active=false;
    finished=true;
    clearTimeout(timer);
    diagnostic('offline-sync-complete',{requests,nodes});
  }
  socket.ws.on('CB:ib,,offline_preview',preview);
  socket.ws.on('frame',frame);
  socket.ws.on('CB:ib,,offline',complete);
  return ()=>{
    stopped=true;
    active=false;
    clearTimeout(timer);
    socket.ws.off('CB:ib,,offline_preview',preview);
    socket.ws.off('frame',frame);
    socket.ws.off('CB:ib,,offline',complete);
  };
}
