import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { Relay, copyArgs, shieldArgs, redactSecrets, type ChildLike } from '../src/relay.ts';
import { parseDestinations, redactUrl } from '../src/config.ts';

class FakeChild extends EventEmitter implements ChildLike {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  args: string[];
  constructor(args: string[]) {
    super();
    this.args = args;
  }
  kill(): boolean {
    this.killed = true;
    queueMicrotask(() => this.emit('exit', null));
    return true;
  }
  progress(size: number) {
    this.stdout.write(`total_size=${size}\nprogress=continue\n`);
  }
  crash(msg = 'Connection reset by peer') {
    this.stderr.write(msg + '\n');
    setTimeout(() => this.emit('exit', 1), 5);
  }
}

const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));

function setup(shieldDelayS = 0.05) {
  const children: FakeChild[] = [];
  const dests = parseDestinations('Twitch=rtmp://live.twitch.tv/app/live_secret1234;Kick=rtmps://kick.example/app/sk_abcd9876');
  const relay = new Relay(
    { inputUrl: 'rtmp://mediamtx:1935/out/k', brbImage: '/assets/brb.png', fps: 30, width: 1920, height: 1080, shieldDelayS, spawn: (_c, a) => { const ch = new FakeChild(a); children.push(ch); return ch; }, backoffMs: () => 20 },
    dests,
  );
  const live = (id: string) => relay.status().find((d) => d.id === id)!;
  return { relay, children, live };
}

test('parses destinations, keys never shown', () => {
  const d = parseDestinations('Twitch=rtmp://live.twitch.tv/app/live_123456789\nYouTube=rtmp://a.rtmp.youtube.com/live2/abcd-efgh-ijkl');
  assert.deepEqual(d.map((x) => x.id), ['twitch', 'youtube']);
  assert.equal(redactUrl(d[0]!.url), 'rtmp://live.twitch.tv/app/••••6789');
  assert.throws(() => parseDestinations('Bad=http://x'), /rtmp/);
  assert.equal(redactSecrets('Error opening rtmp://live.twitch.tv/app/live_123456789: refused', d[0]!.url), 'Error opening rtmp://live.twitch.tv/app/••••6789: refused');
});

test('ffmpeg arguments: copy for the program, encoded still image for the shield, mpegts for srt', () => {
  const c = copyArgs('rtmp://in', 'rtmp://out/key');
  assert.ok(c.includes('copy') && c.at(-2) === 'flv');
  assert.equal(copyArgs('rtmp://in', 'srt://yt:9000?streamid=x').at(-2), 'mpegts');
  const s = shieldArgs({ image: '/assets/brb.png', fps: 30, width: 1280, height: 720 }, 'rtmp://out/key');
  assert.ok(s.includes('/assets/brb.png') && s.includes('libx264') && s.includes('anullsrc=channel_layout=stereo:sample_rate=48000'));
});

test('program present: one copy process per destination, each reports live', async () => {
  const { relay, children, live } = setup();
  relay.setInputReady(true);
  relay.start();
  assert.equal(children.length, 2);
  assert.ok(children.every((c) => c.args.includes('copy')));
  children[0]!.progress(1000);
  children[1]!.progress(1000);
  await tick();
  assert.equal(live('twitch').state, 'live');
  assert.equal(relay.onAir, true);
  relay.stop();
  await tick();
  assert.ok(children.every((c) => c.killed));
  assert.equal(live('twitch').state, 'off');
});

test('one destination failing retries on its own and never touches the other', async () => {
  const { relay, children, live } = setup();
  const retries: string[] = [];
  relay.on('retry', (d) => retries.push(d.id));
  relay.setInputReady(true);
  relay.start();
  children[0]!.progress(1);
  children[1]!.progress(1);
  await tick();
  children[1]!.crash('Server returned 404 Not Found rtmps://kick.example/app/sk_abcd9876');
  await tick(10);
  assert.equal(live('kick').state, 'retrying');
  assert.match(live('kick').lastError, /••••9876/);
  assert.doesNotMatch(live('kick').lastError, /sk_abcd9876/, 'stream key must be redacted');
  assert.equal(live('twitch').state, 'live', 'Twitch is untouched');
  await tick(40);
  assert.equal(children.length, 3, 'Kick respawned');
  children[2]!.progress(5);
  await tick();
  assert.equal(live('kick').state, 'live');
  assert.equal(live('kick').restarts, 1);
  assert.deepEqual(retries, ['kick']);
  relay.stop();
});

test('crash shield: program disappears, destinations switch to BRB, then back to the program', async () => {
  const { relay, children, live } = setup();
  const shield: boolean[] = [];
  relay.on('shield', (on) => shield.push(on));
  relay.setInputReady(true);
  relay.start();
  children.forEach((c) => c.progress(1));
  await tick();
  relay.setInputReady(false); // OBS crashed
  await tick(90);
  const shieldProcs = children.slice(2);
  assert.equal(shieldProcs.length, 2);
  assert.ok(shieldProcs.every((c) => c.args.includes('/assets/brb.png')));
  shieldProcs.forEach((c) => c.progress(1));
  await tick();
  assert.equal(live('twitch').state, 'shield');
  assert.equal(relay.shielding, true);
  relay.setInputReady(true); // OBS back
  await tick();
  const back = children.slice(4);
  assert.equal(back.length, 2);
  assert.ok(back.every((c) => c.args.includes('copy')));
  assert.deepEqual(shield, [true, false]);
  relay.stop();
});

test('a short program blip inside the shield delay does not reconnect anything', async () => {
  const { relay, children } = setup(0.2);
  relay.setInputReady(true);
  relay.start();
  relay.setInputReady(false);
  await tick(30);
  relay.setInputReady(true);
  await tick(250);
  assert.equal(children.length, 2, 'no shield, no restarts');
  relay.stop();
});

test('starting before OBS is ready waits, then shields if the program never comes', async () => {
  const { relay, children, live } = setup(0.05);
  relay.start();
  assert.equal(children.length, 0);
  assert.equal(live('twitch').state, 'connecting');
  await tick(90);
  assert.equal(children.length, 2);
  assert.ok(children.every((c) => c.args.includes('/assets/brb.png')));
  relay.stop();
});

test('destinations can be switched off and on while live', async () => {
  const { relay, children, live } = setup();
  relay.setInputReady(true);
  relay.start();
  assert.equal(relay.setEnabled('kick', false), true);
  await tick();
  assert.equal(children[1]!.killed, true);
  assert.equal(live('kick').state, 'disabled');
  relay.setEnabled('kick', true);
  assert.equal(children.length, 3);
  assert.equal(relay.setEnabled('nope', true), false);
  relay.stop();
});
