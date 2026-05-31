import type { ChronicleEntry, DeadAgentSnapshot, WorldSnapshot } from './types';

// Configure via .env(.local): NEXT_PUBLIC_API_URL=https://your-sim-host
// Falls back to localhost for local development.
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export async function fetchWorldState(): Promise<WorldSnapshot> {
  const res = await fetch(`${API_BASE}/state`, { cache: 'no-store' });
  return res.json();
}

export async function fetchChronicle(): Promise<{ pages: ChronicleEntry[] }> {
  const res = await fetch(`${API_BASE}/chronicle`, { cache: 'no-store' });
  return res.json();
}

export async function fetchDeaths(): Promise<{ deaths: DeadAgentSnapshot[] }> {
  const res = await fetch(`${API_BASE}/deaths`, { cache: 'no-store' });
  return res.json();
}
