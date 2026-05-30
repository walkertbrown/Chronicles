// shared/types.ts
// Imported by both the simulation engine and the web frontend
// Types only — no logic lives here

// ============================================================
// ENUMS
// ============================================================

export enum Terrain {
  Plain = 'plain',
  Forest = 'forest',
  River = 'river',
  Mountain = 'mountain',
  Coast = 'coast',
  Ruin = 'ruin',
  Vessel = 'vessel',
}

export enum Season {
  Spring = 'spring',
  Summer = 'summer',
  Autumn = 'autumn',
  Winter = 'winter',
}

export enum FoundingRole {
  Explorer = 'explorer',
  Outcast = 'outcast',
  Leader = 'leader',
  Survivor = 'survivor',
}

export enum BondType {
  None = 'none',
  Pair = 'pair',
  Kin = 'kin',
  Rival = 'rival',
}

export enum ItemType {
  Axe = 'axe',
  Flint = 'flint',
  Rope = 'rope',
  Knife = 'knife',
  Spear = 'spear',
}

export enum EventType {
  Death = 'death',
  Birth = 'birth',
  Conflict = 'conflict',
  Resolution = 'resolution',
  Discovery = 'discovery',
  BondFormed = 'bond_formed',
  BondBroken = 'bond_broken',
  CompanionApproach = 'companion_approach',
  CompanionBond = 'companion_bond',
  ArtifactFound = 'artifact_found',
  ArtifactImprinted = 'artifact_imprinted',
  TraitThreshold = 'trait_threshold',
  Migration = 'migration',
  ResourceCrisis = 'resource_crisis',
  IllnessBegan = 'illness_began',
  IllnessRecovered = 'illness_recovered',
}

// ============================================================
// DRIVES
// All values 0.0 to 1.0
// Updated every simulation tick
// Highest drive determines agent action
// ============================================================

export interface Drives {
  hunger: number      // Depletes ~0.002/tick. At 1.0 agent seeks food immediately. Sustained at 1.0 = death.
                      // Above 0.5 hunger begins accelerating fatigue depletion — the two drives compound each other
  fatigue: number     // Base depletion ~0.001/tick. Accelerates when hunger is above 0.5 — a hungry agent tires faster.
                      // High fatigue is a global modifier: reduces action effectiveness, lowers skill success rates,
                      // makes fear spike more easily, dampens trait expression (a fatigued curious agent explores less far),
                      // and slows social drive restoration. Nearly everything the agent does is worse when fatigued.
                      // Sustained at 1.0 with high hunger = death accelerates significantly
  fear: number        // Spikes from threat events. Fades in sustained safety
  socialNeed: number  // Depletes ~0.0005/tick when isolated. Restored by meaningful interaction
  grief: number       // Spikes from loss events. Fades slowly. Never fully disappears same tick it was created
  longing: number     // Builds ~0.0003/tick always. Seeks bonded partner or highest-trust agent
}

// ============================================================
// CHARACTER TRAITS
// All values 0.0 to 1.0
// Change slowly through lived experience
// Most agents stay 0.2–0.7 across their lifetime
// Values above 0.85 are exceptional
// Values above 0.95 cross significance threshold
// ============================================================

export interface Traits {
  curiosity: number   // How far agent explores. Whether they investigate the unknown
  courage: number     // How fear drive resolves. High courage = act despite fear, not feel less fear
  nobility: number    // Whether agent helps others at cost to self. Primary companion bond trigger
  cunning: number     // Whether agent finds indirect solutions. Grows when direct approaches fail
  endurance: number   // How well agent sustains effort under hardship. Grows through prolonged difficulty survived
  attraction: number  // How strongly agent forms pair bonds. Shapes how longing drive is satisfied
  aggression: number  // Multiplier on how drives express when options exist. Not a direct action driver
  acuity: number      // Rate at which agent learns from experience. Mostly inherited. Varies most randomly at birth
}

// ============================================================
// SKILLS
// All values 0.0 to 1.0
// Grow through activity and can be transferred to offspring/nearby agents at reduced rate
// ============================================================

export interface Skills {
  hunting: number     // Success rate finding and catching food from animals
  gathering: number   // Success rate finding plant-based food
  building: number    // Quality and speed of shelter construction
  fire: number        // Ability to start and maintain fire
  healing: number     // Ability to reduce fear/grief/injury effects in self and others
}

// ============================================================
// RELATIONSHIP
// Tracked per agent pair
// ============================================================

export interface Relationship {
  agentId: string
  trust: number           // -1.0 to 1.0. Negative = active hostility
  bond: BondType
  interactionCount: number
  lastInteractionTick: number
}

// ============================================================
// FOUNDING HISTORY
// Generation 0 agents only
// Encodes the crossing into baseline trait modifiers
// ============================================================

export interface FoundingHistory {
  role: FoundingRole
  ledTheCrossing: boolean       // +social drive, +leadership tendency
  nearlyDiedOnCrossing: boolean // +fear or +grief depending on other traits
  choseToLeave: boolean         // true = explorer. false = was driven out
}

// ============================================================
// AGENT
// Core simulation entity
// ============================================================

export interface IllnessState {
  sick: boolean
  severity: number          // 0.0–1.0. At 1.0 contributes to health score decline
  contractedAtTick: number  // tick when illness began
}

