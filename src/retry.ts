export async function retryRead<T>(
  operation: () => Promise<T>,
  onRetry: (attempt: number) => void,
  wait: () => Promise<void>,
  maxFailures = 5,
): Promise<T> {
  let failures = 0;
  while (true) {
    try {
      return await operation();
    } catch {
      failures++;
      if (failures >= maxFailures) {
        throw Error("Could not reach Studio Next to check this transaction. Its hash is saved; retry tracking before submitting again.");
      }
      onRetry(failures);
      await wait();
    }
  }
}
