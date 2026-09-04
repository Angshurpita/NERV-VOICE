export function reportLovableError(
  error: Error,
  metadata?: Record<string, unknown>,
) {
  console.error("[Error Capture]", error, metadata);
}
