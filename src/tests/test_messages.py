"""Tests for messaging endpoints."""


def auth_header(token):
    """Create an Authorization header dict for JWT."""
    return {'Authorization': f'Bearer {token}'}


class TestMessages:
    """Message sending and retrieval tests."""

    def test_send_message_success(self, client, registered_user, second_user):
        """Sending a valid message should return 200."""
        response = client.post('/send_message', json={
            'receiver_id': second_user['id'],
            'text': 'Hello, how are you?',
        }, headers=auth_header(registered_user['token']))
        assert response.status_code == 200
        assert response.get_json()['message'] == 'Message sent'

    def test_send_message_without_token(self, client):
        """Sending a message without a token should return 401."""
        response = client.post('/send_message', json={
            'receiver_id': 1,
            'text': 'Hello',
        })
        assert response.status_code == 401

    def test_send_message_no_receiver(self, client, registered_user):
        """Sending a message without a receiver should return 400."""
        response = client.post('/send_message', json={
            'text': 'Hello',
        }, headers=auth_header(registered_user['token']))
        assert response.status_code == 400
        assert 'receiver_id' in response.get_json()['message'].lower()

    def test_send_message_empty_text(self, client, registered_user, second_user):
        """Sending an empty message should return 400."""
        response = client.post('/send_message', json={
            'receiver_id': second_user['id'],
            'text': '',
        }, headers=auth_header(registered_user['token']))
        assert response.status_code == 400
        assert 'required' in response.get_json()['message'].lower()

    def test_send_message_too_long(self, client, registered_user, second_user):
        """Sending a message over 500 chars should return 400."""
        response = client.post('/send_message', json={
            'receiver_id': second_user['id'],
            'text': 'A' * 501,
        }, headers=auth_header(registered_user['token']))
        assert response.status_code == 400
        assert '500' in response.get_json()['message']

    def test_get_messages(self, client, registered_user, second_user):
        """Getting messages between two users should return them in order."""
        # Send a couple of messages
        client.post('/send_message', json={
            'receiver_id': second_user['id'], 'text': 'First message',
        }, headers=auth_header(registered_user['token']))
        client.post('/send_message', json={
            'receiver_id': registered_user['id'], 'text': 'Second message',
        }, headers=auth_header(second_user['token']))

        # Get messages
        response = client.get(
            f'/get_messages?partner_id={second_user["id"]}',
            headers=auth_header(registered_user['token'])
        )
        assert response.status_code == 200
        data = response.get_json()
        assert 'messages' in data
        assert len(data['messages']) == 2
        assert data['messages'][0]['text'] == 'First message'
        assert data['messages'][1]['text'] == 'Second message'

    def test_get_messages_no_partner(self, client, registered_user):
        """Getting messages without a partner_id should return 400."""
        response = client.get(
            '/get_messages',
            headers=auth_header(registered_user['token'])
        )
        assert response.status_code == 400

    def test_get_messages_without_token(self, client):
        """Getting messages without a token should return 401."""
        response = client.get('/get_messages?partner_id=1')
        assert response.status_code == 401