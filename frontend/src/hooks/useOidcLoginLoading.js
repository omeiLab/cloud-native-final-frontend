import { useCallback, useEffect, useState } from 'react';

/**
 * OIDC login assigns window.location and leaves the page. If the user returns
 * via the back button (bfcache), component loading state may still be true.
 */
export function useOidcLoginLoading(startOIDCLogin, isAuthenticated) {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    const onPageShow = () => {
      if (!isAuthenticated) {
        setLoading(false);
      }
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [isAuthenticated]);

  const runLogin = useCallback(async (options) => {
    setLoading(true);
    try {
      await startOIDCLogin(options);
    } catch (error) {
      setLoading(false);
      throw error;
    }
  }, [startOIDCLogin]);

  return { loginLoading: loading, runLogin };
}
