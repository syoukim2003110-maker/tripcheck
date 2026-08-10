export type RatingPrior = {
  /** C: the rating a venue is assumed to have before any review is read. */
  priorMean: number;
  /** m: how many reviews the venue needs before its own average outweighs the prior. */
  priorWeight: number;
};

/** Hotels accumulate reviews slowly, so the prior holds on longer. */
export const hotelRatingPrior: RatingPrior = { priorMean: 3.9, priorWeight: 300 };
/** Restaurants gather reviews faster; a smaller sample already means something. */
export const restaurantRatingPrior: RatingPrior = { priorMean: 3.9, priorWeight: 150 };

/**
 * IMDB-style Bayesian weighted rating: WR = v/(v+m)·R + m/(v+m)·C.
 *
 * Star rating and review count are judged together, never separately: a 4.9★
 * average over 8 reviews shrinks toward the prior C, while thousands of
 * reviews let a merely-good average stand on its own. A high average with a
 * thin sample must therefore rank below a normal average with a large sample.
 */
export function bayesianWeightedRating(
  rating: number | null,
  reviewCount: number | null,
  options: RatingPrior = hotelRatingPrior,
): number | null {
  if (rating === null || !Number.isFinite(rating)) return null;
  const { priorMean, priorWeight } = options;
  const volume = Math.max(0, reviewCount ?? 0);
  return (volume / (volume + priorWeight)) * rating + (priorWeight / (volume + priorWeight)) * priorMean;
}
