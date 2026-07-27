"""Tests for health check and readiness endpoints."""


class TestHealthEndpoints:
    """Health check and readiness probe endpoints."""

    def test_health_returns_200(self, client):
        """GET /health should return status healthy."""
        response = client.get('/health')
        assert response.status_code == 200
        data = response.get_json()
        assert data['status'] == 'healthy'
        assert 'timestamp' in data
        assert data['version'] == '1.0.0'

    def test_health_returns_json_content_type(self, client):
        """Health endpoint should return application/json."""
        response = client.get('/health')
        assert response.headers['Content-Type'] == 'application/json'

    def test_readiness_returns_200_when_db_connected(self, client, app_context):
        """GET /ready should return 200 and 'connected' when DB is up."""
        response = client.get('/ready')
        assert response.status_code == 200
        data = response.get_json()
        assert data['status'] == 'ready'
        assert data['database'] == 'connected'

    def test_readiness_has_timestamp(self, client):
        """Readiness response should include an ISO timestamp."""
        response = client.get('/ready')
        data = response.get_json()
        assert 'timestamp' in data
        # Verify it's a valid ISO format string
        assert 'T' in data['timestamp']

    def test_health_cors_headers(self, client):
        """Health endpoint should include CORS headers."""
        response = client.get('/health', headers={'Origin': 'http://localhost:3000'})
        assert 'Access-Control-Allow-Origin' in response.headers

    def test_404_returns_json(self, client):
        """Non-existent route should return JSON, not HTML."""
        response = client.get('/nonexistent-route-xyz')
        assert response.status_code == 404
        data = response.get_json()
        assert 'message' in data
        assert data['message'] == 'Resource not found'