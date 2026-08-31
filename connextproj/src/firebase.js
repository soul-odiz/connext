// Firebase Auth client configuration.
// Reads all values from env (REACT_APP_FIREBASE_*) so the app works without
// Firebase until you populate them. Social sign-up is disabled until all core
// values are present.
//
// IMPORTANT: This module never statically imports firebase packages. Loading
// @firebase/auth at import time breaks the jsdom test environment (it needs a
// global TextDecoder that jsdom doesn't provide). All Firebase modules are
// loaded lazily via dynamic import() only when a social action is triggered.

export const firebaseConfigured = Boolean(
  process.env.REACT_APP_FIREBASE_API_KEY &&
  process.env.REACT_APP_FIREBASE_AUTH_DOMAIN &&
  process.env.REACT_APP_FIREBASE_PROJECT_ID &&
  process.env.REACT_APP_FIREBASE_APP_ID
);

const _config = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
};

// Resolve the Firebase Auth instance (initializes the app on first use).
let _authPromise = null;
export const getAuth = async () => {
  if (_authPromise) return _authPromise;
  _authPromise = (async () => {
    if (!firebaseConfigured) return null;
    const { initializeApp } = await import('firebase/app');
    const fa = await import('firebase/auth');
    const app = initializeApp(_config);
    return fa.getAuth(app);
  })();
  return _authPromise;
};

export const getGoogleProvider = async () => {
  if (!firebaseConfigured) return null;
  const fa = await import('firebase/auth');
  const provider = new fa.GoogleAuthProvider();
  provider.addScope('email');
  provider.addScope('profile');
  return provider;
};

export const getAppleProvider = async () => {
  if (!firebaseConfigured) return null;
  const fa = await import('firebase/auth');
  const provider = new fa.OAuthProvider('apple.com');
  provider.addScope('email');
  provider.addScope('name');
  return provider;
};