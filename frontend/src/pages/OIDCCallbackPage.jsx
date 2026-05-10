import React, { useEffect, useState } from 'react';
import { Alert, Card, Spin, Typography } from 'antd';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const { Paragraph } = Typography;

const OIDCCallbackPage = () => {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { finishOIDCLogin } = useAuth();
  const [error, setError] = useState('');

  useEffect(() => {
    const code = search.get('code');
    const state = search.get('state');

    if (!code || !state) {
      setError('缺少 OIDC callback 參數 code/state。');
      return;
    }

    finishOIDCLogin({ code, state })
      .then(() => navigate('/', { replace: true }))
      .catch((e) => {
        setError(e?.error?.message || e?.message || 'OIDC 登入失敗');
      });
  }, [search, finishOIDCLogin, navigate]);

  return (
    <div className="page-wrap centered-page">
      <Card>
        {error ? (
          <Alert type="error" message="登入失敗" description={error} />
        ) : (
          <div style={{ textAlign: 'center' }}>
            <Spin size="large" />
            <Paragraph style={{ marginTop: 16 }}>正在完成登入，請稍候...</Paragraph>
          </div>
        )}
      </Card>
    </div>
  );
};

export default OIDCCallbackPage;
