export interface SurvivingFamilyMember {
  id: string;
  name: string;
  familyName: string;
  relationship: string;
}

export interface DeadAgentSnapshot {
  id: string;
  name: string;
  familyName: string;
  role: string;
  gender: string;
  age: number;
  generation: number;
  significanceScore: number;
  drives: {
    hunger: number;
    fatigue: number;
    fear: number;
    socialNeed: number;
    grief: number;
    longing: number;
  };
  traits: {
    curiosity: number;
    courage: number;
    nobility: number;
    cunning: number;
    endurance: number;
    attraction: number;
    aggression: number;
    acuity: number;
  };
  skills: {
    hunting: number;
    gathering: number;
    building: number;
    fire: number;
    healing: number;
  };
  illnessState: { sick: boolean; severity: number } | null;
  relationships: Array<{ agentId: string; trust: number; bond: string }>;
  deathCause: string;
  dayOfDeath: number;
  survivingFamily: SurvivingFamilyMember[];
}

export interface AgentSnapshot {
  id: string;
  name: string;
  familyName: string;
  role: string;
  alive: boolean;
  position: { x: number; y: number };
  age: number;
  gender: string;
  significanceScore: number;
  chronicleThreadActive: boolean;
  drives: {
    hunger: number;
    fatigue: number;
    fear: number;
    socialNeed: number;
    grief: number;
    longing: number;
  };
  traits: {
    curiosity: number;
    courage: number;
    nobility: number;
    cunning: number;
    endurance: number;
    attraction: number;
    aggression: number;
    acuity: number;
  };
  skills: {
    hunting: number;
    gathering: number;
    building: number;
    fire: number;
    healing: number;
  };
  illnessState: { sick: boolean; severity: number } | null;
  relationships: Array<{ agentId: string; trust: number; bond: string }>;
  conduitId: string | null;
  conduitBondType: 'light' | 'dark' | null;
  currentAction: string | null;
}

export interface TileSnapshot {
  x: number;
  y: number;
  terrain: string;
  resources: unknown;
  occupants: string[];
}

export interface BondedConduitSnapshot {
  id: string;
  position: { x: number; y: number };
  bondedAgentId: string;
  bondType: 'light' | 'dark';
}

export interface ChronicleThread {
  familyName: string;
  primaryAgentId: string;
  prose: string;
}

export interface ChronicleEntry {
  worldId: string;
  day: number;
  realDate: string;
  season: string;
  year: number;
  threads: ChronicleThread[];
  fullPage: string;
  significantEvents: string[];
  generatedAt: string;
  id?: string;
  title?: string;
  subtitle?: string;
  body?: string;
  createdAt?: string;
  isPrologue?: boolean;
  order?: number;
}

export interface WorldSnapshot {
  tick: number;
  day: number;
  year: number;
  season: string;
  population: number;
  vessel: { beached: boolean; position: { x: number; y: number } };
  agents: AgentSnapshot[];
  conduits: BondedConduitSnapshot[];
  tiles: TileSnapshot[];
  latestSummary?: { worldNow: string } | null;
}
