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
  Caregiver = 'caregiver',
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

export enum StructureType {
  Shelter = 'shelter',   // a hut: anchors the camp and shelters rest
}

// The three kinds of thing the ancient civilization left behind. Their meaning
// stays sealed (legible=false) until the Conduit-as-key / source arc unlocks it;
// for now they are pure, unexplained mystery surfaced in the chronicle.
export enum ArtifactKind {
  Tool = 'tool',     // an ancient implement, made for a hand
  Record = 'record', // inscribed fragments in the dead language
  Relic = 'relic',   // a thing with no word yet in any living tongue
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
  HamletFounded = 'hamlet_founded',   // a family's multi-tick trek ends — a new hamlet is founded
  ResourceCrisis = 'resource_crisis',
  IllnessBegan = 'illness_began',
  IllnessRecovered = 'illness_recovered',
  ConduitSighting = 'conduit_sighting',       // Conduit observed near agents — background chronicle color
  ConduitBondLight = 'conduit_bond_light',    // Light bond formed — major narrative event
  ConduitBondDark = 'conduit_bond_dark',      // Dark bond formed — major narrative event, shifted register
  ConduitBondBroken = 'conduit_bond_broken',  // Bond broken by agent death
  SourceAwakened = 'source_awakened',         // The source opened for the first time (light or dark) — climactic
  SourceShifted = 'source_shifted',           // Control of the source flipped between light and dark
  Conception = 'conception',                  // A pair bond conceives — begins the gestation arc
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
  wanderlust: number  // Builds slowly, scaled by curiosity; discharged by reaching new ground;
                      // gated below survival drives — the pull toward the unknown interior
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
  sociability: number // How strongly the agent seeks company and camps near kin vs. strikes out alone.
                      // Generated skewed-high at birth (most want company; loners are a minority) and is a
                      // stable disposition — it does not drift from experience. Scales isolation distress
                      // (socialNeed/longing) and foraging cohesion. Low = loner, high = gregarious.
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
// INVENTORY
// What an agent carries: raw materials gathered from the land and any
// crafted or salvaged tools. Wood is chopped from forests and spent on
// building shelters (and, later, crafting). `items` is empty until a
// crafting/salvage system fills it.
// ============================================================

export interface Inventory {
  wood: number        // chopped timber on hand, 0–1 scale (one full load fells into a build)
  items: Item[]       // tools carried (Axe, Spear, …); empty until crafting exists
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

  // The agent's camp — the central place it forages around and returns to.
  // Set when the band comes ashore (and inherited by children born into the
  // camp). The camp drifts toward sustained foraging, so a band settles, works
  // the land, and moves on when it's spent rather than wandering endlessly.
  // Gregarious agents cling to it; loners barely heed it and roam.
  home: {
    x: number
    y: number
  }

  drives: Drives
  traits: Traits
  skills: Skills
  inventory: Inventory      // what the agent carries — chopped wood, tools
  relationships: Relationship[]

  lineage: {
    motherId: string | null
    fatherId: string | null
    children: string[]
  }

  foundingHistory: FoundingHistory | null   // null for generation 1+

  conduitId: string | null                  // null until bonded to a Conduit
  conduitBondType: 'light' | 'dark' | null  // null until bonded; set at bond formation

  currentAction: string | null              // plain-English description of this tick's action. null until first tick.

  significanceScore: number                 // Recalculated every tick
  chronicleThreadActive: boolean            // a LEAD thread (full chronicle treatment)
  // Contested-supersession state. A non-lead who out-ranks the weakest lead
  // builds chronicleChallenge (0→1); while contending they appear as a cameo,
  // and at 1.0 they take a lead slot. A lead they displace gets chronicleFade=1,
  // which decays over time and earns them recurring cameos so the reader is
  // eased away from them rather than abandoned. Both default 0.
  chronicleChallenge: number                // 0–1 momentum toward seizing a lead slot
  chronicleFade: number                     // 0–1 lingering presence of a superseded former lead
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
  lastViolenceTick: number | null    // tick of last wound taken in conflict; null if never wounded
  lastAttackerId: string | null      // id of the agent who last wounded this agent; null if never wounded
  pregnancy: {
    fatherId: string
    fatherName: string
    conceivedTick: number
  } | null                           // null when not pregnant; set at conception, cleared at delivery

