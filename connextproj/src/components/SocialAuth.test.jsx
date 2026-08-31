import { render, screen } from '@testing-library/react';
import SocialAuth from './SocialAuth';
import { UserContext } from './UserContext';

// Mock the heavy dependencies so the component can be tested in isolation.
jest.mock('./ApiService', () => ({ ApiService: { oauthLogin: jest.fn() } }));
jest.mock('../firebase', () => ({
  firebaseConfigured: false,
  getAuth: jest.fn(),
  getGoogleProvider: jest.fn(),
  getAppleProvider: jest.fn(),
}));

// When Firebase is NOT configured (env empty in tests), SocialAuth must render
// nothing and not throw (graceful degradation). This also proves the module
// doesn't break the SignIn import chain by loading @firebase/auth eagerly.
describe('SocialAuth', () => {
  const renderSocialAuth = () => {
    const setCurrentUser = jest.fn();
    const setToken = jest.fn();
    const result = render(
      <UserContext.Provider value={{ setCurrentUser, setToken }}>
        <SocialAuth />
      </UserContext.Provider>
    );
    return { ...result, setCurrentUser, setToken };
  };

  test('renders nothing when Firebase is not configured', () => {
    const { container } = renderSocialAuth();
    expect(container.firstChild).toBeNull();
  });

  test('does not show Google/Apple buttons without config', () => {
    renderSocialAuth();
    expect(screen.queryByText(/Continue with Google/i)).toBeNull();
    expect(screen.queryByText(/Continue with Apple/i)).toBeNull();
  });
});