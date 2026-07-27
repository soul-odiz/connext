"""Tests for profile and preferences endpoints."""


def auth_header(token):
    """Create an Authorization header dict for JWT."""
    return {'Authorization': f'Bearer {token}'}


class TestProfile:
    """Profile update and retrieval tests."""

    def test_update_profile_success(self, client, registered_user):
        """Updating profile with valid data should return 200."""
        response = client.post('/update_profile', json={
            'bio': 'Updated bio!',
            'age': 26,
            'city': 'Haifa',
        }, headers=auth_header(registered_user['token']))
        assert response.status_code == 200
        data = response.get_json()
        assert data['message'] == 'Profile updated successfully'
        assert data['updatedUser']['bio'] == 'Updated bio!'
        assert data['updatedUser']['age'] == 26
        assert data['updatedUser']['city'] == 'Haifa'

    def test_update_profile_without_token(self, client):
        """Updating profile without a token should return 401."""
        response = client.post('/update_profile', json={'bio': 'test'})
        assert response.status_code == 401

    def test_update_profile_username_taken(self, client, registered_user, second_user):
        """Updating to an existing username should return 400."""
        response = client.post('/update_profile', json={
            'username': second_user['username'],
        }, headers=auth_header(registered_user['token']))
        assert response.status_code == 400
        assert 'already exists' in response.get_json()['message'].lower()

    def test_update_profile_short_username(self, client, registered_user):
        """Updating to a too-short username should return 400."""
        response = client.post('/update_profile', json={
            'username': 'ab',
        }, headers=auth_header(registered_user['token']))
        assert response.status_code == 400
        assert '3 characters' in response.get_json()['message']

    def test_update_preferences_success(self, client, registered_user):
        """Updating preferences should return 200."""
        response = client.post('/update_preferences', json={
            'preferred_age_range': {'min': 22, 'max': 40},
            'preferred_gender': 'female',
        }, headers=auth_header(registered_user['token']))
        assert response.status_code == 200
        assert response.get_json()['message'] == 'Preferences updated successfully'

    def test_update_preferences_without_token(self, client):
        """Updating preferences without a token should return 401."""
        response = client.post('/update_preferences', json={
            'preferred_age_range': {'min': 20, 'max': 35},
        })
        assert response.status_code == 401

    def test_get_user_profile(self, client, registered_user, second_user):
        """Getting a user's public profile should return their info."""
        response = client.get(
            f'/api/user_profile/{second_user["id"]}',
            headers=auth_header(registered_user['token'])
        )
        assert response.status_code == 200
        data = response.get_json()
        assert data['username'] == second_user['username']
        assert data['age'] == 28
        assert 'password_hash' not in data  # Should not expose password

    def test_get_nonexistent_user_profile(self, client, registered_user):
        """Getting a non-existent user's profile should return 404."""
        response = client.get(
            '/api/user_profile/99999',
            headers=auth_header(registered_user['token'])
        )
        assert response.status_code == 404

    def test_update_profile_interests_as_list(self, client, registered_user):
        """Interests should be accepted as a JSON list."""
        response = client.post('/update_profile', json={
            'interests': ['coding', 'gaming', 'music'],
        }, headers=auth_header(registered_user['token']))
        assert response.status_code == 200
        data = response.get_json()
        assert 'coding' in data['updatedUser']['interests']
        assert 'gaming' in data['updatedUser']['interests']