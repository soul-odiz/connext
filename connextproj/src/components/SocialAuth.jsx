import React, { useContext, useState } from 'react';
import { firebaseConfigured, getAuth, getGoogleProvider, getAppleProvider } from '../firebase';
import { ApiService } from './ApiService';
import { UserContext } from './UserContext';

/**
 * Official Google "G" logo (four-brand colors).
 * Self-contained SVG — no external requests needed.
 */
const GoogleIcon = () => (
  <svg className="social-brand-icon" viewBox="0 0 48 48" aria-hidden="true">
    <path
      fill="#EA4335"
      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
    />
    <path
      fill="#4285F4"
      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
    />
    <path
      fill="#FBBC05"
      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
    />
    <path
      fill="#34A853"
      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
    />
  </svg>
);

/**
 * Official Apple logo (silhouette). Self-contained SVG.
 */
const AppleIcon = () => (
  <svg className="social-brand-icon" viewBox="0 0 384 512" aria-hidden="true">
    <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/>
  </svg>
);

/**
 * "Continue with Google / Apple" buttons.
 * Falls back to a subtle disabled hint when Firebase isn't configured so the
 * rest of the app still works normally.
 */
const SocialAuth = ({ onSignIn, dividerText = 'or sign up with' }) => {
  const { setCurrentUser, setToken } = useContext(UserContext);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!firebaseConfigured) {
    return null;
  }

  const completeLogin = (data) => {
    const user = data?.user;
    setToken(data.access_token);
    setCurrentUser(user);
    localStorage.setItem('token', data.access_token);
    localStorage.setItem('currentUser', JSON.stringify(user));
    if (onSignIn) onSignIn(data);
  };

  const handleProvider = async (getProviderFn, providerName) => {
    setLoading(true);
    setError('');
    try {
      const [auth, provider] = await Promise.all([getAuth(), getProviderFn()]);
      if (!auth || !provider) {
        setError('Authentication is not configured.');
        return;
      }
      const fa = await import('firebase/auth');
      const result = await fa.signInWithPopup(auth, provider);
      const idToken = await result.user.getIdToken();
      const res = await ApiService.oauthLogin(idToken, providerName);
      completeLogin(res.data);
    } catch (err) {
      console.error(`[SocialAuth] ${providerName} sign-in failed:`, err);
      if (err?.code === 'auth/account-exists-with-different-credential') {
        setError('An account already exists with the same email. Please sign in using the original method.');
      } else if (err?.response?.data?.message) {
        setError(err.response.data.message);
      } else if (err?.message) {
        setError(err.message);
      } else {
        setError('Social sign-in failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="social-auth">
      <div className="social-divider">
        <span>{dividerText}</span>
      </div>
      <button
        type="button"
        className="social-btn google-btn"
        onClick={() => handleProvider(getGoogleProvider, 'google')}
        disabled={loading}
      >
        <GoogleIcon />
        <span className="social-btn-label">Continue with Google</span>
      </button>
      <button
        type="button"
        className="social-btn apple-btn"
        onClick={() => handleProvider(getAppleProvider, 'apple')}
        disabled={loading}
      >
        <AppleIcon />
        <span className="social-btn-label">Continue with Apple</span>
      </button>
      {loading && <div className="social-loading">Signing you in…</div>}
      {error && <div className="error-message">{error}</div>}
    </div>
  );
};

export default SocialAuth;