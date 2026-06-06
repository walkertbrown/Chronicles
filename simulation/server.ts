import http from 'node:http';
import type {
  Drives,
  IllnessState,
  Skills,
  Traits,
  WorldState,
} from '@shared/types.js';
import { EventType } from '@shared/types.js';
import { getChroniclePages } from './firebase.js';
import { sourceStateLabel } from './source/source.js';

const PORT = 3001;
const VESSEL_ZONE_ROW = 30;

function setJsonHeaders(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Content-Type', 'application/json');
}

function sendJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
  setJsonHeaders(res);
  res.writeHead(statusCode);
  res.end(JSON.stringify(body));
}

function alivePopulation(state: WorldState): number {
  return state.agents.filter((agent) => agent.alive).length;
}

function buildStateSnapshot(state: WorldState): {
  tick: number;
  day: number;
  year: number;
  season: string;
  population: number;
  vessel: { beached: boolean; position: { x: number; y: number } };
  agents: Array<{
    id: string;
    name: string;
    familyName: string;
    role: string;
    alive: boolean;
    position: { x: number; y: number };
    home: { x: number; y: number };
    age: number;
    gender: string;
    significanceScore: number;
    chronicleThreadActive: boolean;
    drives: Drives;
    traits: Traits;
    skills: Skills;
    illnessState: IllnessState | null;
    relationships: Array<{ agentId: string; trust: number; bond: string }>;
  }>;
  conduits: Array<{
    id: string;
    position: { x: number; y: number };
    bondedAgentId: string;
    bondType: 'light' | 'dark';
  }>;
  tiles: Array<{
    x: number;
    y: number;
    terrain: string;
    resources: unknown;
    occupants: string[];
  }>;
  structures: Array<{
    position: { x: number; y: number };
    type: string;
    progress: number;
    fireFuel: number;
  }>;
  source: {
    position: { x: number; y: number };
    control: number;
    state: 'dormant' | 'light' | 'dark';
  };
  latestSummary: { worldNow: string } | null;
} {
  const tiles: Array<{
    x: number;
    y: number;
    terrain: string;
    resources: unknown;
    occupants: string[];
  }> = [];

  // Built structures (huts) live on their tiles; surface them for rendering.
  const structures: Array<{
    position: { x: number; y: number };
    type: string;
    progress: number;
    fireFuel: number;
  }> = [];

  for (const tile of state.tiles.getDirtyTiles().values()) {
    if (tile.structure !== null) {
      structures.push({
        position: { x: tile.x, y: tile.y },
        type: tile.structure.type,
        progress: tile.structure.progress,
        fireFuel: tile.structure.fireFuel,
      });
    }
    if (tile.occupants.length === 0 && tile.conduitIds.length === 0) continue;
    tiles.push({
      x: tile.x,
      y: tile.y,
      terrain: tile.terrain,
      resources: tile.resources,
      occupants: tile.occupants,
    });
  }

  return {
    tick: state.tick,
    day: state.day,
    year: state.year,
    season: state.season,
    population: alivePopulation(state),
    vessel: {
      beached: state.vessel.beached,
      position: { ...state.vessel.position },
    },
    agents: state.agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      familyName: agent.familyName,
      role: agent.foundingHistory?.role ?? 'unknown',
      alive: agent.alive,
      position: { ...agent.position },
      home: { ...(agent.home ?? agent.position) },
      age: agent.age,
      gender: agent.gender,
      significanceScore: agent.significanceScore,
      chronicleThreadActive: agent.chronicleThreadActive,
      drives: agent.drives,
      traits: agent.traits,
      skills: agent.skills,
      illnessState: agent.illnessState,
      relationships: agent.relationships.map((rel) => ({
        agentId: rel.agentId,
        trust: rel.trust,
        bond: rel.bond,
      })),
      conduitId: agent.conduitId,
      conduitBondType: agent.conduitBondType,
      currentAction: agent.currentAction,
      inventory: {
        wood: agent.inventory?.wood ?? 0,
        tools: (agent.inventory?.items ?? []).map((it) => it.type),
      },
    })),
    conduits: state.conduits
      .filter((c): c is typeof c & { bondedAgentId: string; bondType: 'light' | 'dark' } =>
        c.bondedAgentId !== null && c.bondType !== null,
      )
      .map((c) => ({
        id: c.id,
        position: { ...c.position },
        bondedAgentId: c.bondedAgentId,
        bondType: c.bondType,
      })),
    tiles,
    structures,
    source: {
      position: { ...state.source.position },
      control: state.source.control,
      state: sourceStateLabel(state.source.control),
    },
    latestSummary: state.latestSummary !== null ? { worldNow: state.latestSummary.worldNow } : null,
  };
}

function buildDeathsSnapshot(state: WorldState) {
  const deadAgents = state.agents.filter((a) => !a.alive);

  return deadAgents.map((agent) => {
    // Find the death event for this agent
    const deathEvent = [...state.eventLog]
      .reverse()
      .find(
        (e) => e.type === EventType.Death && e.involvedAgents.includes(agent.id),
      );

    // Resolve surviving family by name
    const survivingFamily: Array<{
      id: string;
      name: string;
      familyName: string;
      relationship: string;
    }> = [];

    const addIfAlive = (id: string | null, relationship: string) => {
      if (id === null) return;
      const found = state.agents.find((a) => a.id === id && a.alive);
      if (found !== undefined) {
        survivingFamily.push({
          id: found.id,
          name: found.name,
          familyName: found.familyName,
          relationship,
        });
      }
    };

    addIfAlive(agent.lineage.motherId, 'mother');
    addIfAlive(agent.lineage.fatherId, 'father');
    for (const childId of agent.lineage.children) {
      addIfAlive(childId, 'child');
    }

    return {
      id: agent.id,
      name: agent.name,
      familyName: agent.familyName,
      role: agent.foundingHistory?.role ?? 'unknown',
      gender: agent.gender,
      age: agent.age,
      generation: agent.generation,
      significanceScore: agent.significanceScore,
      drives: agent.drives,
      traits: agent.traits,
      skills: agent.skills,
      illnessState: agent.illnessState,
      relationships: agent.relationships.map((rel) => ({
        agentId: rel.agentId,
        trust: rel.trust,
        bond: rel.bond,
      })),
      deathCause: deathEvent?.description ?? 'Cause unknown',
      dayOfDeath: deathEvent?.day ?? state.day,
      survivingFamily,
    };
  });
}

export function startServer(getState: () => WorldState): void {
  const server = http.createServer((req, res) => {
    const pathname = req.url?.split('?')[0] ?? '';

    if (req.method !== 'GET') {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    const state = getState();

    switch (pathname) {
      case '/health':
        sendJson(res, 200, {
          ticking: true,
          tick: state.tick,
          day: state.day,
          population: alivePopulation(state),
        });
        return;

      case '/state':
        sendJson(res, 200, buildStateSnapshot(state));
        return;

      case '/chronicle':
        void getChroniclePages(state)
          .then((pages) => {
            sendJson(res, 200, { pages });
          })
          .catch(() => {
            sendJson(res, 200, {
              pages: [...state.chroniclePages].sort(
                (a, b) => (a.order ?? a.day) - (b.order ?? b.day),
              ),
            });
          });
        return;

      case '/deaths':
        sendJson(res, 200, {
          deaths: buildDeathsSnapshot(state),
        });
        return;

      default:
        sendJson(res, 404, { error: 'Not found' });
    }
  });

  server.listen(PORT, () => {
    console.log(`Simulation server listening on http://localhost:${PORT}`);
  });
}
