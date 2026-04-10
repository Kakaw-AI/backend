type PersistedTraceStep = {
  text: string;
  at: string;
};

export function extractLatestTraceSteps(
  traces: Array<{ steps: unknown }> | undefined,
): PersistedTraceStep[] {
  const candidate = traces?.[0]?.steps;
  if (!Array.isArray(candidate)) {
    return [];
  }

  return candidate
    .filter(
      (step): step is PersistedTraceStep =>
        step != null &&
        typeof step === 'object' &&
        typeof (step as { text?: unknown }).text === 'string' &&
        typeof (step as { at?: unknown }).at === 'string',
    )
    .map((step) => ({
      text: step.text,
      at: step.at,
    }));
}

export function buildConversationSteps(steps: PersistedTraceStep[]) {
  return steps.map((step, index) => ({
    seq: index,
    text: step.text,
    done: true,
  }));
}