  // Present only while this agent is mid-trek relocating to a new hamlet (see
  // simulation/agents/migration.ts) — absent/null for everyone else, the same
  // lazy-optional pattern as home/inventory. destX/destY are the target tile;
  // bestDist/stuckTicks track trek progress for the stuck-timeout bailout.
  migration?: {
    destX: number
    destY: number
    bestDist: number
    stuckTicks: number
  } | null
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
  // Optional so artifacts persisted before this existed still load; new ones
  // (and any the chronicle features) always carry them.
  kind?: ArtifactKind     // tool / record / relic
  descriptor?: string     // the evocative SURFACE — what it looks like, never what it means
  legible?: boolean       // false until a bond/the source makes its meaning readable
}

// A built structure occupying a tile. Raised by depositing chopped wood; rides
// along with its tile through the dirty-tile checkpoint. progress < 1 means it's
// still going up; once complete it anchors the camp and shelters rest nearby.
export interface Structure {
  type: StructureType
  progress: number       // 0–1 construction progress
  woodInvested: number   // total timber deposited (0–1 scale; sums carry-loads)
  builderIds: string[]   // agents who contributed — for chronicle/significance
  fireFuel: number       // 0–1 hearth fuel; >0 = a fire burns. Decays each tick; fed with wood.
}

export interface WorldTile {
  x: number
  y: number
  terrain: Terrain
  resources: {
    food: Resource
    water: Resource
    material: Resource
    game: Resource          // Local prey/animal population. Hunted down, breeds back slowly.
    wood: Resource          // Standing timber. Concentrated in forests; chopped for building. Regrows slowly.
  }
  ancientDensity: number    // 0.0–1.0. Higher closer to ruins and source
  artifacts: Artifact[]
  occupants: string[]       // Agent ids currently on this tile
  conduitIds: string[]      // Conduit ids currently on this tile (replaces companionPresent)
  structure: Structure | null  // a hut or other built thing on this tile; null if none
}

// ============================================================
// CONDUIT BEINGS
// 75 fixed beings. Do not reproduce. Do not die.
// Untracked unless bonded — no position in frontend until bond forms.
// ============================================================

export interface AgentProximityRecord {
  agentId: string
  totalTicks: number    // How many ticks spent near this Conduit
  fearSpikes: number    // How many times this agent triggered Conduit fear
}

export type ConduitBondType = 'light' | 'dark'

export interface ConduitBeing {
  id: string            // 'conduit_0' through 'conduit_74'
  position: { x: number; y: number }

  drives: {
    curiosity: number   // Draws it toward humans and novel things
    fear: number        // Spikes near threatening agents
    proximity: number   // Pulls toward bonded agent if bonded
  }

  bondedAgentId: string | null
  bondType: ConduitBondType | null    // null until bonded; set at bond formation
  bondStrength: number                // 0.0–1.0. Builds over time once bonded

  agentProximityHistory: AgentProximityRecord[]

  heldArtifactId: string | null       // Artifact currently being imprinted

  // Sighting tracking — feeds chronicle background color
  sightingCount: number               // Total times logged as a sighting event
  lastSightingTick: number | null     // Tick of most recent sighting log
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
  id?: string
  title?: string
  subtitle?: string
  body?: string
  createdAt?: string
  isPrologue?: boolean
  order?: number
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
// TILE CACHE
// Sparse map of only visited/modified tiles.
// Unvisited tiles are generated on demand from seed in tileCache.ts.
// TileCacheData is the serializable form used for Firestore checkpoints.
// ============================================================

export interface TileCacheData {
  seed: number
  dirtyTiles: Record<string, WorldTile>   // key is "x_y", only modified tiles
}

// TileCache is implemented as a class in simulation/world/tileCache.ts.
// This interface describes its public contract so shared/types.ts stays logic-free.
export interface TileCache {
  readonly seed: number
  get(x: number, y: number): WorldTile
  getIfCached(x: number, y: number): WorldTile | undefined
  set(x: number, y: number, tile: WorldTile): void
  isDirty(x: number, y: number): boolean
  getDirtyTiles(): Map<string, WorldTile>
  serialize(): TileCacheData
}

// ============================================================
// WORLD STATE
// Top-level container — saved to Firestore on checkpoint
// ============================================================

// THE SOURCE
// The device the ascended Unbound built, beyond the ruins. A single fixed
// location, disguised as ordinary ruin until it opens. `control` is a needle:
// dragged toward +1 by light-bonded souls present near it (opens to the Unbound —
// a flourishing that breeds its own shadow) and toward -1 by dark-bonded souls
// (opens to the old gods the founders fled — tyranny spreads). 0 = dormant. The
// contest never settles; it is the world's central conflict engine.
export interface Source {
  position: { x: number; y: number }
  control: number   // -1 (old gods / dark) … 0 (dormant) … +1 (Unbound / light)
  // Tick at which |control| first reached 0.9 on the current streak, or null if
  // control isn't currently pinned near an extreme. Reset to null the moment
  // |control| drops back below 0.9. Lets other systems ask "how long has one
  // side been dominant?" (state.tick - extremeSinceTick) — see tickSource() in
  // simulation/source/source.ts and the rival-pull bonus in
  // simulation/companions/being.ts's checkBondEligibility(). null on a fresh
  // world and on any checkpoint written before this field existed (backfilled
  // on restore in simulation/index.ts).
  extremeSinceTick: number | null
}

export interface WorldState {
  worldId: string
  seed: number              // Used to regenerate deterministic map
  tick: number              // Total ticks elapsed
  day: number               // Current simulated day
  year: number              // Current simulated year
  season: Season
  ticksInCurrentSeason: number   // resets to 0 each time the season advances
  agents: Agent[]
  tiles: TileCache          // Sparse on-demand tile cache. See simulation/world/tileCache.ts
  conduits: ConduitBeing[]  // All 75 Conduit beings. Positions tracked always; frontend only receives bonded ones.
  source: Source            // The contested device beyond the ruins. See Source above.
  vessel: VesselState
  eventLog: SimEvent[]      // Last 500 events
  chroniclePages: ChronicleEntry[]   // all generated chronicle pages, newest last
  lastCheckpoint: string    // ISO timestamp
  lastChronicleDay: number  // simulated day of the most recently generated chronicle; -1 until the first fires. Guards against re-chronicling a day that's replayed after a checkpoint restore.
  lastChronicleGeneratedAt: string | null   // real-world ISO timestamp of last chronicle generation. null until first page fires
  lastSummaryGeneratedAt: string | null     // real-world ISO timestamp of last summary generation. null until first summary fires
  latestSummary: WorldSummary | null    // most recent hourly summary; null until first fires
}
