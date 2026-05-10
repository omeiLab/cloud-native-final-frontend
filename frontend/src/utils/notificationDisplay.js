/**
 * 後端可把管理員取消原因放在 payload 多種鍵名；通知本文也可能已內嵌原因。
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

/** 本文是否已含該取消原因（避免重複段落） */
const bodyIncludesReason = (body, reason) => {
  if (!reason || !body) return false;
  return body.includes(reason);
};

/** 給列表／預覽用：是否在 UI 上要再額外顯示「取消原因」區塊 */
export const shouldShowCancellationReasonLine = (item) => {
  if (item?.type !== 'EVENT_CANCELLED') return false;
  const reason = extractCancellationReason(item);
  if (!reason) return false;
  return !bodyIncludesReason(item.body, reason);
};
