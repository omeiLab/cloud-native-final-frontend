/**
 * Backend may store admin cancellation reasons under several payload keys.
 * Notification body text may already embed the reason.
 */
export const extractCancellationReason = (item) => {
  const payload = item?.payload || {};
  const fromPayload =
    payload.reason ??
    payload.cancel_reason ??
    payload.cancellation_reason ??
    payload.revoke_reason ??
    '';
  if (typeof fromPayload === 'string' && fromPayload.trim()) return fromPayload.trim();
  return '';
};

/** Whether the body already contains the cancellation reason (avoid duplicate blocks). */
const bodyIncludesReason = (body, reason) => {
  if (!reason || !body) return false;
  return body.includes(reason);
};

/** Whether the UI should show an extra cancellation-reason line in list/preview. */
export const shouldShowCancellationReasonLine = (item) => {
  if (item?.type !== 'EVENT_CANCELLED') return false;
  const reason = extractCancellationReason(item);
  if (!reason) return false;
  return !bodyIncludesReason(item.body, reason);
};
