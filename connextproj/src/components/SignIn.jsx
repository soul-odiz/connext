import React, { useState, useContext, useEffect } from 'react';
import { UserContext } from './UserContext';
import { ApiService } from './ApiService';
import SocialAuth from './SocialAuth';
import closeButtonImage from '../close.jpg';

function SignIn() {
  const { setCurrentUser, setToken } = useContext(UserContext);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [showSignInForm, setShowSignInForm] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [showReset, setShowReset] = useState(false);
  const [resetMessage, setResetMessage] = useState('');

  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('currentUser');
    if (storedToken && storedUser) {
      setToken(storedToken);
      setCurrentUser(JSON.parse(storedUser));
      setShowSignInForm(false);
    }
  }, [setToken, setCurrentUser]);

  const handleLogin = async (username, password) => {
    setIsLoading(true);
    setErrorMessage('');

    try {
      const response = await ApiService.login(username, password);
      setToken(response.data.access_token);
      // Use full user object from backend response (includes all profile fields)
      const user = response.data.user || { username, id: response.data.user_id };
      setCurrentUser(user);

      localStorage.setItem('token', response.data.access_token);
      localStorage.setItem('currentUser', JSON.stringify(user));

      setShowSignInForm(false);
    } catch (error) {
      if (error.response && error.response.data) {
        setErrorMessage(error.response.data.message);
      } else {
        console.error('Error during login:', error);
        setErrorMessage('An error occurred during login.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleShowSignInForm = () => {
    setShowSignInForm(true);
  };

  const handleCloseSignInForm = () => {
    setShowSignInForm(false);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleLogin(username, password);
    }
  };

  const handleSendReset = async () => {
    if (!resetEmail) {
      setResetMessage('Please enter your email address.');
      return;
    }
    setResetMessage('');
    try {
      // Fire-and-forget: Firebase returns 200 even for unknown emails to avoid
      // leaking which accounts exist. Imported lazily to keep the bundle lean.
      const { getAuth, firebaseConfigured } = await import('../firebase');
      const { sendPasswordResetEmail } = await import('firebase/auth');
      if (!firebaseConfigured) {
        setResetMessage('Password reset is not configured yet. Please contact support.');
        return;
      }
      const auth = await getAuth();
      if (!auth) {
        setResetMessage('Password reset is not configured yet. Please contact support.');
        return;
      }
      await sendPasswordResetEmail(auth, resetEmail);
      setResetMessage('If that email is registered, a reset link has been sent.');
    } catch (err) {
      console.error('Password reset error:', err);
      setResetMessage('Could not send a reset link. Please try again.');
    }
  };

  return (
    <div className="signin-container">
      {!showSignInForm && (
        <button onClick={handleShowSignInForm}>Sign In</button>
      )}

      {showSignInForm && (
        <div className="signin-page">
          <button onClick={handleCloseSignInForm} className="close-button">
            <img src={closeButtonImage} alt="Close" />
          </button>
          <h2>Sign In</h2>
          <div className='user-box'>
            <input
              type="text"
              id="user_name"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Username"
            />
            <label htmlFor="user_name">Username</label>
          </div>
          <div className='user-box'>
            <input
              type="password"
              id="pass_word"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Password"
            />
            <label htmlFor="pass_word">Password</label>
            <button type="button" className="forgot-password-link" onClick={() => setShowReset(true)}>
              Forgot your password?
            </button>
          </div>
          {errorMessage && <div className="error-message">{errorMessage}</div>}
          <div className='signin-container-button'>
            <button className='btn-1' onClick={() => handleLogin(username, password)} disabled={isLoading}>
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>
          </div>

          <SocialAuth onSignIn={() => {}} dividerText="or continue with" />

          {/* Password reset */}
          {showReset && (
            <div className="reset-form">
              <h3>Reset Password</h3>
              <div className='user-box'>
                <input
                  type="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  placeholder="Email"
                />
                <label>Email</label>
              </div>
              {resetMessage && <div className="success-message">{resetMessage}</div>}
              <button className="btn-2" onClick={handleSendReset}>Send reset link</button>
              <button type="button" className="link-button" onClick={() => setShowReset(false)}>Back to sign in</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SignIn;