export interface Agent {
  id: string
  name: string
  familyName: string
  gender: 'male' | 'female'
  age: number               // In simulated years
  healthScore: number       // 1.0 at spawn for young agents. Declines in old age. Natural death at 0.
  generation: number        // 0 = founding fifty
  alive: boolean

  position: {
    x: number
    y: number
  }

  drives: Drives
  traits: Traits
  skills: Skills
  relationships: Relationship[]

  lineage: {
    motherId: string | null
    fatherId: string | null
    children: string[]
  }

  foundingHistory: FoundingHistory | null   // null for generation 1+

  companionId: string | null                // null until bonded

  significanceScore: number                 // Recalculated every tick
  chronicleThreadActive: boolean
  lastChroniclePageMention: number | null   // Simulated day number

  // Last 20 significant events only — older events dropped
  recentEvents: SimEvent[]

  starvationTick: number | null           // tick when hunger first reached 1.0
  starvationSurvivalTicks: number | null   // ticks survivable at max hunger

  lastAteAtTick: number | null       // null until first eat action
  lastDrankAtTick: number | null     // null until first drink action
  discoveredTileIds: string[]        // tile ids visited by this agent. format: "x_y"
  illnessState: IllnessState | null   // null when healthy
  animalAttackTick: number | null    // tick of last animal attack; null if never attacked
}

// ============================================================
// WORLD TILE
// ============================================================

export interface Resource {
  current: number
  max: number
  regenRate: number   // Per tick. Varies by season
}

export interface Artifact {
  id: string
  discovered: boolean
  imprinted: boolean  // True if companion has imprinted on it
}

export interface WorldTile {
  x: number
  y: number
  terrain: Terrain
  resources: {
    food: Resource
    water: Resource
    material: Resource
  }
  ancientDensity: number    // 0.0–1.0. Higher closer to ruins and source
  artifacts: Artifact[]
  occupants: string[]       // Agent ids currently on this tile
  companionPresent: boolean
}

// ============================================================
// COMPANION BEING
// ============================================================

export interface AgentProximityRecord {
  agentId: string
  totalTicks: number    // How many ticks spent near this agent
  fearSpikes: number    // How many times this agent triggered companion fear
}

export interface CompanionBeing {
  id: string
  position: { x: number; y: number }
  alive: boolean

  drives: {
    curiosity: number   // Draws it toward novel things
    fear: number        // Spikes near threatening agents
    proximity: number   // Pulls toward bonded agent if bonded
  }

  bondedAgentId: string | null
  bondStrength: number              // 0.0–1.0. Builds over time with correct agent

  agentProximityHistory: AgentProximityRecord[]

  heldArtifactId: string | null     // Artifact currently being held/imprinted
}

// ============================================================
// EVENTS
// ============================================================

export interface SimEvent {
  id: string
  tick: number
  day: number
  type: EventType
  involvedAgents: string[]
  location: { x: number; y: number }
  description: string       // Plain language. Facts only — no prose
  narrativeWeight: number   // 0.0–1.0. Used by chronicle packager
  threadRelevant: string[]  // Family names this event matters to
}

// ============================================================
// CHRONICLE
// ============================================================

export interface ChronicleThread {
  familyName: string
  primaryAgentId: string
  prose: string             // Generated by Claude
}

export interface ChronicleEntry {
  worldId: string
  day: number               // Simulated day number
  realDate: string          // ISO timestamp
  season: Season
  year: number              // Simulated year
  threads: ChronicleThread[]
  fullPage: string          // Assembled complete page
  significantEvents: string[] // Event ids that fed this page
  generatedAt: string       // ISO timestamp
}

// ============================================================
// VESSEL
// The founding people's beached ship — starting supplies and items
// ============================================================

export interface Item {
  id: string
  type: ItemType
  condition: number   // 0.0–1.0, degrades with use
}

export interface VesselState {
  id: string
  position: { x: number; y: number }
  integrity: number   // 0–1
  beached: boolean
  resources: {
    food: Resource
    water: Resource
  }
  items: Item[]
  helmsmanId: string
}

// ============================================================
// WORLD SUMMARY
// Generated hourly by Gemini
// ============================================================

export interface WorldSummary {
  worldId: string
  generatedAt: string       // ISO timestamp
  worldNow: string          // 1–2 sentences on current world state
  agentsToWatch: {
    agentId: string
    name: string
    note: string            // One plain sentence
  }[]
  building: string          // One sentence on unresolved tension
}

// ============================================================
// WORLD STATE
// Top-level container — saved to Firestore on checkpoint
// ============================================================

export interface WorldState {
  worldId: string
  seed: number              // Used to regenerate deterministic map
  tick: number              // Total ticks elapsed
  day: number               // Current simulated day
  year: number              // Current simulated year
  season: Season
  ticksInCurrentSeason: number   // resets to 0 each time the season advances
  agents: Agent[]
  tiles: WorldTile[][]      // 2D grid [x][y]
  companion: CompanionBeing
  vessel: VesselState
  eventLog: SimEvent[]      // Last 500 events
  chroniclePages: ChronicleEntry[]   // all generated chronicle pages, newest last
  lastCheckpoint: string    // ISO timestamp
  lastChronicleGeneratedAt: string | null   // real-world ISO timestamp of last chronicle generation. null until first page fires
  lastSummaryGeneratedAt: string | null     // real-world ISO timestamp of last summary generation. null until first summary fires
  latestSummary: WorldSummary | null    // most recent hourly summary; null until first fires
}
