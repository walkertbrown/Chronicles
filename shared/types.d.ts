export declare enum Terrain {
    Plain = "plain",
    Forest = "forest",
    River = "river",
    Mountain = "mountain",
    Coast = "coast",
    Ruin = "ruin",
    Vessel = "vessel"
}
export declare enum Season {
    Spring = "spring",
    Summer = "summer",
    Autumn = "autumn",
    Winter = "winter"
}
export declare enum FoundingRole {
    Explorer = "explorer",
    Outcast = "outcast",
    Leader = "leader",
    Survivor = "survivor"
}
export declare enum BondType {
    None = "none",
    Pair = "pair",
    Kin = "kin",
    Rival = "rival"
}
export declare enum ItemType {
    Axe = "axe",
    Flint = "flint",
    Rope = "rope",
    Knife = "knife",
    Spear = "spear"
}
export declare enum EventType {
    Death = "death",
    Birth = "birth",
    Conflict = "conflict",
    Resolution = "resolution",
    Discovery = "discovery",
    BondFormed = "bond_formed",
    BondBroken = "bond_broken",
    CompanionApproach = "companion_approach",
    CompanionBond = "companion_bond",
    ArtifactFound = "artifact_found",
    ArtifactImprinted = "artifact_imprinted",
    TraitThreshold = "trait_threshold",
    Migration = "migration",
    ResourceCrisis = "resource_crisis",
    IllnessBegan = "illness_began",
    IllnessRecovered = "illness_recovered"
}
export interface Drives {
    hunger: number;
    fatigue: number;
    fear: number;
    socialNeed: number;
    grief: number;
    longing: number;
}
export interface Traits {
    curiosity: number;
    courage: number;
    nobility: number;
    cunning: number;
    endurance: number;
    attraction: number;
    aggression: number;
    acuity: number;
}
export interface Skills {
    hunting: number;
    gathering: number;
    building: number;
    fire: number;
    healing: number;
}
export interface Relationship {
    agentId: string;
    trust: number;
    bond: BondType;
    interactionCount: number;
    lastInteractionTick: number;
}
export interface FoundingHistory {
    role: FoundingRole;
    ledTheCrossing: boolean;
    nearlyDiedOnCrossing: boolean;
    choseToLeave: boolean;
}
export interface IllnessState {
    sick: boolean;
    severity: number;
    contractedAtTick: number;
}
export interface Agent {
    id: string;
    name: string;
    familyName: string;
    gender: 'male' | 'female';
    age: number;
    healthScore: number;
    generation: number;
    alive: boolean;
    position: {
        x: number;
        y: number;
    };
    drives: Drives;
    traits: Traits;
    skills: Skills;
    relationships: Relationship[];
    lineage: {
        motherId: string | null;
        fatherId: string | null;
        children: string[];
    };
    foundingHistory: FoundingHistory | null;
    companionId: string | null;
    significanceScore: number;
    chronicleThreadActive: boolean;
    lastChroniclePageMention: number | null;
    recentEvents: SimEvent[];
    starvationTick: number | null;
    starvationSurvivalTicks: number | null;
    lastAteAtTick: number | null;
    lastDrankAtTick: number | null;
    discoveredTileIds: string[];
    illnessState: IllnessState | null;
}
export interface Resource {
    current: number;
    max: number;
    regenRate: number;
}
export interface Artifact {
    id: string;
    discovered: boolean;
    imprinted: boolean;
}
export interface WorldTile {
    x: number;
    y: number;
    terrain: Terrain;
    resources: {
        food: Resource;
        water: Resource;
        material: Resource;
    };
    ancientDensity: number;
    artifacts: Artifact[];
    occupants: string[];
    companionPresent: boolean;
}
export interface AgentProximityRecord {
    agentId: string;
    totalTicks: number;
    fearSpikes: number;
}
export interface CompanionBeing {
    id: string;
    position: {
        x: number;
        y: number;
    };
    alive: boolean;
    drives: {
        curiosity: number;
        fear: number;
        proximity: number;
    };
    bondedAgentId: string | null;
    bondStrength: number;
    agentProximityHistory: AgentProximityRecord[];
    heldArtifactId: string | null;
}
export interface SimEvent {
    id: string;
    tick: number;
    day: number;
    type: EventType;
    involvedAgents: string[];
    location: {
        x: number;
        y: number;
    };
    description: string;
    narrativeWeight: number;
    threadRelevant: string[];
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
    season: Season;
    year: number;
    threads: ChronicleThread[];
    fullPage: string;
    significantEvents: string[];
    generatedAt: string;
}
export interface Item {
    id: string;
    type: ItemType;
    condition: number;
}
export interface VesselState {
    id: string;
    position: {
        x: number;
        y: number;
    };
    integrity: number;
    beached: boolean;
    resources: {
        food: Resource;
        water: Resource;
    };
    items: Item[];
    helmsmanId: string;
}
export interface WorldSummary {
    worldId: string;
    generatedAt: string;
    worldNow: string;
    agentsToWatch: {
        agentId: string;
        name: string;
        note: string;
    }[];
    building: string;
}
export interface WorldState {
    worldId: string;
    seed: number;
    tick: number;
    day: number;
    year: number;
    season: Season;
    ticksInCurrentSeason: number;
    agents: Agent[];
    tiles: WorldTile[][];
    companion: CompanionBeing;
    vessel: VesselState;
    eventLog: SimEvent[];
    lastCheckpoint: string;
}
//# sourceMappingURL=types.d.ts.map