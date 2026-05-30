// shared/types.ts
// Imported by both the simulation engine and the web frontend
// Types only — no logic lives here
// ============================================================
// ENUMS
// ============================================================
export var Terrain;
(function (Terrain) {
    Terrain["Plain"] = "plain";
    Terrain["Forest"] = "forest";
    Terrain["River"] = "river";
    Terrain["Mountain"] = "mountain";
    Terrain["Coast"] = "coast";
    Terrain["Ruin"] = "ruin";
    Terrain["Vessel"] = "vessel";
})(Terrain || (Terrain = {}));
export var Season;
(function (Season) {
    Season["Spring"] = "spring";
    Season["Summer"] = "summer";
    Season["Autumn"] = "autumn";
    Season["Winter"] = "winter";
})(Season || (Season = {}));
export var FoundingRole;
(function (FoundingRole) {
    FoundingRole["Explorer"] = "explorer";
    FoundingRole["Outcast"] = "outcast";
    FoundingRole["Leader"] = "leader";
    FoundingRole["Survivor"] = "survivor";
})(FoundingRole || (FoundingRole = {}));
export var BondType;
(function (BondType) {
    BondType["None"] = "none";
    BondType["Pair"] = "pair";
    BondType["Kin"] = "kin";
    BondType["Rival"] = "rival";
})(BondType || (BondType = {}));
export var ItemType;
(function (ItemType) {
    ItemType["Axe"] = "axe";
    ItemType["Flint"] = "flint";
    ItemType["Rope"] = "rope";
    ItemType["Knife"] = "knife";
    ItemType["Spear"] = "spear";
})(ItemType || (ItemType = {}));
export var EventType;
(function (EventType) {
    EventType["Death"] = "death";
    EventType["Birth"] = "birth";
    EventType["Conflict"] = "conflict";
    EventType["Resolution"] = "resolution";
    EventType["Discovery"] = "discovery";
    EventType["BondFormed"] = "bond_formed";
    EventType["BondBroken"] = "bond_broken";
    EventType["CompanionApproach"] = "companion_approach";
    EventType["CompanionBond"] = "companion_bond";
    EventType["ArtifactFound"] = "artifact_found";
    EventType["ArtifactImprinted"] = "artifact_imprinted";
    EventType["TraitThreshold"] = "trait_threshold";
    EventType["Migration"] = "migration";
    EventType["ResourceCrisis"] = "resource_crisis";
    EventType["IllnessBegan"] = "illness_began";
    EventType["IllnessRecovered"] = "illness_recovered";
})(EventType || (EventType = {}));
//# sourceMappingURL=types.js.map