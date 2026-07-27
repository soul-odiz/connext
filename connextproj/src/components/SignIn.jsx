import React, { useState, useContext, useEffect } from 'react';
import { UserContext } from './UserContext';
import { ApiService } from './ApiService';
import closeButtonImage from '../close.jpg';

function SignIn() {
  const { setCurrentUser, setToken } = useContext(UserContext);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [showSignInForm, setShowSignInForm] = useState(false);

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
      const user = { username, id: response.data.user_id };
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
          </div>
          {errorMessage && <div className="error-message">{errorMessage}</div>}
          <div className='signin-container-button'>
            <button className='btn-1' onClick={() => handleLogin(username, password)} disabled={isLoading}>
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default SignIn;