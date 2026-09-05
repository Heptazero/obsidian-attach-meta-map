function reportFailure(context: string, error: unknown): void {
  console.error(`[Att Meta Map] ${context}`, error);
}

/**
 * Cross a void callback boundary without losing synchronous throws or rejected
 * promises. UI and vault event callbacks use this when the host does not await
 * the work they start.
 */
export function runInBackground(
  task: () => void | Promise<unknown>,
  context: string,
): void {
  try {
    void Promise.resolve(task()).catch(error => reportFailure(context, error));
  } catch (error) {
    reportFailure(context, error);
  }
}
