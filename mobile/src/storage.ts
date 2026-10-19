import AsyncStorage from '@react-native-async-storage/async-storage';
const K = 'keel.connection.v1';
export async function loadConnection(): Promise<{ url: string; token: string } | null> {
  try { const v = await AsyncStorage.getItem(K); return v ? JSON.parse(v) : null; } catch { return null; }
}
export async function saveConnection(c: { url: string; token: string }) {
  try { await AsyncStorage.setItem(K, JSON.stringify(c)); } catch {}
}
export async function clearConnection() { try { await AsyncStorage.removeItem(K); } catch {} }
