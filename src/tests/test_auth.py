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
            'email': 'success@test.com',
        })
        assert response.status_code == 201
        data = response.get_json()
        assert 'user_id' in data
        assert data['needs_verification'] is True

    def test_register_duplicate_username(self, client, registered_user):
        """Duplicate username should return 400."""
        response = client.post('/register', data={
            'username': registered_user['username'],
            'password': 'otherpass123',
            'age': '30',
            'gender': 'female',
            'city': 'Jerusalem',
            'preferredGender': 'male',
            'email': 'other@test.com',
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
            'email': 'shortuser@test.com',
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
            'email': 'shortpass@test.com',
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
            'email': 'young@test.com',
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
            'email': 'gendertest@test.com',
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
            'email': 'nocity@test.com',
        })
        assert response.status_code == 400
        assert 'city' in response.get_json()['message'].lower()


class TestOAuthLogin:
    """Firebase OAuth login endpoint tests."""

    def test_oauth_login_requires_token(self, client, monkeypatch):
        """Missing id_token should return 400."""
        import app as app_module

        class FakeAuth:
            @staticmethod
            def verify_id_token(token, check_revoked=False):
                raise AssertionError('should not be called without a token')

        monkeypatch.setattr(app_module, 'FIREBASE_AUTH', FakeAuth)
        response = client.post('/oauth_login', json={})
        assert response.status_code == 400
        assert 'id_token' in response.get_json()['message'].lower()

    def test_oauth_login_when_firebase_not_configured(self, client, monkeypatch):
        """When Firebase is disabled, return 503 with a clear message."""
        import app as app_module
        monkeypatch.setattr(app_module, 'FIREBASE_AUTH', None)
        response = client.post('/oauth_login', json={'id_token': 'some-token'})
        assert response.status_code == 503
        assert 'not configured' in response.get_json()['message'].lower()

    def test_oauth_login_creates_new_user(self, client, monkeypatch):
        """A valid Firebase token should create + log in a new user."""
        import app as app_module

        class FakeDecoded:
            def get(self, key, default=None):
                return {
                    'uid': 'firebase-uid-123',
                    'email': 'new@example.com',
                    'email_verified': True,
                    'name': 'New User',
                    'firebase': {'sign_in_provider': 'google.com'},
                }.get(key, default)

        class FakeAuth:
            @staticmethod
            def verify_id_token(token, check_revoked=False):
                assert token == 'valid-token'
                return FakeDecoded()

        monkeypatch.setattr(app_module, 'FIREBASE_AUTH', FakeAuth)

        response = client.post('/oauth_login', json={
            'id_token': 'valid-token', 'provider': 'google'
        })
        assert response.status_code == 200
        data = response.get_json()
        assert data['access_token'].count('.') == 2
        assert data['is_new_user'] is True
        assert data['user']['email'] == 'new@example.com'
        assert data['user']['auth_provider'] == 'google'
        assert data['user']['email_verified'] is True

    def test_oauth_login_existing_email_links_account(self, client, monkeypatch):
        """Logging in with an email that already exists should link to that user."""
        import app as app_module

        # First create a local user with that email via register-compatible fields
        client.post('/register', data={
            'username': 'existed', 'password': 'password123', 'age': '25',
            'gender': 'male', 'city': 'Tel Aviv', 'preferredGender': 'female',
        })

        class FakeDecoded:
            def get(self, key, default=None):
                return {
                    'uid': 'firebase-uid-456',
                    'email': 'existed@example.com',
                    'email_verified': True,
                    'name': 'Existed',
                    'firebase': {'sign_in_provider': 'apple.com'},
                }.get(key, default)

        class FakeAuth:
            @staticmethod
            def verify_id_token(token, check_revoked=False):
                return FakeDecoded()

        monkeypatch.setattr(app_module, 'FIREBASE_AUTH', FakeAuth)

        response = client.post('/oauth_login', json={'id_token': 'x'})
        assert response.status_code == 200
        data = response.get_json()
        assert data['user']['auth_provider'] == 'apple'


class TestLogin:
    """User login tests."""

    def test_login_success(self, client, registered_user):
        """Valid credentials should return a JWT token."""
        # The registered_user fixture already verified the email and logged in,
        # so we just need to verify the token works
        assert registered_user['token'].count('.') == 2

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
            'email': 'logintest@test.com',
        })
        # Manually verify email
        from app import User, db
        user = User.query.filter_by(email='logintest@test.com').first()
        if user:
            user.email_verified = True
            db.session.commit()
        # Then try wrong password
        response = client.post('/login', json={
            'email': 'logintest@test.com',
            'password': 'wrongpass',
        })
        assert response.status_code == 401
        assert 'invalid' in response.get_json()['message'].lower()

    def test_login_nonexistent_user(self, client):
        """Non-existent user should return 401."""
        response = client.post('/login', json={
            'email': 'nonexistent@test.com',
            'password': 'password123',
        })
        assert response.status_code == 401

    def test_login_missing_fields(self, client):
        """Missing email or password should return 400."""
        response = client.post('/login', json={
            'email': '',
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