// A small stand-in for OBS that speaks obs-websocket v5, including password auth.
// Used by the tests and by `npm run dev:mock` so the dashboard can be explored
// without Docker. It is NOT a faithful OBS, it only implements what Keel calls.

import { createHash, randomBytes } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';

export interface MockObsOptions {
  port: number;
  password?: string;
}

export class MockObs {
  scenes: string[] = ['Scene'];
  inputs = new Set<string>();
  currentScene = 'Scene';
  streaming = false;
  streamService: any = null;
  log: { type: string; data: any }[] = [];
  private wss: WebSocketServer;
  private sockets = new Set<WebSocket>();
  private password: string;
  private nextItem = 1;

  constructor(opts: MockObsOptions) {
    this.password = opts.password ?? '';
    this.wss = new WebSocketServer({ port: opts.port });
    this.wss.on('connection', (ws) => this.onConnection(ws));
  }

  get port(): number {
    return (this.wss.address() as { port: number }).port;
  }

  close(): Promise<void> {
    for (const s of this.sockets) s.terminate();
    return new Promise((r) => this.wss.close(() => r()));
  }

  dropClients(): void {
    for (const s of this.sockets) s.terminate();
  }

  private broadcast(eventType: string, eventData: object): void {
    const msg = JSON.stringify({ op: 5, d: { eventType, eventIntent: 1, eventData } });
    for (const s of this.sockets) s.send(msg);
  }

  setStreaming(active: boolean): void {
    this.streaming = active;
    this.broadcast('StreamStateChanged', {
      outputActive: active,
      outputState: active ? 'OBS_WEBSOCKET_OUTPUT_STARTED' : 'OBS_WEBSOCKET_OUTPUT_STOPPED',
    });
  }

  private onConnection(ws: WebSocket): void {
    const salt = randomBytes(16).toString('base64');
    const challenge = randomBytes(16).toString('base64');
    const hello: any = { obsWebSocketVersion: '5.5.0', rpcVersion: 1 };
    if (this.password) hello.authentication = { challenge, salt };
    ws.send(JSON.stringify({ op: 0, d: hello }));

    let identified = false;
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.op === 1) {
        if (this.password) {
          const secret = createHash('sha256').update(this.password + salt).digest('base64');
          const expect = createHash('sha256').update(secret + challenge).digest('base64');
          if (msg.d.authentication !== expect) {
            ws.close(4009, 'Authentication failed.');
            return;
          }
        }
        identified = true;
        this.sockets.add(ws);
        ws.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
      } else if (msg.op === 6 && identified) {
        const { requestType, requestId, requestData } = msg.d;
        this.log.push({ type: requestType, data: requestData });
        const [ok, data, code, comment] = this.handle(requestType, requestData ?? {});
        ws.send(
          JSON.stringify({
            op: 7,
            d: {
              requestType,
              requestId,
              requestStatus: { result: ok, code: ok ? 100 : code, comment },
              responseData: data,
            },
          }),
        );
      }
    });
    ws.on('close', () => this.sockets.delete(ws));
  }

  private handle(type: string, d: any): [boolean, any, number, string?] {
    switch (type) {
      case 'GetCurrentProgramScene':
        return [true, { currentProgramSceneName: this.currentScene }, 100];
      case 'SetCurrentProgramScene':
        if (!this.scenes.includes(d.sceneName)) return [false, undefined, 600, 'No scene was found by that name.'];
        this.currentScene = d.sceneName;
        this.broadcast('CurrentProgramSceneChanged', { sceneName: d.sceneName });
        return [true, {}, 100];
      case 'GetSceneList':
        return [true, { scenes: this.scenes.map((sceneName, i) => ({ sceneName, sceneIndex: i })) }, 100];
      case 'CreateScene':
        if (this.scenes.includes(d.sceneName)) return [false, undefined, 601, 'already exists'];
        this.scenes.push(d.sceneName);
        return [true, {}, 100];
      case 'CreateInput':
        if (this.inputs.has(d.inputName)) return [false, undefined, 601, 'already exists'];
        this.inputs.add(d.inputName);
        return [true, { sceneItemId: this.nextItem++ }, 100];
      case 'CreateSceneItem':
        return [true, { sceneItemId: this.nextItem++ }, 100];
      case 'SetSceneItemTransform':
      case 'SetVideoSettings':
        return [true, {}, 100];
      case 'SetStreamServiceSettings':
        this.streamService = d;
        return [true, {}, 100];
      case 'GetStreamStatus':
        return [
          true,
          {
            outputActive: this.streaming,
            outputReconnecting: false,
            outputTimecode: '00:00:00.000',
            outputBytes: 0,
            outputSkippedFrames: 0,
            outputTotalFrames: 0,
          },
          100,
        ];
      case 'StartStream':
        this.setStreaming(true);
        return [true, {}, 100];
      case 'StopStream':
        this.setStreaming(false);
        return [true, {}, 100];
      default:
        return [false, undefined, 204, `unknown request ${type}`];
    }
  }
}
