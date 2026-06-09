export * from "./Signal.js";
export * from "./DotLink.js";
export * from "./Constellation.js";
export * from "./ContextCard.js";

/** Canonical names for artifact types, used by tool `consumes`/`produces` metadata. */
export const ARTIFACT_TYPES = {
  Signal: "Signal",
  DotLink: "DotLink",
  Constellation: "Constellation",
  ContextCard: "ContextCard",
  Brief: "Brief",
  RawSourceItem: "RawSourceItem",
} as const;

export type ArtifactType = (typeof ARTIFACT_TYPES)[keyof typeof ARTIFACT_TYPES];
