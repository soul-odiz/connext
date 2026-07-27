"""
Pytest fixtures for the Connext Flask application.
Uses a temp file-based SQLite DB for testing (supports pool settings).
"""
import os
import sys
import tempfile
import pytest

# Ensure src is on path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

# Create a temporary file for the test database
_db_fd, _db_path = tempfile.mkstemp(suffix='.db')
_db_uri = f'sqlite:///{_db_path}'
# Close the OS handle immediately. SQLAlchemy opens its own connection and
# Windows will otherwise keep the temporary file locked during teardown.
os.close(_db_fd)

# Set test env vars BEFORE importing app module
os.environ.setdefault('SECRET_KEY', 'test-secret-key-for-pytest-only')
os.environ.setdefault('JWT_SECRET_KEY', 'test-jwt-secret-for-pytest-only')
os.environ.setdefault('FLASK_ENV', 'testing')
os.environ.setdefault('LOG_LEVEL', 'ERROR')
os.environ.setdefault('SOCKETIO_ASYNC_MODE', 'threading')
os.environ['DATABASE_URL'] = _db_uri

# Import the app module - module-level code runs with test DB
import app as app_module
from app import app, db, limiter, User, MatchSession, Message, MatchQueue
from app import allowed_file, haversine, generate_session_id


class _FakeLocation:
    latitude = 32.0853
    longitude = 34.7818


class _FakeGeolocator:
    """Deterministic replacement that prevents tests calling Nominatim."""

    def geocode(self, city, timeout=10):
        return _FakeLocation() if city else None


app_module.geolocator = _FakeGeolocator()


@pytest.fixture(scope='session', autouse=True)
def setup():
    """Configure app for testing."""
    app.config['TESTING'] = True
    limiter.enabled = False
    with app.app_context():
        db.create_all()
    yield
    with app.app_context():
        db.drop_all()
        db.session.remove()
        db.engine.dispose()
    if os.path.exists(_db_path):
        os.unlink(_db_path)


@pytest.fixture(scope='function', autouse=True)
def clean_database(setup):
    """Give every test an empty database, even when routes commit.

    Endpoint-level commits cannot be reliably isolated with a nested
    transaction, so deleting rows in reverse foreign-key order is clearer and
    deterministic for this integration suite.
    """
    with app.app_context():
        db.session.rollback()
        for table in reversed(db.metadata.sorted_tables):
            db.session.execute(table.delete())
        db.session.commit()
    yield
    with app.app_context():
        db.session.rollback()


@pytest.fixture(scope='function')
def client():
    """Provide a test client."""
    app.config['TESTING'] = True
    with app.test_client() as client:
        yield client


@pytest.fixture(scope='function')
def app_context():
    """Provide an active application context."""
    with app.app_context():
        yield


def auth_header(token):
    """Create an Authorization header dict for JWT."""
    return {'Authorization': f'Bearer {token}'}


@pytest.fixture(scope='function')
def registered_user(client):
    """Register and return a fully-configured test user."""
    import uuid
    suffix = uuid.uuid4().hex[:6]
    username = f'testuser_{suffix}'
    r = client.post('/register', data={
        'username': username, 'password': 'testpass123', 'age': '25',
        'gender': 'male', 'city': 'Tel Aviv', 'preferredGender': 'female',
        'preferredAgeRange[min]': '20', 'preferredAgeRange[max]': '35',
        'interests': '["music", "travel"]', 'bio': 'Test bio',
    })
    assert r.status_code == 201, f'Registration failed: {r.get_json()}'

    r = client.post('/login', json={'username': username, 'password': 'testpass123'})
    assert r.status_code == 200
    d = r.get_json()
    return {'id': d['user_id'], 'username': d['username'], 'token': d['access_token']}


@pytest.fixture(scope='function')
def second_user(client):
    """Register a second test user."""
    import uuid
    suffix = uuid.uuid4().hex[:6]
    username = f'seconduser_{suffix}'
    r = client.post('/register', data={
        'username': username, 'password': 'testpass456', 'age': '28',
        'gender': 'female', 'city': 'Jerusalem', 'preferredGender': 'male',
        'preferredAgeRange[min]': '22', 'preferredAgeRange[max]': '40',
        'interests': '["reading", "hiking"]', 'bio': 'Second user',
    })
    assert r.status_code == 201

    r = client.post('/login', json={'username': username, 'password': 'testpass456'})
    assert r.status_code == 200
    d = r.get_json()
    return {'id': d['user_id'], 'username': d['username'], 'token': d['access_token']}
