// simulation/agents/outcomes.ts
// Internal outcome types for the tick pipeline.
// actions.ts produces TickOutcome values.
// traits.ts and relationships.ts consume them.
// Never imported by the web frontend.

export enum OutcomeType {
  // Survival actions
  Harvested = 'harvested',         // Agent successfully gathered food from a tile
  Hunted = 'hunted',           // Agent hunted a coastal animal — success or failure
  Fished = 'fished',           // Agent fished from river or coast — success or failure
  DrankWater = 'drank_water',      // Agent drank water from a tile or vessel
  Rested = 'rested',               // Agent rested — fatigue reduced
  AteSomething = 'ate_something',  // Alias for consumed food from vessel stores

  // Movement
  Wandered = 'wandered',           // Agent moved without a specific goal
  Explored = 'explored',           // Agent moved deliberately into unknown territory

  // Fear responses
  Fled = 'fled',                   // Agent moved away from a threat
  StoodGround = 'stood_ground',    // Agent stayed despite fear — courage overcame drive

  // Social
  Interacted = 'interacted',       // Agent had a meaningful exchange with another agent
  Helped = 'helped',               // Agent assisted another at cost to themselves
  Conflicted = 'conflicted',       // Agent entered conflict with another agent
  ConflictResolved = 'conflict_resolved', // Conflict ended — win, loss, or draw

  // Vessel-specific
  Maintained = 'maintained',       // Agent performed vessel maintenance
  Steered = 'steered',             // Helmsman steered the vessel this tick

  // Discovery
  FoundResource = 'found_resource', // Agent found a resource-rich tile for the first time
  FoundRuin = 'found_ruin',         // Agent stepped onto a ruin tile for the first time
  FoundArtifact = 'found_artifact', // Agent discovered an artifact
}

export interface TickOutcome {
  type: OutcomeType

  // Whether the action succeeded fully, partially, or failed
  // Success affects how much trait/relationship change results
  success: boolean
  partial: boolean      // true if the action partially succeeded (e.g. found food but very little)

  // The other agent involved, if any
  involvedAgentId: string | null

  // Context at time of outcome — used to scale trait changes
  fatigueAtTime: number       // 0–1. High fatigue dampens trait gains
  fearAtTime: number          // 0–1. High fear amplifies courage/endurance changes

  // For conflict outcomes specifically
  conflictWon: boolean | null   // null if not a conflict outcome

  // For resource outcomes
  amountGained: number | null   // null if not a resource outcome. 0–1 scale.
}
