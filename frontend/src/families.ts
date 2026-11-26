/** Platforms whose pages use the games family's look (the backend's family "games"). Known up front, from the URL,
 *  so a games page opens on the right default period without waiting for the platform's details to load. */
export const GAME_PLATFORMS = ["steam", "epic", "playstation", "allgames"];

/** The period a platform's pages open on: lifetime for games (their past is lifetime totals and achievements;
 *  a calendar period is often empty), this year for everything else. */
export function defaultRange(platform: string | undefined): string {
  return platform && GAME_PLATFORMS.includes(platform) ? "all" : "this_year";
}
