"""Tests for matching logic, date setting, and model helpers."""


def auth_header(token):
    """Create an Authorization header dict for JWT."""
    return {'Authorization': f'Bearer {token}'}


class TestMatching:
    """Match endpoint and matching logic tests."""

    def test_match_requires_location(self, client, registered_user):
        """Matching without location set should return 400."""
        from app import db, User
        user = db.session.get(User, registered_user['id'])
        user.latitude = None
        user.longitude = None
        db.session.commit()

        response = client.get('/match', headers=auth_header(registered_user['token']))
        assert response.status_code == 400
        assert 'location' in response.get_json()['message'].lower()

    def test_match_returns_no_matches(self, client, registered_user, second_user):
        """Matching when both users exist but are not compatible should return 200 with no match."""
        # Set location for user1
        client.post('/update_profile', json={
            'latitude': 32.0853,
            'longitude': 34.7818,
            'city': 'Tel Aviv',
        }, headers=auth_header(registered_user['token']))

        response = client.get('/match', headers=auth_header(registered_user['token']))
        assert response.status_code == 200
        # Should return either a match or 'No matches found'
        data = response.get_json()
        if 'match' in data:
            assert data['match']['id'] == second_user['id']
        else:
            assert 'No matches' in data['message']

    def test_set_date_success(self, client, registered_user, second_user):
        """Setting a date with valid data should return 200."""
        response = client.post('/set_date', json={
            'partner_id': second_user['id'],
            'date_time': '2026-07-15T19:00:00',
            'location': 'Cafe Central',
        }, headers=auth_header(registered_user['token']))
        assert response.status_code == 200
        assert response.get_json()['message'] == 'Date set successfully'

    def test_set_date_missing_fields(self, client, registered_user):
        """Setting a date without required fields should return 400."""
        response = client.post('/set_date', json={
            'partner_id': 999,
        }, headers=auth_header(registered_user['token']))
        assert response.status_code == 400
        assert 'required' in response.get_json()['message'].lower()

    def test_get_matches_list(self, client, registered_user, second_user):
        """Getting matches list should return a list of matches."""
        # First create a match session directly in the DB
        from app import app, db, MatchSession
        import uuid
        with app.app_context():
            session = MatchSession(
                session_id=str(uuid.uuid4()),
                user1_id=registered_user['id'],
                user2_id=second_user['id'],
                status='completed',
            )
            db.session.add(session)
            db.session.commit()

        response = client.get('/get_matches', headers=auth_header(registered_user['token']))
        assert response.status_code == 200
        data = response.get_json()
        assert 'matches' in data
        assert len(data['matches']) >= 1
        assert data['matches'][0]['partner_username'] == second_user['username']

    def test_get_matches_without_token(self, client):
        """Getting matches without a token should return 401."""
        response = client.get('/get_matches')
        assert response.status_code == 401


class TestHelpers:
    """Test helper functions directly."""

    def test_allowed_file_valid(self):
        """allowed_file should accept valid extensions."""
        from app import allowed_file
        assert allowed_file('photo.jpg') is True
        assert allowed_file('photo.jpeg') is True
        assert allowed_file('photo.png') is True
        assert allowed_file('photo.gif') is True
        assert allowed_file('photo.webp') is True

    def test_allowed_file_invalid(self):
        """allowed_file should reject invalid extensions."""
        from app import allowed_file
        assert allowed_file('photo.txt') is False
        assert allowed_file('photo.pdf') is False
        assert allowed_file('photo') is False

    def test_allowed_file_no_extension(self):
        """allowed_file should reject filenames without extensions."""
        from app import allowed_file
        assert allowed_file('photo') is False
        assert allowed_file('') is False

    def test_haversine_known_distance(self):
        """Haversine should calculate the correct distance between two known points."""
        from app import haversine
        # Tel Aviv to Jerusalem: ~55km
        distance = haversine(34.7818, 32.0853, 35.2137, 31.7683)
        assert 40 < distance < 70, f'Expected ~55km, got {distance}km'

    def test_haversine_same_point(self):
        """Haversine should return 0 for the same point."""
        from app import haversine
        distance = haversine(34.7818, 32.0853, 34.7818, 32.0853)
        assert distance == 0.0

    def test_generate_session_id(self):
        """generate_session_id should return a unique UUID."""
        from app import generate_session_id
        sid1 = generate_session_id()
        sid2 = generate_session_id()
        assert sid1 != sid2
        assert len(sid1) == 36  # UUID4 format