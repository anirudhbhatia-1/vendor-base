/** Invalidates responses when the account or selected location changes. */
export function createRequestScope() {
  let generation = 0;
  return {
    invalidate() {
      generation += 1;
    },
    capture() {
      const captured = generation;
      return () => captured === generation;
    },
  };
}
