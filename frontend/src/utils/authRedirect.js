const ROLE_HOME_PATHS = Object.freeze({
  ADMIN: '/admin',
  ADMIN_VIEWER: '/admin',
  VERIFIER: '/verify',
  EMPLOYEE: '/'
});

export const getRoleHomePath = (role) => ROLE_HOME_PATHS[role] || '/';

export const isSafeInternalPath = (path) => (
  typeof path === 'string' &&
  path.startsWith('/') &&
  !path.startsWith('//')
);

const canRoleUseRedirectPath = (role, path) => {
  if (!isSafeInternalPath(path)) {
    return false;
  }

  if (role === 'ADMIN' || role === 'ADMIN_VIEWER') {
    return path === '/admin' || path.startsWith('/admin/');
  }

  if (role === 'VERIFIER') {
    return path === '/verify' || path.startsWith('/verify/');
  }

  if (role === 'EMPLOYEE') {
    return path === '/' ||
      path.startsWith('/events/') ||
      path === '/me' ||
      path.startsWith('/me/') ||
      path === '/notifications' ||
      path.startsWith('/notifications/');
  }

  return false;
};

export const getPostLoginRedirectPath = (user, requestedPath) => {
  const role = user?.role;
  return canRoleUseRedirectPath(role, requestedPath)
    ? requestedPath
    : getRoleHomePath(role);
};
