export const PATCH_APPLY_END_EVENT = "patch-apply.end";
export const AGENT_SANDBOX_DIFF_APPLIED_EVENT =
  "agent-session.sandbox-diff-applied";
export const CREATE_FILE_APPLY_END_EVENT = "create-file.apply.end";

export function isClutchWorkspaceEditEvent(
  event: Record<string, unknown>,
): boolean {
  const kind = event.kind;
  if (kind === PATCH_APPLY_END_EVENT) {
    return event.success === true;
  }

  if (kind === AGENT_SANDBOX_DIFF_APPLIED_EVENT) {
    return true;
  }

  if (kind === CREATE_FILE_APPLY_END_EVENT) {
    return event.success === true;
  }

  return false;
}

export function getWorkspaceEditTriggerItemId(
  event: Record<string, unknown>,
): string | undefined {
  if (typeof event.contextItemId === "string") {
    return event.contextItemId;
  }

  if (typeof event.itemId === "string") {
    return event.itemId;
  }

  return undefined;
}
