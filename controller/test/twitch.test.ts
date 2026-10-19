import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { TwitchBot, parsePrivmsg, isAuthorized, type BotActions } from '../src/twitch.ts';

test('parses tags, badges and message text', () => {
  const line =
    '@badges=moderator/1,subscriber/12;display-name=Mod;mod=1 :modguy!modguy@modguy.tmi.twitch.tv PRIVMSG #chan :!brb now';
  const c = parsePrivmsg(line)!;
  assert.equal(c.user, 'modguy');
  assert.deepEqual(c.badges, ['moderator', 'subscriber']);
  assert.equal(c.text, '!brb now');
});

test('ignores non chat lines', () => {
  assert.equal(parsePrivmsg(':tmi.twitch.tv 001 bot :Welcome'), null);
});

test('authorization: broadcaster, moderator, allow-list, nobody else', () => {
  assert.equal(isAuthorized({ user: 'a', badges: ['broadcaster'], text: '' }, []), true);
  assert.equal(isAuthorized({ user: 'a', badges: ['moderator'], text: '' }, []), true);
  assert.equal(isAuthorized({ user: 'a', badges: ['subscriber'], text: '' }, []), false);
  assert.equal(isAuthorized({ user: 'friend', badges: [], text: '' }, ['friend']), true);
});

async function harness() {
  const received: string[] = [];
  const wss = new WebSocketServer({ port: 0 });
  let serverSocket: import('ws').WebSocket | null = null;
  wss.on('connection', (ws) => {
    serverSocket = ws;
    ws.on('message', (m) => {
      const line = m.toString();
      received.push(line);
      if (line.startsWith('NICK')) ws.send(':tmi.twitch.tv 001 keelbot :Welcome, GLHF!\r\n');
    });
  });
  const calls: string[] = [];
  const actions: BotActions = {
    status: () => 'STATUS',
    setScene: async (k) => (calls.push(`scene:${k}`), `scene ${k}`),
    setAuto: async () => (calls.push('auto'), 'auto on'),
    startStream: async () => (calls.push('start'), 'starting'),
    stopStream: async () => (calls.push('stop'), 'stopped'),
  };
  const port = (wss.address() as { port: number }).port;
  const bot = new TwitchBot(
    { wsUrl: `ws://127.0.0.1:${port}`, channel: 'chan', botName: 'keelbot', token: 'oauth:abc', allowedUsers: ['friend'] },
    actions,
  );
  bot.connect();
  for (let i = 0; i < 100 && !bot.joined; i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(bot.joined, 'bot should join');
  const chat = (badges: string, user: string, text: string) =>
    serverSocket!.send(`@badges=${badges} :${user}!${user}@${user}.tmi.twitch.tv PRIVMSG #chan :${text}\r\n`);
  const done = async () => {
    bot.close();
    await new Promise<void>((r) => wss.close(() => r()));
  };
  return { received, calls, chat, done, bot };
}

test('handshake sends caps, pass, nick and join', async () => {
  const { received, done } = await harness();
  assert.ok(received.some((l) => l.startsWith('CAP REQ')));
  assert.ok(received.includes('PASS oauth:abc'));
  assert.ok(received.includes('NICK keelbot'));
  assert.ok(received.includes('JOIN #chan'));
  await done();
});

test('moderators can switch scenes, viewers cannot', async () => {
  const { calls, chat, done } = await harness();
  chat('moderator/1', 'mod1', '!brb');
  chat('subscriber/1', 'viewer', '!live');
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(calls, ['scene:brb']);
  await done();
});

test('only the broadcaster or allow-list can stop the stream', async () => {
  const { calls, chat, received, done } = await harness();
  chat('moderator/1', 'mod1', '!stop');
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(calls, []);
  assert.ok(received.some((l) => l.includes('only the broadcaster')));
  chat('broadcaster/1', 'chan', '!stop');
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(calls, ['stop']);
  await done();
});

test('!status replies in chat', async () => {
  const { chat, received, done } = await harness();
  chat('moderator/1', 'mod1', '!status');
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(received.includes('PRIVMSG #chan :STATUS'));
  await done();
});
