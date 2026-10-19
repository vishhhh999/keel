// Twitch chat control over the public IRC-over-WebSocket gateway. No library needed.
// Commands are limited to the broadcaster, channel moderators and an optional allow-list.

import WebSocket from 'ws';

export interface BotActions {
  status(): string;
  setScene(which: 'live' | 'low' | 'brb'): Promise<string>;
  setAuto(): Promise<string>;
  setSource(pin: 'auto' | 'primary' | 'backup'): Promise<string>;
  startStream(): Promise<string>;
  stopStream(): Promise<string>;
}

export interface TwitchOptions {
  wsUrl: string;
  channel: string;
  botName: string;
  token: string;
  allowedUsers: string[];
}

export interface ParsedChat {
  user: string;
  badges: string[];
  text: string;
}

export function parsePrivmsg(line: string): ParsedChat | null {
  // @tag=val;tag=val :nick!nick@nick.tmi.twitch.tv PRIVMSG #chan :message
  const m = line.match(/^(?:@(\S+) )?:([^!\s]+)![^ ]+ PRIVMSG #\S+ :(.*)$/);
  if (!m) return null;
  const tags: Record<string, string> = {};
  for (const kv of (m[1] ?? '').split(';')) {
    const i = kv.indexOf('=');
    if (i > 0) tags[kv.slice(0, i)] = kv.slice(i + 1);
  }
  const badges = (tags['badges'] ?? '')
    .split(',')
    .map((b) => b.split('/')[0]!)
    .filter(Boolean);
  return { user: m[2]!.toLowerCase(), badges, text: m[3]!.replace(/\r$/, '') };
}

export function isAuthorized(chat: ParsedChat, allowed: string[]): boolean {
  return (
    chat.badges.includes('broadcaster') || chat.badges.includes('moderator') || allowed.includes(chat.user)
  );
}

export class TwitchBot {
  private opts: TwitchOptions;
  private actions: BotActions;
  private ws: WebSocket | null = null;
  private closing = false;
  private retryMs = 2000;
  private lastSay = 0;
  joined = false;

  constructor(opts: TwitchOptions, actions: BotActions) {
    this.opts = opts;
    this.actions = actions;
  }

  connect(): void {
    this.closing = false;
    const ws = new WebSocket(this.opts.wsUrl);
    this.ws = ws;
    ws.on('open', () => {
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      ws.send(`PASS oauth:${this.opts.token.replace(/^oauth:/, '')}`);
      ws.send(`NICK ${this.opts.botName}`);
      ws.send(`JOIN #${this.opts.channel}`);
    });
    ws.on('message', (raw) => {
      for (const line of raw.toString().split('\r\n')) if (line) this.onLine(ws, line);
    });
    ws.on('error', () => {
      /* close handler reconnects */
    });
    ws.on('close', () => {
      this.joined = false;
      if (!this.closing) {
        setTimeout(() => this.connect(), this.retryMs);
        this.retryMs = Math.min(this.retryMs * 2, 30000);
      }
    });
  }

  close(): void {
    this.closing = true;
    this.ws?.close();
  }

  say(text: string): void {
    const now = Date.now();
    if (!this.joined || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (now - this.lastSay < 1500) return; // stay well under Twitch rate limits
    this.lastSay = now;
    this.ws.send(`PRIVMSG #${this.opts.channel} :${text}`);
  }

  private onLine(ws: WebSocket, line: string): void {
    if (line.startsWith('PING')) {
      ws.send(line.replace('PING', 'PONG'));
      return;
    }
    if (/ 001 /.test(line) || / JOIN #/.test(line)) {
      this.joined = true;
      this.retryMs = 2000;
    }
    const chat = parsePrivmsg(line);
    if (!chat || !chat.text.startsWith('!')) return;
    void this.onCommand(chat);
  }

  async onCommand(chat: ParsedChat): Promise<void> {
    const [first, arg] = chat.text.trim().split(/\s+/);
    const cmd = first!.toLowerCase();
    const known = ['!status', '!live', '!low', '!brb', '!auto', '!start', '!stop', '!source'];
    if (!known.includes(cmd)) return;
    if (!isAuthorized(chat, this.opts.allowedUsers)) return;
    // Ending the broadcast is the one destructive action: broadcaster only.
    if (cmd === '!stop' && !chat.badges.includes('broadcaster') && !this.opts.allowedUsers.includes(chat.user)) {
      this.say(`@${chat.user} only the broadcaster can stop the stream`);
      return;
    }
    try {
      let reply: string;
      switch (cmd) {
        case '!status':
          reply = this.actions.status();
          break;
        case '!live':
          reply = await this.actions.setScene('live');
          break;
        case '!low':
          reply = await this.actions.setScene('low');
          break;
        case '!brb':
          reply = await this.actions.setScene('brb');
          break;
        case '!auto':
          reply = await this.actions.setAuto();
          break;
        case '!source': {
          const pin = (arg ?? '').toLowerCase();
          if (!['auto', 'primary', 'backup'].includes(pin)) {
            reply = 'Usage: !source auto | primary | backup';
            break;
          }
          reply = await this.actions.setSource(pin as 'auto' | 'primary' | 'backup');
          break;
        }
        case '!start':
          reply = await this.actions.startStream();
          break;
        default:
          reply = await this.actions.stopStream();
      }
      this.say(reply);
    } catch (e) {
      this.say(`Keel: ${(e as Error).message}`);
    }
  }
}
