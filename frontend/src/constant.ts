export const OIDC_STATE_KEY = 'oidc_state';
export const POST_LOGIN_REDIRECT_KEY = 'cets_post_login_redirect';

export const ROLE_LOGIN_OPTIONS = Object.freeze([
  {
    key: 'EMPLOYEE',
    title: '員工',
    description: '瀏覽活動、報名、確認領票',
    email: 'cets-emp1@example.com',
    password: 'CetsTest2026!',
    targetPath: '/'
  },
  {
    key: 'ADMIN',
    title: '管理員',
    description: '建立活動、抽籤、匯出報表',
    email: 'cets-admin@example.com',
    password: 'CetsTest2026!',
    targetPath: '/admin'
  },
  {
    key: 'VERIFIER',
    title: '驗票員',
    description: '現場掃描 QR 並核銷入場',
    email: 'cets-verifier@example.com',
    password: 'CetsTest2026!',
    targetPath: '/verify'
  }
]);
