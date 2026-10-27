const COMMENT_LIMIT = 500;

export function parseTranscriptRating(input: {
  stars: unknown;
  comment?: unknown;
}): { stars: number; comment: string } | null {
  const stars = typeof input.stars === "number" ? input.stars : Number(input.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return null;
  const comment = String(input.comment ?? "").trim().slice(0, COMMENT_LIMIT);
  return { stars, comment };
}
