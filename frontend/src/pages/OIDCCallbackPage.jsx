import React, { useEffect, useRef, useState } from 'react';
import { Alert, Card, Spin, Typography } from 'antd';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { POST_LOGIN_REDIRECT_KEY } from '../constant';
import { getPostLoginRedirectPath } from '../utils/authRedirect';

const { Paragraph } = Typography;

const OIDCCallbackPage = () => {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { finishOIDCLogin } = useAuth();
  const [error, setError] = useState('');
  const callbackStartedRef = useRef(false);

  useEffect(() => {
    if (callbackStartedRef.current) {
      return;
    }

    const code = search.get('code');
    const state = search.get('state');

    if (!code || !state) {
      setError('Missing OIDC callback parameters code/state.');
      return;
    }

    callbackStartedRef.current = true;
    finishOIDCLogin({ code, state })
      .then((loggedInUser) => {
        const redirectPath = sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY);
        sessionStorage.removeItem(POST_LOGIN_REDIRECT_KEY);
        navigate(getPostLoginRedirectPath(loggedInUser, redirectPath), { replace: true });
      })
      .catch((e) => {
        setError(e?.error?.message || e?.message || 'OIDC sign-in failed. Please sign in again.');
      });
  }, [search, finishOIDCLogin, navigate]);

  return (
    <div className="page-wrap centered-page">
      <Card>
        {error ? (
          <Alert type="error" message="Sign-in failed" description={error} />
        ) : (
          <div style={{ textAlign: 'center' }}>
            <Spin size="large" />
            <Paragraph style={{ marginTop: 16 }}>Completing sign-in, please wait…</Paragraph>
          </div>
        )}
      </Card>
    </div>
  );
};

export default OIDCCallbackPage;
