import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { KeelClient } from './src/client';
import { Mark } from './src/Mark';
import { COLORS, Scene, Status, backoffMs, describe, formatKbps, normalizeUrl, parseShareLink } from './src/model';
import { clearConnection, loadConnection, saveConnection } from './src/storage';

const FONT = { fontWeight: '800' as const, letterSpacing: -1.5 };

export default function App() {
  const [conn, setConn] = useState<{ url: string; token: string } | null | undefined>(undefined);
  useEffect(() => { loadConnection().then(setConn); }, []);
  if (conn === undefined) return <View style={s.page} />;
  if (conn === null) return <Connect onDone={async (c) => { await saveConnection(c); setConn(c); }} />;
  return <Home conn={conn} onLeave={async () => { await clearConnection(); setConn(null); }} />;
}

function Connect({ onDone }: { onDone: (c: { url: string; token: string }) => void }) {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    setErr('');
    const shared = parseShareLink(url);
    const base = shared?.url ?? normalizeUrl(url);
    const tk = shared?.token ?? token.trim();
    if (!base || !tk) return setErr('Enter your server address and token.');
    setBusy(true);
    try { await new KeelClient(base, tk).status(); onDone({ url: base, token: tk }); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not reach the server.'); }
    finally { setBusy(false); }
  }
  return (
    <SafeAreaView style={s.page}>
      <StatusBar style="dark" />
      <View style={{ padding: 24, gap: 18 }}>
        <Mark size={72} tilt={6} bottom={COLORS.hull} />
        <Text style={[s.h1, FONT]}>Hold the line.</Text>
        <Text style={s.lead}>Connect to your Keel server. Paste the address and your admin token, or a keel:// share link.</Text>
        <TextInput style={s.input} placeholder="keel.example.com" placeholderTextColor={COLORS.muted} autoCapitalize="none" autoCorrect={false} value={url} onChangeText={setUrl} />
        <TextInput style={s.input} placeholder="Token" placeholderTextColor={COLORS.muted} autoCapitalize="none" autoCorrect={false} secureTextEntry value={token} onChangeText={setToken} />
        {err ? <Text style={s.err}>{err}</Text> : null}
        <Pressable style={s.btnPrimary} onPress={go} disabled={busy}>{busy ? <ActivityIndicator color={COLORS.hull} /> : <Text style={s.btnText}>Connect</Text>}</Pressable>
      </View>
    </SafeAreaView>
  );
}

function Home({ conn, onLeave }: { conn: { url: string; token: string }; onLeave: () => void }) {
  const client = useRef(new KeelClient(conn.url, conn.token)).current;
  const [st, setSt] = useState<Status | null>(null);
  const [msg, setMsg] = useState('');
  const [offline, setOffline] = useState(false);
  const attempt = useRef(0);

  useEffect(() => {
    let stop = false; let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      // `stop` guards against a request that resolves after the screen was left.
      try { const next = await client.status(); if (stop) return; setSt(next); setOffline(false); attempt.current = 0; timer = setTimeout(loop, 1000); }
      catch { if (stop) return; setOffline(true); timer = setTimeout(loop, backoffMs(attempt.current++)); }
    };
    loop();
    return () => { stop = true; clearTimeout(timer); };
  }, [client]);

  const act = useCallback(async (fn: () => Promise<{ message: string }>) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try { setMsg((await fn()).message); } catch (e) { setMsg(e instanceof Error ? e.message : 'Failed.'); }
  }, []);

  const d = st ? describe(st) : null;
  const scene = (sc: Scene, label: string) => (
    <Pressable key={sc} style={s.pill} onPress={() => act(() => client.setScene(sc))}><Text style={s.pillText}>{label}</Text></Pressable>
  );

  return (
    <SafeAreaView style={s.page}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <View style={s.row}><Text style={[s.brand, FONT]}>keel</Text><Pressable onPress={onLeave}><Text style={s.link}>Sign out</Text></Pressable></View>
        {offline ? <Text style={s.err}>Cannot reach the server. Retrying.</Text> : null}
        <View style={s.hero}>
          {d ? <>
            <View style={s.row}><Mark size={64} tilt={d.tilt} /><View style={{ alignItems: 'flex-end' }}><Text style={s.onDark}>{formatKbps(d.kbps)} in</Text><Text style={s.onDark}>{st!.obs.streaming ? 'Broadcasting ' + (st!.obs.timecode ?? '') : 'Not broadcasting'}</Text></View></View>
            <Text style={[s.state, FONT, { color: d.color }]}>{d.word}</Text>
          </> : <ActivityIndicator color={COLORS.bone} />}
        </View>
        <View style={s.card}>
          <Text style={s.eyebrow}>Broadcast</Text>
          <View style={s.row}>
            <Pressable style={[s.btnPrimary, { flex: 1 }]} onPress={() => act(() => client.startStream())}><Text style={s.btnText}>Go live</Text></Pressable>
            <Pressable style={[s.btnGhost, { flex: 1 }]} onPress={() => act(() => client.stopStream())}><Text style={s.btnText}>Stop</Text></Pressable>
          </View>
        </View>
        <View style={s.card}>
          <Text style={s.eyebrow}>Scene</Text>
          <View style={s.row}>{scene('live', 'Live')}{scene('low', 'Weak')}{scene('brb', 'BRB')}</View>
          <Pressable style={[s.btnGhost, { marginTop: 12 }]} onPress={() => act(() => client.setMode(st?.mode === 'auto' ? 'manual' : 'auto'))}><Text style={s.btnText}>Auto switching: {st?.mode === 'auto' ? 'on' : 'off'}</Text></Pressable>
        </View>
        {msg ? <Text style={s.lead}>{msg}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: COLORS.bone },
  h1: { fontSize: 48, lineHeight: 48, color: COLORS.hull },
  brand: { fontSize: 32, color: COLORS.hull },
  lead: { fontSize: 18, color: COLORS.hull, lineHeight: 24 },
  input: { borderWidth: 2, borderColor: COLORS.hull, borderRadius: 999, paddingHorizontal: 22, height: 56, fontSize: 18, color: COLORS.hull, backgroundColor: COLORS.card },
  err: { color: '#8A2F12', fontWeight: '700', fontSize: 16 },
  btnPrimary: { backgroundColor: COLORS.buoy, borderRadius: 999, height: 56, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  btnGhost: { borderWidth: 2, borderColor: COLORS.hull, borderRadius: 999, height: 56, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  btnText: { fontWeight: '800', fontSize: 18, color: COLORS.hull },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  hero: { backgroundColor: COLORS.hull, borderRadius: 36, padding: 24, gap: 14 },
  state: { fontSize: 56, lineHeight: 56 },
  onDark: { color: COLORS.onDark, fontWeight: '700', fontSize: 15 },
  card: { backgroundColor: COLORS.card, borderWidth: 2, borderColor: COLORS.hull, borderRadius: 32, padding: 20, gap: 12 },
  eyebrow: { fontWeight: '700', fontSize: 13, letterSpacing: 1.5, textTransform: 'uppercase', color: COLORS.muted },
  pill: { flex: 1, borderWidth: 2, borderColor: COLORS.hull, borderRadius: 999, height: 52, alignItems: 'center', justifyContent: 'center' },
  pillText: { fontWeight: '800', fontSize: 17, color: COLORS.hull },
  link: { fontWeight: '700', fontSize: 16, color: COLORS.hull, textDecorationLine: 'underline' },
});
