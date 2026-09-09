/**
 * Bounded concurrent worker pool.
 * Accepts an array of async tasks and runs at most `limit` concurrently.
 */
export async function pool<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let idx = 0;

  async function worker(): Promise<void> {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return results;
}
