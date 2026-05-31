/** Centralized English UI copy for application code (docs remain zh-TW in .md files). */

export const EVENT_STATUS_LABELS = {
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  CANCELLED: 'Cancelled'
};

export const SESSION_STATUS_LABELS = {
  REGISTRATION_OPEN: 'Registration open',
  REGISTRATION_CLOSED: 'Registration closed',
  LOTTERY_RUNNING: 'Lottery running',
  LOTTERY_COMPLETED: 'Lottery completed',
  FINALIZED: 'Finalized',
  ONGOING: 'Ongoing',
  CLOSED: 'Closed'
};

export const REGISTRATION_STATUS_LABELS = {
  REGISTERED: 'Registered',
  CANCELLED: 'Cancelled',
  IN_LOTTERY: 'In lottery',
  WON: 'Won — pending confirmation',
  LOST: 'Not selected',
  WAITLISTED: 'Waitlisted',
  CONFIRMED: 'Confirmed',
  FORFEITED: 'Forfeited',
  EXPIRED: 'Expired',
  USED: 'Used'
};

export const TICKET_STATUS_LABELS = {
  ISSUED: 'Issued',
  USED: 'Used',
  REVOKED: 'Revoked'
};

export const ROLE_LABELS = {
  EMPLOYEE: 'Employee',
  ADMIN: 'Admin',
  ADMIN_VIEWER: 'Admin (read-only)',
  VERIFIER: 'Verifier'
};

export const NOTIFICATION_TYPE_LABELS = {
  REGISTRATION_CONFIRMED: 'Registration confirmed',
  LOTTERY_WON: 'Lottery won',
  LOTTERY_LOST: 'Lottery lost',
  WAITLISTED: 'Waitlisted',
  WAITLIST_PROMOTED: 'Promoted from waitlist',
  CONFIRMATION_REMINDER: 'Confirmation reminder',
  CONFIRMATION_EXPIRED: 'Confirmation expired',
  EVENT_CANCELLED: 'Event cancelled',
  EVENT_REMINDER: 'Event reminder'
};

export const labelOr = (map, key, fallback) => {
  if (!key) return fallback;
  return map?.[key] || fallback || String(key);
};

export const APP_COPY = {
  brandName: 'CETS Events',
  brandTagline: 'TSMC employee event platform',
  footer: 'TSMC CETS Events | Employee event platform',
  signIn: 'Sign in',
  signOut: 'Sign out',
  myTickets: 'My tickets',
  myRegistrations: 'My registrations',
  notifications: 'Notifications',
  adminConsole: 'Admin console',
  verify: 'Verify tickets',
  events: 'Events',
  profile: 'Profile',
  employeeInfo: 'Employee info',
  employeeId: 'Employee ID',
  department: 'Department',
  site: 'Site',
  accountStatus: 'Account status',
  availableTickets: 'Available tickets',
  forfeitTicket: 'Forfeit ticket',
  noTickets: 'No tickets yet',
  noRegistrations: 'No registrations yet',
  loading: 'Loading…',
  openAccountMenu: 'Open account menu'
};
