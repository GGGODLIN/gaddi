export interface IslandBuildRecommendation {
  build: number;
  tag: string | null;
}

// Raise this only in the release AFTER this tag's IPA is confirmed downloadable (CLAUDE.md).
export const RECOMMENDED_ISLAND_BUILD: IslandBuildRecommendation = { build: 4, tag: "v2.1.0" };

export function islandUpdateTag(
  app: { build?: number } | undefined,
  recommended: IslandBuildRecommendation = RECOMMENDED_ISLAND_BUILD,
): string | null {
  if (!app || (app.build ?? 1) >= recommended.build) return null;
  return recommended.tag;
}
