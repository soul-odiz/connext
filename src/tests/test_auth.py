"""Tests for authentication endpoints (register, login, token validation)."""


class TestRegistration:
    """User registration tests."""

    def test_register_success(self, client):
        """Valid registration should return 201."""
        response = client.post('/register', data={
            'username': 'newuser',
            'password': 'password123',
            'age': '25',
            'gender': 'male',
            'city': 'Tel Aviv',
            'preferredGender': 'female',
            'preferredAgeRange[min]': '20',
            'preferredAgeRange[max]': '35',
            'interests': '["music", "sports"]',
            'bio': 'Hello world',
        })
        assert response.status_code == 201
        data = response.get_json()
        assert data['message'] == 'User created successfully'

    def test_register_duplicate_username(self, client, registered_user):
        """Duplicate username should return 400."""
        response = client.post('/register', data={
            'username': registered_user['username'],
            'password': 'otherpass123',
            'age': '30',
            'gender': 'female',
            'city': 'Jerusalem',
            'preferredGender': 'male',
        })
        assert response.status_code == 400
        data = response.get_json()
        assert 'already exists' in data['message'].lower()

    def test_register_short_username(self, client):
        """Username shorter than 3 characters should return 400."""
        response = client.post('/register', data={
            'username': 'ab',
            'password': 'password123',
            'age': '25',
            'gender': 'male',
            'city': 'Tel Aviv',
            'preferredGender': 'female',
        })
        assert response.status_code == 400
        assert '3 characters' in response.get_json()['message']

    def test_register_short_password(self, client):
        """Password shorter than 6 characters should return 400."""
        response = client.post('/register', data={
            'username': 'validuser',
            'password': '12345',
            'age': '25',
            'gender': 'male',
            'city': 'Tel Aviv',
            'preferredGender': 'female',
        })
        assert response.status_code == 400
        assert '6 characters' in response.get_json()['message']

    def test_register_underage(self, client):
        """Age under 18 should return 400."""
        response = client.post('/register', data={
            'username': 'younguser',
            'password': 'password123',
            'age': '16',
            'gender': 'male',
            'city': 'Tel Aviv',
            'preferredGender': 'female',
        })
        assert response.status_code == 400
        assert '18' in response.get_json()['message']

    def test_register_invalid_gender(self, client):
        """Invalid gender should return 400."""
        response = client.post('/register', data={
            'username': 'gendertest',
            'password': 'password123',
            'age': '25',
            'gender': 'alien',
            'city': 'Tel Aviv',
            'preferredGender': 'female',
        })
        assert response.status_code == 400
        assert 'invalid gender' in response.get_json()['message'].lower()

    def test_register_missing_city(self, client):
        """Missing city should return 400."""
        response = client.post('/register', data={
            'username': 'nocityuser',
            'password': 'password123',
            'age': '25',
            'gender': 'male',
            'preferredGender': 'female',
        })
        assert response.status_code == 400
        assert 'city' in response.get_json()['message'].lower()


class TestLogin:
    """User login tests."""

    def test_login_success(self, client, registered_user):
        """Valid credentials should return a JWT token."""
        response = client.post('/login', json={
            'username': registered_user['username'],
            'password': 'testpass123',
        })
        assert response.status_code == 200
        data = response.get_json()
        assert 'access_token' in data
        assert data['user_id'] == registered_user['id']
        assert data['username'] == registered_user['username']
        # Token should be a JWT (contains two dots)
        assert data['access_token'].count('.') == 2

    def test_login_wrong_password(self, client):
        """Invalid password should return 401."""
        # First register
        client.post('/register', data={
            'username': 'logintest',
            'password': 'correctpass',
            'age': '25',
            'gender': 'male',
            'city': 'Tel Aviv',
            'preferredGender': 'female',
        })
        # Then try wrong password
        response = client.post('/login', json={
            'username': 'logintest',
            'password': 'wrongpass',
        })
        assert response.status_code == 401
        assert 'invalid' in response.get_json()['message'].lower()

    def test_login_nonexistent_user(self, client):
        """Non-existent user should return 401."""
        response = client.post('/login', json={
            'username': 'nonexistent',
            'password': 'password123',
        })
        assert response.status_code == 401

    def test_login_missing_fields(self, client):
        """Missing username or password should return 400."""
        response = client.post('/login', json={
            'username': '',
            'password': '',
        })
        assert response.status_code == 400
        assert 'required' in response.get_json()['message'].lower()


class TestTokenValidation:
    """JWT token validation tests."""

    def test_protected_route_without_token(self, client):
        """Accessing a protected route without a token should return 401."""
        response = client.get('/match')
        assert response.status_code == 401

    def test_protected_route_with_invalid_token(self, client):
        """Invalid JWT token should return 422."""
        response = client.get('/match', headers={
            'Authorization': 'Bearer invalidtoken123'
        })
        assert response.status_code == 422

    def test_protected_route_with_valid_token(self, client, registered_user):
        """Valid JWT token should allow access."""
        response = client.get('/match', headers={
            'Authorization': f'Bearer {registered_user["token"]}'
        })
        # Should get 400 (no location set) or 200 (no matches), but not 401
        assert response.status_code in (200, 400)
        assert response.status_code != 401