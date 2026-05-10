export const EVENT_STATUS_LABELS = {
  DRAFT: '草稿',
  PUBLISHED: '已發布',
  CANCELLED: '已取消'
};

export const SESSION_STATUS_LABELS = {
  REGISTRATION_OPEN: '報名開放中',
  REGISTRATION_CLOSED: '報名已截止',
  LOTTERY_RUNNING: '抽籤進行中',
  LOTTERY_COMPLETED: '抽籤已完成',
  FINALIZED: '已定案',
  ONGOING: '進行中',
  CLOSED: '已結束'
};

export const REGISTRATION_STATUS_LABELS = {
  REGISTERED: '已報名',
  CANCELLED: '已取消',
  IN_LOTTERY: '抽籤中',
  WON: '中籤待確認',
  LOST: '未中籤',
  WAITLISTED: '候補中',
  CONFIRMED: '已確認',
  FORFEITED: '已棄權',
  EXPIRED: '已逾期',
  USED: '已使用'
};

export const TICKET_STATUS_LABELS = {
  ISSUED: '已發行',
  USED: '已使用',
  REVOKED: '已撤銷'
};

export const ROLE_LABELS = {
  EMPLOYEE: '員工',
  ADMIN: '管理員',
  ADMIN_VIEWER: '管理員（唯讀）',
  VERIFIER: '驗票員'
};

export const NOTIFICATION_TYPE_LABELS = {
  REGISTRATION_CONFIRMED: '報名成功',
  LOTTERY_WON: '恭喜中籤',
  LOTTERY_LOST: '未中籤',
  WAITLISTED: '候補通知',
  WAITLIST_PROMOTED: '候補遞補成功',
  CONFIRMATION_REMINDER: '確認提醒',
  CONFIRMATION_EXPIRED: '確認逾期',
  EVENT_CANCELLED: '活動取消',
  EVENT_REMINDER: '活動提醒'
};

export const labelOr = (map, key, fallback) => {
  if (!key) return fallback;
  return map?.[key] || fallback || String(key);
};

