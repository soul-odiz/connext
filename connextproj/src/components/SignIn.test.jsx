import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SignIn from './SignIn';
import { UserContext } from './UserContext';
import { ApiService } from './ApiService';

jest.mock('./ApiService', () => ({
  ApiService: { login: jest.fn() },
}));

const renderSignIn = () => {
  const setCurrentUser = jest.fn();
  const setToken = jest.fn();
  render(
    <UserContext.Provider value={{ setCurrentUser, setToken }}>
      <SignIn />
    </UserContext.Provider>
  );
  return { setCurrentUser, setToken };
};

describe('SignIn', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  test('logs in, updates context, and persists the session', async () => {
    ApiService.login.mockResolvedValue({
      data: { access_token: 'jwt-token', user_id: 42 },
    });
    const { setCurrentUser, setToken } = renderSignIn();

    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    fireEvent.change(screen.getByPlaceholderText('Username'), {
      target: { value: 'maor' },
    });
    fireEvent.change(screen.getByPlaceholderText('Password'), {
      target: { value: 'secret123' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign In' })[0]);

    await waitFor(() => {
      expect(ApiService.login).toHaveBeenCalledWith('maor', 'secret123');
      expect(setToken).toHaveBeenCalledWith('jwt-token');
      expect(setCurrentUser).toHaveBeenCalledWith({ username: 'maor', id: 42 });
      expect(localStorage.getItem('token')).toBe('jwt-token');
      expect(JSON.parse(localStorage.getItem('currentUser'))).toEqual({ username: 'maor', id: 42 });
    });
  });

  test('shows the backend error when login fails', async () => {
    ApiService.login.mockRejectedValue({
      response: { data: { message: 'Invalid username or password' } },
    });
    renderSignIn();

    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    fireEvent.change(screen.getByPlaceholderText('Username'), {
      target: { value: 'wrong' },
    });
    fireEvent.change(screen.getByPlaceholderText('Password'), {
      target: { value: 'wrongpass' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign In' })[0]);

    expect(await screen.findByText('Invalid username or password')).toBeInTheDocument();
  });
});