type WaitForConditionOptions = {
  timeoutMs?: number;
  intervalMs?: number;
};

export async function waitForCondition(
  predicate: () => boolean,
  options: WaitForConditionOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 250;
  const intervalMs = options.intervalMs ?? 5;
  const start = Date.now();

  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }

    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
}
