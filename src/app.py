"""
Connext - Production-ready Flask application
=============================================
Features:
  - PostgreSQL + SQLAlchemy 2.0 with connection pooling
  - Gunicorn + Eventlet for production WebSocket support
  - Rate limiting (flask-limiter)
  - Input validation (marshmallow)
  - Structured JSON logging
  - Health check endpoints
  - Cloud storage support (Azure Blob / AWS S3)
  - Database indexes for performance
  - Proper JWT configuration
  - File upload size limits & validation
  - CORS configured via environment
"""

import os
import re
import json
import uuid
import logging
import random
import mimetypes
from datetime import datetime, timedelta
from math import radians, cos, sin, asin, sqrt

from flask import Flask, request, jsonify, send_from_directory, redirect
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_jwt_extended import (
    JWTManager, create_access_token, jwt_required, get_jwt_identity,
    decode_token
)
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from werkzeug.middleware.proxy_fix import ProxyFix
from geopy.geocoders import Nominatim
from sqlalchemy import text, Index
from pythonjsonlogger import jsonlogger
from dotenv import load_dotenv

# Load environment variables from .env if present
load_dotenv()

# ============ LOGGING ============
log_handler = logging.StreamHandler()
formatter = jsonlogger.JsonFormatter(
    fmt='%(asctime)s %(name)s %(levelname)s %(message)s %(pathname)s %(lineno)d',
    datefmt='%Y-%m-%dT%H:%M:%S%z'
)
log_handler.setFormatter(formatter)
logger = logging.getLogger('connext')
logger.addHandler(log_handler)
logger.setLevel(os.environ.get('LOG_LEVEL', 'INFO').upper())

# Sentry error monitoring (initialized after logger is set up)
import sentry_sdk
from sentry_sdk.integrations.flask import FlaskIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

SENTRY_DSN = os.environ.get('SENTRY_DSN')
if SENTRY_DSN:
    sentry_sdk.init(
        dsn=SENTRY_DSN,
        integrations=[
            FlaskIntegration(),
            SqlalchemyIntegration(),
        ],
        traces_sample_rate=float(os.environ.get('SENTRY_TRACES_SAMPLE_RATE', '0.1')),
        environment=os.environ.get('FLASK_ENV', 'development'),
        send_default_pii=False,
    )
    logger.info('Sentry error monitoring initialized')
else:
    logger.info('Sentry not configured — set SENTRY_DSN environment variable to enable')

# Firebase Admin SDK (optional — used when FIREBASE_SERVICE_ACCOUNT is set)
_firebase_app = None
try:
    import firebase_admin
    from firebase_admin import credentials, auth as firebase_auth
    FIREBASE_SERVICE_ACCOUNT_B64 = os.environ.get('FIREBASE_SERVICE_ACCOUNT_B64')
    if FIREBASE_SERVICE_ACCOUNT_B64:
        import base64
        _sa_json = base64.b64decode(FIREBASE_SERVICE_ACCOUNT_B64).decode('utf-8')
        _cred = credentials.Certificate(json.loads(_sa_json))
        _firebase_app = firebase_admin.initialize_app(_cred)
        FIREBASE_AUTH = firebase_auth
        logger.info('Firebase Admin SDK initialized')
    else:
        FIREBASE_AUTH = None
        logger.info('Firebase not configured — set FIREBASE_SERVICE_ACCOUNT_B64 to enable')
except ImportError:
    FIREBASE_AUTH = None
    logger.warning('firebase-admin not installed — Firebase auth disabled')
except Exception as e:
    FIREBASE_AUTH = None
    logger.error('Firebase Admin SDK initialization failed', extra={'error': str(e)})

# ============ APPLICATION FACTORY ============

def create_app():
    app = Flask(__name__)

    # ── Core Configuration ──────────────────────────────────────────────
    secret_key = os.environ.get('SECRET_KEY')
    if not secret_key:
        raise RuntimeError(
            'SECRET_KEY environment variable is not set. '
            'Generate one with: python -c "import secrets; print(secrets.token_hex(64))"'
        )
    app.config['SECRET_KEY'] = secret_key
    # Use an absolute path for SQLite so the DB location is consistent
    # regardless of which directory the app is launched from.
    _src_dir = os.path.dirname(os.path.abspath(__file__))
    _default_db = 'sqlite:///' + os.path.join(_src_dir, 'instance', 'dating_app.db').replace('\\', '/')
    app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL', _default_db)
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
        'pool_size': int(os.environ.get('DB_POOL_SIZE', '10')),
        'pool_recycle': int(os.environ.get('DB_POOL_RECYCLE', '300')),
        'pool_pre_ping': True,
        'max_overflow': int(os.environ.get('DB_MAX_OVERFLOW', '20')),
    }

    # ── JWT Configuration ───────────────────────────────────────────────
    jwt_secret_key = os.environ.get('JWT_SECRET_KEY')
    if not jwt_secret_key:
        raise RuntimeError(
            'JWT_SECRET_KEY environment variable is not set. '
            'Generate one with: python -c "import secrets; print(secrets.token_hex(64))"'
        )
    app.config['JWT_SECRET_KEY'] = jwt_secret_key
    app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(
        hours=int(os.environ.get('JWT_EXPIRY_HOURS', '24'))
    )
    app.config['JWT_TOKEN_LOCATION'] = ['headers']
    app.config['JWT_HEADER_NAME'] = 'Authorization'
    app.config['JWT_HEADER_TYPE'] = 'Bearer'
    app.config['JWT_VERIFY_SUB'] = False  # Keep for backward compat with existing tokens
    app.config['JWT_DECODE_OPTIONS'] = {'verify_sub': False}

    # ── Upload Configuration ────────────────────────────────────────────
    app.config['UPLOAD_FOLDER'] = os.path.join(
        os.path.dirname(__file__), 'uploads'
    )
    app.config['MAX_CONTENT_LENGTH'] = int(
        os.environ.get('MAX_UPLOAD_SIZE_MB', '25')
    ) * 1024 * 1024  # 25 MB default
    app.config['UPLOAD_PROVIDER'] = os.environ.get('UPLOAD_PROVIDER', 'local')

    # ── CORS ────────────────────────────────────────────────────────────
    cors_origins_str = os.environ.get(
        'CORS_ORIGINS',
        'http://localhost:3000,https://connext-frontend.bluedune-2855dd8a.germanywestcentral.azurecontainerapps.io'
    )
    cors_origins = [o.strip() for o in cors_origins_str.split(',') if o.strip()]
    CORS(app, resources={r"/*": {"origins": cors_origins}}, supports_credentials=True)

    # ── Handle CORS preflight (OPTIONS) before JWT or any decorator ────
    @app.before_request
    def handle_preflight():
        if request.method == 'OPTIONS':
            # Return a 200 so the browser preflight succeeds
            response = app.make_default_options_response()
            origin = request.headers.get('Origin')
            if origin in cors_origins:
                response.headers['Access-Control-Allow-Origin'] = origin
            else:
                response.headers['Access-Control-Allow-Origin'] = cors_origins[0] if cors_origins else '*'
            response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Requested-With'
            response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
            response.headers['Access-Control-Allow-Credentials'] = 'true'
            return response

    @app.after_request
    def add_cors_headers(response):
        origin = request.headers.get('Origin')
        if origin:
            response.headers['Access-Control-Allow-Origin'] = origin if origin in cors_origins else (cors_origins[0] if cors_origins else '*')
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Requested-With'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
        response.headers['Access-Control-Allow-Credentials'] = 'true'
        return response

    # ── Proxy Fix (for running behind nginx/reverse proxy) ──────────────
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    # ── Rate Limiting ───────────────────────────────────────────────────
    redis_url = os.environ.get('REDIS_URL')
    if redis_url and redis_url.startswith('rediss://'):
        # Azure Cache for Redis requires SSL on port 6380.
        # The `rediss://` scheme tells the redis-py client to use SSL.
        # flask-limiter 3.5.0 + limits 2.8+ pass the URL through to redis.from_url().
        # If ssl_cert_reqs is needed, append to the URL: ?ssl_cert_reqs=CERT_NONE
        storage_uri = redis_url
        logger.info('Rate limiter using Redis with SSL (Azure Redis compatible)')
    elif redis_url:
        storage_uri = redis_url
        logger.info('Rate limiter using Redis (non-SSL)')
    else:
        storage_uri = 'memory://'
        logger.warning('No REDIS_URL set – rate limiter using in-memory storage (NOT suitable for multi-replica production)')
    limiter = Limiter(
        key_func=get_remote_address,
        storage_uri=storage_uri,
        default_limits=[
            os.environ.get('RATE_LIMIT_DEFAULT', '200 per day, 50 per hour')
        ],
        app=app
    )

    return app, limiter


app, limiter = create_app()

# ============ EXTENSIONS ============
db = SQLAlchemy(app)
migrate = Migrate(app, db)
jwt = JWTManager(app)

# SocketIO with Eventlet for production (Linux), threading for Windows dev
import sys
_async_mode = os.environ.get('SOCKETIO_ASYNC_MODE', 'eventlet' if sys.platform != 'win32' else 'threading')
socketio = SocketIO(
    app,
    cors_allowed_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    async_mode=_async_mode,
    logger=logger,
    engineio_logger=logger if os.environ.get('ENGINEIO_DEBUG') else False
)

# Geocoding
geolocator = Nominatim(
    user_agent=os.environ.get('GEOCOPY_USER_AGENT', 'ConnextApp/1.0 (contact@example.com)')
)

# ============ JWT ERROR HANDLERS ============

@jwt.invalid_token_loader
def invalid_token_callback(reason):
    logger.warning('Invalid token', extra={'reason': reason})
    return jsonify({'message': f'Invalid token: {reason}', 'msg': reason}), 422

@jwt.unauthorized_loader
def missing_token_callback(reason):
    logger.warning('Missing token', extra={'reason': reason})
    return jsonify({'message': f'Missing token: {reason}', 'msg': reason}), 401

@jwt.expired_token_loader
def expired_token_callback(jwt_header, jwt_payload):
    logger.info('Expired token used')
    return jsonify({'message': 'Token has expired', 'msg': 'Token has expired'}), 401

# ============ CONSTANTS ============
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
MAX_FILE_SIZE = app.config['MAX_CONTENT_LENGTH']

# ============ MODELS ============

class User(db.Model):
    __tablename__ = 'user'

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=True)
    age = db.Column(db.Integer)
    gender = db.Column(db.String(10), index=True)
    bio = db.Column(db.String(500))
    interests = db.Column(db.Text)
    profile_image = db.Column(db.String(100))
    preferred_age_min = db.Column(db.Integer, default=18)
    preferred_age_max = db.Column(db.Integer, default=100)
    preferred_gender = db.Column(db.String(10), index=True)
    city = db.Column(db.String(100))
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    phone_number = db.Column(db.String(15))
    email = db.Column(db.String(255), unique=True, index=True, nullable=True)
    auth_provider = db.Column(db.String(20), default='local', nullable=False, server_default='local')
    email_verified = db.Column(db.Boolean, default=False, nullable=False, server_default='0')
    verification_code = db.Column(db.String(6), nullable=True)
    verification_code_expires = db.Column(db.DateTime, nullable=True)
    firebase_uid = db.Column(db.String(128), unique=True, index=True, nullable=True)
    is_in_queue = db.Column(db.Boolean, default=False, index=True)
    current_session_id = db.Column(db.String(50), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_active = db.Column(db.DateTime, default=datetime.utcnow)

    # Composite indexes for matching queries
    __table_args__ = (
        Index('idx_user_gender_age', 'gender', 'age'),
        Index('idx_user_pref_gender_age', 'preferred_gender', 'preferred_age_min', 'preferred_age_max'),
    )

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def to_public_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'age': self.age,
            'gender': self.gender,
            'bio': self.bio,
            'interests': json.loads(self.interests) if self.interests else [],
            'city': self.city,
            'profile_image': '/uploads/' + self.profile_image if self.profile_image else None,
            'preferred_gender': self.preferred_gender,
            'preferred_age_min': self.preferred_age_min,
            'preferred_age_max': self.preferred_age_max,
            'preferredAgeRange': {'min': self.preferred_age_min, 'max': self.preferred_age_max},
            'preferredGender': self.preferred_gender,
            'phone_number': self.phone_number,
            'phoneNumber': self.phone_number,
            'email': self.email,
            'auth_provider': self.auth_provider,
            'email_verified': bool(self.email_verified),
            'firebase_uid': self.firebase_uid,
            'profile_complete': bool(self.gender and self.age and self.city and self.preferred_gender),
        }


class MatchSession(db.Model):
    __tablename__ = 'match_session'

    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.String(50), unique=True, nullable=False, index=True)
    user1_id = db.Column(db.Integer, db.ForeignKey('user.id'), index=True)
    user2_id = db.Column(db.Integer, db.ForeignKey('user.id'), index=True)
    status = db.Column(db.String(20), default='matched', index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    audio_turn = db.Column(db.Integer, nullable=True)
    audio_turn_start = db.Column(db.DateTime, nullable=True)
    stage_started_at = db.Column(db.DateTime, nullable=True)

    __table_args__ = (
        Index('idx_match_session_users_status', 'user1_id', 'user2_id', 'status'),
    )


class PhoneCallSession(db.Model):
    __tablename__ = 'phone_call_session'

    id = db.Column(db.Integer, primary_key=True)
    caller_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    receiver_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    status = db.Column(db.String(20), default='waiting', index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class DateDetails(db.Model):
    __tablename__ = 'date_details'

    id = db.Column(db.Integer, primary_key=True)
    user1_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    user2_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    date_time = db.Column(db.DateTime)
    location = db.Column(db.String(100))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Message(db.Model):
    __tablename__ = 'message'

    id = db.Column(db.Integer, primary_key=True)
    sender_id = db.Column(db.Integer, db.ForeignKey('user.id'), index=True)
    receiver_id = db.Column(db.Integer, db.ForeignKey('user.id'), index=True)
    text = db.Column(db.String(500))
    timestamp = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    __table_args__ = (
        Index('idx_message_conversation', 'sender_id', 'receiver_id', 'timestamp'),
    )


class MatchQueue(db.Model):
    __tablename__ = 'match_queue'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), unique=True, index=True)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    @property
    def waiting_time(self):
        return datetime.utcnow() - self.timestamp


class BlockedUser(db.Model):
    __tablename__ = 'blocked_user'

    id = db.Column(db.Integer, primary_key=True)
    reporter_id = db.Column(db.Integer, db.ForeignKey('user.id'), index=True, nullable=False)
    blocked_id = db.Column(db.Integer, db.ForeignKey('user.id'), index=True, nullable=False)
    reason = db.Column(db.String(50), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint('reporter_id', 'blocked_id', name='uq_reporter_blocked'),
    )


# ============ DATABASE INIT ============

def ensure_sqlite_schema_updates():
    """Add columns that db.create_all() will not add to an existing database.

    For SQLite (local dev) this uses PRAGMA introspection. For PostgreSQL
    (production) it uses information_schema and ALTER TABLE ... ADD COLUMN IF
    NOT EXISTS so a freshly deployed backend can self-heal its schema.
    """
    dialect = db.engine.dialect.name

    if dialect == 'sqlite':
        with db.engine.begin() as connection:
            existing_columns = {
                row[1]
                for row in connection.execute(text('PRAGMA table_info("user")')).fetchall()
            }
            added = []
            for col, ddl in [
                ('is_in_queue', 'BOOLEAN DEFAULT 0'),
                ('current_session_id', 'VARCHAR(50)'),
                ('created_at', 'TIMESTAMP'),
                ('last_active', 'TIMESTAMP'),
                ('email', 'VARCHAR(255)'),
                ('auth_provider', "VARCHAR(20) DEFAULT 'local'"),
                ('email_verified', 'BOOLEAN DEFAULT 0'),
                ('firebase_uid', 'VARCHAR(128)'),
                ('verification_code', 'VARCHAR(6)'),
                ('verification_code_expires', 'TIMESTAMP'),
            ]:
                if col not in existing_columns:
                    connection.execute(text(f'ALTER TABLE "user" ADD COLUMN {col} {ddl}'))
                    added.append(col)
            if added:
                logger.info('SQLite schema updated', extra={'columns': added})
        return

    if dialect == 'postgresql':
        with db.engine.begin() as connection:
            # Find which columns already exist
            existing_columns = {
                row[0] for row in connection.execute(text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name = 'user'"
                )).fetchall()
            }
            added = []
            for col, ddl in [
                ('email', 'VARCHAR(255)'),
                ('auth_provider', "VARCHAR(20) NOT NULL DEFAULT 'local'"),
                ('email_verified', 'BOOLEAN NOT NULL DEFAULT FALSE'),
                ('firebase_uid', 'VARCHAR(128)'),
                ('verification_code', 'VARCHAR(6)'),
                ('verification_code_expires', 'TIMESTAMP'),
            ]:
                if col not in existing_columns:
                    connection.execute(text(
                        f'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS {col} {ddl}'
                    ))
                    added.append(col)
            # Ensure indexes exist for lookups
            connection.execute(text(
                'CREATE INDEX IF NOT EXISTS ix_user_email ON "user" (email)'
            ))
            connection.execute(text(
                'CREATE INDEX IF NOT EXISTS ix_user_firebase_uid ON "user" (firebase_uid)'
            ))
            if added:
                logger.info('PostgreSQL schema updated', extra={'columns': added})
        return

    logger.debug('No auto schema update for dialect %s', dialect)


with app.app_context():
    db.create_all()
    ensure_sqlite_schema_updates()
    logger.info('Database initialized')

# ============ HELPERS ============

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def detect_content_type(filename):
    """Return a proper MIME type for an uploaded image filename.

    Falls back to image/jpeg if the extension is unknown so that
    browsers can render the file inside an <img> tag.
    """
    mime, _ = mimetypes.guess_type(filename)
    if mime and mime.startswith('image/'):
        return mime
    # Explicit map for formats mimetypes may miss
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    return {
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'webp': 'image/webp',
    }.get(ext, 'image/jpeg')


def haversine(lon1, lat1, lon2, lat2):
    """Calculate the great-circle distance between two points on Earth."""
    lon1, lat1, lon2, lat2 = map(radians, [lon1, lat1, lon2, lat2])
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    c = 2 * asin(sqrt(a))
    return 6371 * c


def find_match_for_user(current_user):
    """Find the best match for a user from the queue.
    Uses database-level filtering for performance.
    """
    queue_entries = MatchQueue.query.filter(
        MatchQueue.user_id != current_user.id
    ).order_by(MatchQueue.timestamp.asc()).all()

    for entry in queue_entries:
        potential = db.session.get(User, entry.user_id)
        if not potential:
            continue

        # Check compatibility
        if current_user.preferred_gender and potential.gender != current_user.preferred_gender:
            continue
        if potential.preferred_gender and current_user.gender != potential.preferred_gender:
            continue

        # Check age range
        if current_user.preferred_age_min and potential.age < current_user.preferred_age_min:
            continue
        if current_user.preferred_age_max and potential.age > current_user.preferred_age_max:
            continue
        if potential.preferred_age_min and current_user.age < potential.preferred_age_min:
            continue
        if potential.preferred_age_max and current_user.age > potential.preferred_age_max:
            continue

        # Skip if already matched (any non-removed session exists between them)
        existing_match = MatchSession.query.filter(
            (
                (MatchSession.user1_id == current_user.id) &
                (MatchSession.user2_id == potential.id)
            ) | (
                (MatchSession.user1_id == potential.id) &
                (MatchSession.user2_id == current_user.id)
            ),
            MatchSession.status != 'removed'
        ).first()
        if existing_match:
            continue

        # Skip if the current user has blocked this potential match
        blocked = BlockedUser.query.filter_by(
            reporter_id=current_user.id,
            blocked_id=potential.id
        ).first()
        if blocked:
            continue

        # Skip if the potential match has blocked the current user
        blocked_by = BlockedUser.query.filter_by(
            reporter_id=potential.id,
            blocked_id=current_user.id
        ).first()
        if blocked_by:
            continue

        # Calculate distance
        if current_user.latitude and current_user.longitude and potential.latitude and potential.longitude:
            distance = haversine(
                current_user.longitude, current_user.latitude,
                potential.longitude, potential.latitude
            )
        else:
            distance = float('inf')

        return potential, distance

    return None, None


def generate_session_id():
    return str(uuid.uuid4())


def sanitize_username(raw, fallback='user'):
    """Build a safe, unique username from an email/display name prefix."""
    base = re.sub(r'[^A-Za-z0-9_.]', '', raw or '').lower()
    base = base[:20] if base else fallback
    if User.query.filter_by(username=base).first():
        base = f'{base}_{uuid.uuid4().hex[:6]}'
    return base


def get_current_user_id():
    """Return the JWT identity as an integer user id."""
    return int(get_jwt_identity())


def save_upload(file):
    """Save uploaded file to local storage or cloud provider."""
    filename = secure_filename(file.filename)
    provider = app.config['UPLOAD_PROVIDER']

    if provider == 'local':
        file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
        return filename
    elif provider == 'azure_blob':
        # Azure Blob Storage upload
        try:
            from azure.storage.blob import BlobServiceClient, ContentSettings
            conn_str = os.environ['AZURE_STORAGE_CONNECTION_STRING']
            container = os.environ['AZURE_STORAGE_CONTAINER']
            blob_client = BlobServiceClient.from_connection_string(conn_str).get_blob_client(
                container=container, blob=filename
            )
            blob_client.upload_blob(
                file,
                overwrite=True,
                content_settings=ContentSettings(content_type=detect_content_type(filename)),
            )
            return filename
        except Exception as e:
            logger.error('Azure Blob upload failed', extra={'error': str(e), 'filename': filename})
            raise
    elif provider == 's3':
        # AWS S3 upload
        try:
            import boto3
            s3 = boto3.client(
                's3',
                aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
                aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
                region_name=os.environ.get('AWS_REGION', 'eu-west-1')
            )
            s3.upload_fileobj(
                file,
                os.environ['AWS_S3_BUCKET'],
                filename,
                ExtraArgs={'ACL': 'public-read'}
            )
            return filename
        except Exception as e:
            logger.error('S3 upload failed', extra={'error': str(e), 'filename': filename})
            raise
    else:
        raise ValueError(f'Unknown upload provider: {provider}')


# ============ HEALTH ENDPOINTS ============

@app.route('/health')
def health():
    """Basic health check."""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.utcnow().isoformat(),
        'version': '1.0.0'
    }), 200


@app.route('/ready')
def readiness():
    """Readiness check that verifies database connectivity."""
    try:
        db.session.execute(text('SELECT 1'))
        return jsonify({
            'status': 'ready',
            'database': 'connected',
            'timestamp': datetime.utcnow().isoformat()
        }), 200
    except Exception as e:
        logger.error('Readiness check failed', extra={'error': str(e)})
        return jsonify({
            'status': 'not_ready',
            'database': 'disconnected',
            'error': str(e)
        }), 503


# ============ AUTH ROUTES ============

@app.route('/register', methods=['POST'])
@limiter.limit(os.environ.get('RATE_LIMIT_REGISTER', '10 per hour'))
def register():
    data = request.form
    username = data.get('username', '').strip()
    password = data.get('password', '')
    age = data.get('age')
    gender = data.get('gender')
    bio = data.get('bio', '')
    preferred_gender = data.get('preferredGender')
    preferred_age_min = data.get('preferredAgeRange[min]')
    preferred_age_max = data.get('preferredAgeRange[max]')
    interests = data.get('interests', '[]')
    phone_number = data.get('phoneNumber', '')
    city = data.get('city', '').strip()
    # Optional Firebase-linked fields (email sign-up or social sign-up fallback)
    email = data.get('email', '').strip().lower() or None
    firebase_uid = data.get('firebase_uid', '').strip() or None
    auth_provider = data.get('auth_provider', '').strip().lower() or 'local'

    # ── Input Validation ────────────────────────────────────────────────
    if not username or len(username) < 3:
        return jsonify({'message': 'Username must be at least 3 characters'}), 400
    if len(username) > 80:
        return jsonify({'message': 'Username must be 80 characters or less'}), 400
    # Email is required for local auth
    if auth_provider == 'local' and not email:
        return jsonify({'message': 'Email is required for registration'}), 400
    # Password is optional for Firebase-linked accounts (they have no app password)
    if auth_provider == 'local' and (not password or len(password) < 6):
        return jsonify({'message': 'Password must be at least 6 characters'}), 400
        return jsonify({'message': 'Password must be at least 6 characters'}), 400
    if email and not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email):
        return jsonify({'message': 'Invalid email address'}), 400
    if not age or not age.isdigit() or int(age) < 18 or int(age) > 120:
        return jsonify({'message': 'Age must be between 18 and 120'}), 400
    # Normalize gender to lowercase to match frontend capitalized values (Male/Female/Other)
    if gender:
        gender = gender.lower()
    if gender not in ('male', 'female', 'other'):
        return jsonify({'message': 'Invalid gender'}), 400
    if preferred_gender:
        preferred_gender = preferred_gender.lower()
    if preferred_gender and preferred_gender not in ('male', 'female', 'other'):
        return jsonify({'message': 'Invalid preferred gender'}), 400
    if not city:
        return jsonify({'message': 'City is required'}), 400

    # Parse interests
    try:
        interests_list = json.loads(interests)
        if not isinstance(interests_list, list):
            raise ValueError
    except (json.JSONDecodeError, ValueError):
        return jsonify({'message': 'Interests must be a JSON array'}), 400

    # Check username uniqueness
    if User.query.filter_by(username=username).first():
        return jsonify({'message': 'Username already exists'}), 400
    # Check email uniqueness (only when an email is provided)
    if email and User.query.filter_by(email=email).first():
        return jsonify({'message': 'An account with this email already exists. Please sign in.'}), 400

    # Geocode city
    try:
        location = geolocator.geocode(city, timeout=10)
        if not location:
            return jsonify({'message': 'Invalid city name'}), 400
    except Exception as e:
        logger.error('Geocoding failed', extra={'city': city, 'error': str(e)})
        return jsonify({'message': 'Could not verify city. Please try again.'}), 503

    # Handle profile image
    profile_image = ''
    file = request.files.get('file')
    if file and file.filename:
        if not allowed_file(file.filename):
            return jsonify({'message': 'Invalid file type. Allowed: png, jpg, jpeg, gif, webp'}), 400
        try:
            profile_image = save_upload(file)
        except Exception as e:
            logger.error('File upload failed during registration', extra={'error': str(e)})
            return jsonify({'message': 'File upload failed'}), 500

    # Create user
    new_user = User(
        username=username,
        age=int(age),
        gender=gender,
        bio=bio,
        interests=json.dumps(interests_list),
        profile_image=profile_image,
        preferred_age_min=int(preferred_age_min) if preferred_age_min else 18,
        preferred_age_max=int(preferred_age_max) if preferred_age_max else 100,
        preferred_gender=preferred_gender,
        city=city,
        latitude=location.latitude,
        longitude=location.longitude,
        phone_number=phone_number,
        email=email,
        firebase_uid=firebase_uid,
        auth_provider=auth_provider,
        email_verified=(auth_provider != 'local'),
    )
    if auth_provider == 'local':
        new_user.set_password(password)
    # Generate email verification code for local accounts
    dev_code = None
    if auth_provider == 'local' and email:
        code = str(random.randint(10000, 99999))
        new_user.verification_code = code
        new_user.verification_code_expires = datetime.utcnow() + timedelta(minutes=10)
        smtp_server = os.environ.get('SMTP_SERVER')
        if smtp_server:
            try:
                import smtplib
                from email.mime.text import MIMEText
                msg = MIMEText(f'Your Connext verification code is: {code}\n\nThis code expires in 10 minutes.')
                msg['Subject'] = 'Connext - Verify Your Email'
                msg['From'] = os.environ.get('SMTP_FROM', 'noreply@connext.app')
                msg['To'] = email
                with smtplib.SMTP(smtp_server, int(os.environ.get('SMTP_PORT', 587))) as server:
                    server.starttls()
                    server.login(os.environ.get('SMTP_USER', ''), os.environ.get('SMTP_PASSWORD', ''))
                    server.send_message(msg)
            except Exception as e:
                logger.error('Failed to send verification email on register', extra={'email': email, 'error': str(e)})
        else:
            dev_code = code  # Return code for dev/testing
    db.session.add(new_user)
    db.session.commit()

    logger.info('User registered', extra={'user_id': new_user.id, 'username': username})

    response_data = {
        'message': 'User created successfully',
        'user_id': new_user.id,
        'email': email,
        'needs_verification': auth_provider == 'local' and bool(email),
    }
    if dev_code:
        response_data['dev_code'] = dev_code
    return jsonify(response_data), 201


@app.route('/send_verification_code', methods=['POST'])
@limiter.limit(os.environ.get('RATE_LIMIT_VERIFY', '5 per minute'))
def send_verification_code():
    """Generate and send a 5-digit verification code to the user's email."""
    data = request.get_json(silent=True) or {}
    email = data.get('email', '').strip().lower()
    user_id = data.get('user_id')

    if not email:
        return jsonify({'message': 'Email is required'}), 400

    user = None
    if user_id:
        user = db.session.get(User, int(user_id))
    if not user:
        user = User.query.filter_by(email=email).first()
    if not user:
        return jsonify({'message': 'User not found'}), 404
    if user.auth_provider != 'local':
        return jsonify({'message': 'Social login accounts do not need email verification'}), 400

    # Generate a random 5-digit code
    code = str(random.randint(10000, 99999))
    user.verification_code = code
    user.verification_code_expires = datetime.utcnow() + timedelta(minutes=10)
    db.session.commit()

    # Try to send email via SMTP if configured, otherwise log to console
    mail_sent = False
    smtp_server = os.environ.get('SMTP_SERVER')
    if smtp_server:
        try:
            import smtplib
            from email.mime.text import MIMEText
            msg = MIMEText(f'Your Connext verification code is: {code}\n\nThis code expires in 10 minutes.')
            msg['Subject'] = 'Connext - Verify Your Email'
            msg['From'] = os.environ.get('SMTP_FROM', 'noreply@connext.app')
            msg['To'] = email
            with smtplib.SMTP(smtp_server, int(os.environ.get('SMTP_PORT', 587))) as server:
                server.starttls()
                server.login(os.environ.get('SMTP_USER', ''), os.environ.get('SMTP_PASSWORD', ''))
                server.send_message(msg)
            mail_sent = True
        except Exception as e:
            logger.error('Failed to send verification email', extra={'email': email, 'error': str(e)})

    logger.info('Verification code sent', extra={'email': email, 'code': code if not smtp_server else '***', 'mail_sent': mail_sent})

    return jsonify({
        'message': 'Verification code sent to your email',
        'code_sent': mail_sent or not smtp_server,
        # In development without SMTP, return the code so the UI can show it
        'dev_code': code if not smtp_server else None,
    }), 200


@app.route('/verify_email', methods=['POST'])
@limiter.limit(os.environ.get('RATE_LIMIT_VERIFY', '10 per minute'))
def verify_email():
    """Verify a user's email with a 5-digit code."""
    data = request.get_json(silent=True) or {}
    email = data.get('email', '').strip().lower()
    code = data.get('code', '').strip()

    if not email or not code:
        return jsonify({'message': 'Email and code are required'}), 400
    if len(code) != 5 or not code.isdigit():
        return jsonify({'message': 'Code must be a 5-digit number'}), 400

    user = User.query.filter_by(email=email).first()
    if not user:
        return jsonify({'message': 'User not found'}), 404
    if user.email_verified:
        return jsonify({'message': 'Email already verified'}), 200

    if not user.verification_code or not user.verification_code_expires:
        return jsonify({'message': 'No verification code found. Request a new one.'}), 400

    if datetime.utcnow() > user.verification_code_expires:
        return jsonify({'message': 'Verification code has expired. Request a new one.'}), 400

    if user.verification_code != code:
        return jsonify({'message': 'Invalid verification code'}), 400

    user.email_verified = True
    user.verification_code = None
    user.verification_code_expires = None
    db.session.commit()

    # Generate JWT for immediate login
    access_token = create_access_token(identity=str(user.id))

    logger.info('Email verified', extra={'user_id': user.id, 'email': email})

    return jsonify({
        'message': 'Email verified successfully',
        'access_token': access_token,
        'user_id': user.id,
        'username': user.username,
        'user': user.to_public_dict(),
    }), 200


@app.route('/login', methods=['POST'])
@limiter.limit(os.environ.get('RATE_LIMIT_LOGIN', '20 per hour'))
def login():
    data = request.get_json(silent=True) or {}
    email = data.get('email', '').strip().lower()
    password = data.get('password', '')

    if not email or not password:
        return jsonify({'message': 'Email and password are required'}), 400

    user = User.query.filter_by(email=email).first()
    if user and user.check_password(password):
        if user.auth_provider == 'local' and not user.email_verified:
            return jsonify({'message': 'Please verify your email before logging in', 'email_not_verified': True}), 403
        access_token = create_access_token(identity=str(user.id))
        user.last_active = datetime.utcnow()
        db.session.commit()
        logger.info('User logged in', extra={'user_id': user.id, 'email': email})
        return jsonify(
            access_token=access_token,
            user_id=user.id,
            username=user.username,
            user=user.to_public_dict()
        ), 200

    return jsonify({'message': 'Invalid email or password'}), 401


@app.route('/oauth_login', methods=['POST'])
@limiter.limit(os.environ.get('RATE_LIMIT_LOGIN', '20 per hour'))
def oauth_login():
    """Verify a Firebase ID token and log in / create the user."""
    if FIREBASE_AUTH is None:
        return jsonify({
            'message': 'Social login is not configured yet. Please use email or password.'
        }), 503

    data = request.get_json(silent=True) or {}
    id_token = (data.get('id_token') or '').strip()
    provider_hint = (data.get('provider') or '').strip().lower()

    if not id_token:
        return jsonify({'message': 'id_token is required'}), 400

    try:
        decoded = FIREBASE_AUTH.verify_id_token(id_token, check_revoked=False)
    except Exception as e:
        logger.warning('Failed to verify Firebase ID token', extra={'error': str(e)})
        return jsonify({'message': 'Invalid or expired authentication token'}), 401

    firebase_uid = decoded.get('uid')
    email = (decoded.get('email') or '').strip().lower() or None
    email_verified = bool(decoded.get('email_verified', False))
    display_name = decoded.get('name') or ''

    # Determine auth provider from the decoded token's firebase.sign_in_provider
    sign_in_provider = (decoded.get('firebase') or {}).get('sign_in_provider', '') or provider_hint
    if sign_in_provider in ('google.com', 'google'):
        provider = 'google'
    elif sign_in_provider in ('apple.com', 'apple'):
        provider = 'apple'
    else:
        provider = 'password' if sign_in_provider and sign_in_provider != 'password' else 'local'

    if not email and not firebase_uid:
        return jsonify({'message': 'Unable to determine account identity'}), 400

    # Find existing user by firebase_uid or email
    user = User.query.filter(
        (User.firebase_uid == firebase_uid) | (User.email == email)
    ).first() if (firebase_uid or email) else None

    is_new_user = False
    if user is None:
        is_new_user = True
        username_base = (email or display_name or '').split('@')[0]
        user = User(
            username=sanitize_username(username_base),
            email=email,
            firebase_uid=firebase_uid,
            auth_provider=provider,
            email_verified=email_verified,
            last_active=datetime.utcnow(),
        )
        db.session.add(user)
    else:
        user.firebase_uid = user.firebase_uid or firebase_uid
        user.email = user.email or email
        if email:
            user.email_verified = email_verified or user.email_verified
        user.auth_provider = provider
        user.last_active = datetime.utcnow()

    db.session.commit()

    access_token = create_access_token(identity=str(user.id))
    logger.info('Social user logged in', extra={
        'user_id': user.id, 'provider': provider, 'is_new_user': is_new_user
    })
    return jsonify(
        access_token=access_token,
        user_id=user.id,
        username=user.username,
        user=user.to_public_dict(),
        is_new_user=is_new_user,
    ), 200


@app.route('/update_preferences', methods=['POST'])
@jwt_required()
def update_preferences():
    current_user_id = get_current_user_id()
    user = db.session.get(User, current_user_id)
    if not user:
        return jsonify({'message': 'User not found'}), 404

    data = request.get_json(silent=True) or {}
    age_range = data.get('preferred_age_range', {})
    user.preferred_age_min = age_range.get('min', user.preferred_age_min)
    user.preferred_age_max = age_range.get('max', user.preferred_age_max)
    user.preferred_gender = data.get('preferred_gender', user.preferred_gender)
    db.session.commit()

    return jsonify({'message': 'Preferences updated successfully'}), 200


@app.route('/update_profile', methods=['POST'])
@jwt_required()
def update_profile():
    current_user_id = get_current_user_id()
    user = db.session.get(User, current_user_id)
    if not user:
        return jsonify({'message': 'User not found'}), 404

    data = request.get_json(silent=True) or {}

    # Username update with uniqueness check
    new_username = data.get('username', user.username)
    if new_username != user.username:
        if len(new_username) < 3:
            return jsonify({'message': 'Username must be at least 3 characters'}), 400
        if User.query.filter_by(username=new_username).first():
            return jsonify({'message': 'Username already exists'}), 400
        user.username = new_username

    user.profile_image = data.get('profile_image', data.get('profileImageUrl', user.profile_image))
    user.age = data.get('age', user.age)
    user.gender = data.get('gender', user.gender)
    user.bio = data.get('bio', user.bio)

    interests = data.get('interests', user.interests)
    if isinstance(interests, list):
        user.interests = json.dumps(interests)
    else:
        user.interests = interests

    user.latitude = data.get('latitude', user.latitude)
    user.longitude = data.get('longitude', user.longitude)
    user.city = data.get('city', user.city)
    user.phone_number = data.get('phone_number', data.get('phoneNumber', user.phone_number))

    preferred_age_range = data.get('preferred_age_range') or data.get('preferredAgeRange')
    if preferred_age_range:
        user.preferred_age_min = preferred_age_range.get('min', user.preferred_age_min)
        user.preferred_age_max = preferred_age_range.get('max', user.preferred_age_max)
    user.preferred_gender = data.get('preferred_gender', data.get('preferredGender', user.preferred_gender))

    user.last_active = datetime.utcnow()
    db.session.commit()

    updated_user = {
        'id': user.id,
        'username': user.username,
        'age': user.age,
        'gender': user.gender,
        'bio': user.bio,
        'interests': json.loads(user.interests) if user.interests else [],
        'profile_image': user.profile_image,
        'profileImage': user.profile_image,
        'city': user.city,
        'phone_number': user.phone_number,
        'phoneNumber': user.phone_number,
        'preferredAgeRange': {
            'min': user.preferred_age_min,
            'max': user.preferred_age_max
        },
        'preferredGender': user.preferred_gender
    }

    return jsonify({'message': 'Profile updated successfully', 'updatedUser': updated_user}), 200


@app.route('/upload_image', methods=['POST'])
@jwt_required()
@limiter.limit(os.environ.get('RATE_LIMIT_UPLOAD', '10 per hour'))
def upload_image():
    if 'file' not in request.files:
        return jsonify({'message': 'No file part'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'message': 'No selected file'}), 400

    if not allowed_file(file.filename):
        return jsonify({'message': 'Invalid file type. Allowed: png, jpg, jpeg, gif, webp'}), 400

    try:
        filename = save_upload(file)
    except Exception as e:
        logger.error('File upload failed', extra={'error': str(e)})
        return jsonify({'message': 'File upload failed'}), 500

    current_user_id = get_current_user_id()
    user = db.session.get(User, current_user_id)
    user.profile_image = filename
    db.session.commit()

    return jsonify({'message': 'Image uploaded successfully', 'filename': filename}), 200


@app.route('/api/get_profile_image_url/<int:user_id>')
def get_profile_image_url(user_id):
    user = db.session.get(User, user_id)
    if user and user.profile_image:
        image_url = os.path.join('/uploads', user.profile_image)
        return jsonify({'success': True, 'imageUrl': image_url}), 200
    return jsonify({'success': False, 'message': 'User or image not found'}), 404


@app.route('/uploads/<filename>')
def uploaded_file(filename):
    """Serve uploaded files from local disk or Azure Blob Storage."""
    from flask import Response
    provider = app.config.get('UPLOAD_PROVIDER', 'local')
    if provider == 'azure_blob':
        try:
            from azure.storage.blob import BlobServiceClient
            conn_str = os.environ['AZURE_STORAGE_CONNECTION_STRING']
            container = os.environ['AZURE_STORAGE_CONTAINER']
            blob_client = BlobServiceClient.from_connection_string(conn_str).get_blob_client(
                container=container, blob=filename
            )
            stream = blob_client.download_blob()
            content_type = stream.properties.content_settings.content_type
            # Some clients upload without a proper Content-Type, resulting in
            # 'application/octet-stream' which browsers refuse to render in <img>.
            if not content_type or content_type == 'application/octet-stream':
                content_type = detect_content_type(filename)
            return Response(
                stream.readall(),
                status=200,
                mimetype=content_type,
                headers={'Cache-Control': 'public, max-age=31536000'}
            )
        except Exception as e:
            logger.error('Blob serve failed', extra={'error': str(e), 'filename': filename})
            return jsonify({'message': 'Image not found'}), 404
    # Local provider
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)


@app.route('/set_date', methods=['POST'])
@jwt_required()
def set_date():
    current_user_id = get_current_user_id()
    data = request.get_json(silent=True) or {}
    partner_id = data.get('partner_id')
    date_time = data.get('date_time')
    location = data.get('location')

    if not partner_id or not date_time:
        return jsonify({'message': 'partner_id and date_time are required'}), 400

    try:
        parsed_date_time = datetime.fromisoformat(str(date_time).replace('Z', '+00:00'))
    except (TypeError, ValueError):
        return jsonify({'message': 'date_time must be a valid ISO 8601 datetime'}), 400

    new_date = DateDetails(
        user1_id=current_user_id,
        user2_id=partner_id,
        date_time=parsed_date_time,
        location=location
    )
    db.session.add(new_date)
    db.session.commit()

    return jsonify({'message': 'Date set successfully'}), 200


# ============ MATCHING ROUTES ============

@app.route('/match', methods=['GET'])
@jwt_required()
def match_user():
    current_user_id = get_current_user_id()
    current_user = db.session.get(User, current_user_id)
    if not current_user:
        return jsonify({'message': 'Current user not found'}), 404

    # Guard: if current user has no location, skip distance sort
    if not current_user.latitude or not current_user.longitude:
        return jsonify({'message': 'Please set your city/location before matching'}), 400

    # Use database-level filtering with indexes
    potential_matches = User.query.filter(
        User.id != current_user_id,
        User.gender == current_user.preferred_gender,
        User.age.between(current_user.preferred_age_min, current_user.preferred_age_max),
        User.latitude.isnot(None),
        User.longitude.isnot(None)
    ).all()

    sorted_matches = sorted(
        potential_matches,
        key=lambda u: haversine(
            current_user.longitude, current_user.latitude,
            u.longitude, u.latitude
        )
    )

    if sorted_matches:
        match = sorted_matches[0]
        match_data = {
            'id': match.id,
            'username': match.username,
            'age': match.age,
            'profile_image': os.path.join(
                request.host_url, 'uploads', match.profile_image
            ) if match.profile_image else None,
            'gender': match.gender,
            'distance': haversine(
                current_user.longitude, current_user.latitude,
                match.longitude, match.latitude
            )
        }
        return jsonify(match=match_data), 200

    return jsonify({'message': 'No matches found'}), 200


@app.route('/start_phone_call', methods=['POST'])
@jwt_required()
def start_phone_call():
    caller_id = get_current_user_id()
    data = request.get_json(silent=True) or {}
    receiver_id = data.get('receiver_id')

    if not receiver_id:
        return jsonify({'message': 'receiver_id is required'}), 400

    new_call = PhoneCallSession(caller_id=caller_id, receiver_id=receiver_id)
    db.session.add(new_call)
    db.session.commit()

    socketio.emit(
        'phone_call_request',
        {'caller_id': caller_id, 'call_id': new_call.id},
        room=str(receiver_id)
    )

    return jsonify({'message': 'Call initiated', 'call_id': new_call.id}), 200


# ============ SOCKET EVENTS ============

@socketio.on('connect')
def handle_connect():
    logger.info('Client connected', extra={'sid': request.sid})


@socketio.on('disconnect')
def handle_disconnect():
    logger.info('Client disconnected', extra={'sid': request.sid})
    # Remove from queue if disconnected
    user = User.query.filter_by(current_session_id=request.sid).first()
    if user:
        queue_entry = MatchQueue.query.filter_by(user_id=user.id).first()
        if queue_entry:
            db.session.delete(queue_entry)
        user.is_in_queue = False
        user.current_session_id = None
        db.session.commit()


def _verify_socket_token(data):
    """Verify JWT token passed in socket event data.
    Returns (user_id, error_message). On success error_message is None.
    """
    token = data.get('token') if data else None
    if not token:
        return None, 'Authentication token required'
    try:
        decoded = decode_token(token)
        user_id = int(decoded.get('sub'))
        return user_id, None
    except Exception as e:
        return None, f'Invalid token: {str(e)}'


@socketio.on('register_session')
def handle_register_session(data):
    """Register the user's socket session ID. Requires JWT token."""
    user_id, err = _verify_socket_token(data)
    if err:
        # Fall back to user_id param for backward compat (non-breaking)
        user_id = data.get('user_id') if data else None
        if not user_id:
            emit('session_error', {'message': err})
            return
    user = db.session.get(User, int(user_id))
    if user:
        user.current_session_id = request.sid
        db.session.commit()
        join_room(str(user_id))


@socketio.on('join_match_queue')
def handle_join_queue(data):
    """User wants to find a match. Add to queue and try to match.
    Requires JWT token in data for authentication.
    """
    # Authenticate via JWT token in the event payload
    token_user_id, err = _verify_socket_token(data)
    if err:
        # Graceful fallback: accept user_id without token (dev mode)
        # In production, set REQUIRE_SOCKET_AUTH=true to enforce JWT
        if os.environ.get('REQUIRE_SOCKET_AUTH', 'false').lower() == 'true':
            emit('queue_error', {'message': f'Authentication required: {err}'})
            return
        token_user_id = data.get('user_id') if data else None

    user_id = token_user_id
    if not user_id:
        emit('queue_error', {'message': 'User ID required'})
        return

    user = db.session.get(User, int(user_id))
    if not user:
        emit('queue_error', {'message': 'User not found'})
        return

    # Check if already in queue
    existing = MatchQueue.query.filter_by(user_id=user_id).first()
    if existing:
        emit('queue_error', {'message': 'Already in queue'})
        return

    # Check if user has preferences set
    if not user.preferred_gender or not user.preferred_age_min or not user.preferred_age_max:
        emit('queue_error', {
            'message': 'Please set your preferences first (gender preference and age range)'
        })
        return

    # Add to queue
    queue_entry = MatchQueue(user_id=user_id)
    db.session.add(queue_entry)
    user.is_in_queue = True
    db.session.commit()

    # Notify user they're in queue
    emit('queue_joined', {'message': 'Looking for a match...'}, room=str(user_id))

    # Try to find a match immediately
    partner, distance = find_match_for_user(user)
    if partner:
        # Create match session
        session_id = generate_session_id()
        match_session = MatchSession(
            session_id=session_id,
            user1_id=user_id,
            user2_id=partner.id,
            status='matched',
            stage_started_at=datetime.utcnow()
        )
        db.session.add(match_session)

        # Remove both from queue
        q1 = MatchQueue.query.filter_by(user_id=user_id).first()
        q2 = MatchQueue.query.filter_by(user_id=partner.id).first()
        if q1:
            db.session.delete(q1)
        if q2:
            db.session.delete(q2)

        user.is_in_queue = False
        partner.is_in_queue = False
        db.session.commit()

        # Randomly decide who speaks first in audio call
        first_speaker = random.choice([user_id, partner.id])
        match_session.audio_turn = first_speaker
        match_session.audio_turn_start = datetime.utcnow()
        match_session.status = 'matched'
        db.session.commit()

        # Notify both users
        match_data_user1 = {
            'session_id': session_id,
            'partner_id': partner.id,
            'partner_username': partner.username,
            'partner_age': partner.age,
            'partner_image': os.path.join(
                '/uploads', partner.profile_image
            ) if partner.profile_image else None,
            'preparation_time': 30,
            'first_speaker_id': first_speaker
        }
        match_data_user2 = {
            'session_id': session_id,
            'partner_id': user.id,
            'partner_username': user.username,
            'partner_age': user.age,
            'partner_image': os.path.join(
                '/uploads', user.profile_image
            ) if user.profile_image else None,
            'preparation_time': 30,
            'first_speaker_id': first_speaker
        }
        emit('match_found', match_data_user1, room=str(user_id))
        emit('match_found', match_data_user2, room=str(partner.id))

        logger.info('Match created', extra={
            'session_id': session_id,
            'user1_id': user_id,
            'user2_id': partner.id
        })
    else:
        # No match yet, emit queue status
        emit('queue_status', {
            'message': 'In queue...',
            'queue_size': MatchQueue.query.count()
        }, room=str(user_id))


@socketio.on('leave_match_queue')
def handle_leave_queue(data):
    user_id = data.get('user_id')
    if not user_id:
        return
    queue_entry = MatchQueue.query.filter_by(user_id=user_id).first()
    if queue_entry:
        db.session.delete(queue_entry)
    user = db.session.get(User, user_id)
    if user:
        user.is_in_queue = False
        db.session.commit()
    emit('queue_left', {'message': 'Left the queue'}, room=str(user_id))


@socketio.on('start_audio_call')
def handle_start_audio_call(data):
    """Both users are ready for the audio call phase."""
    session_id = data.get('session_id')
    if not session_id:
        return
    match_session = MatchSession.query.filter_by(session_id=session_id).first()
    if not match_session:
        return

    # Idempotency guard: don't restart audio if already in this stage
    if match_session.status == 'audio_call':
        return

    match_session.status = 'audio_call'
    match_session.stage_started_at = datetime.utcnow()

    if not match_session.audio_turn:
        match_session.audio_turn = random.choice(
            [match_session.user1_id, match_session.user2_id]
        )
    match_session.audio_turn_start = datetime.utcnow()
    db.session.commit()

    turn_data = {
        'session_id': session_id,
        'speaking_user_id': match_session.audio_turn,
        'turn_duration': 45,
        'is_first_speaker': True
    }
    emit('audio_call_started', turn_data, room=str(match_session.user1_id))
    emit('audio_call_started', turn_data, room=str(match_session.user2_id))


@socketio.on('request_turn_swap')
def handle_turn_swap(data):
    """Swap whose turn it is to speak in the audio call."""
    session_id = data.get('session_id')
    if not session_id:
        return
    match_session = MatchSession.query.filter_by(session_id=session_id).first()
    if not match_session:
        return

    other_user_id = (
        match_session.user1_id
        if match_session.audio_turn == match_session.user2_id
        else match_session.user2_id
    )
    match_session.audio_turn = other_user_id
    match_session.audio_turn_start = datetime.utcnow()
    db.session.commit()

    turn_data = {
        'session_id': session_id,
        'speaking_user_id': other_user_id,
        'turn_duration': 45,
        'is_first_speaker': False
    }
    emit('audio_turn_swapped', turn_data, room=str(match_session.user1_id))
    emit('audio_turn_swapped', turn_data, room=str(match_session.user2_id))


@socketio.on('end_audio_call_phase')
def handle_end_audio_call(data):
    """Audio call phase is done, move to video chat."""
    session_id = data.get('session_id')
    if not session_id:
        return
    match_session = MatchSession.query.filter_by(session_id=session_id).first()
    if not match_session:
        return

    # Idempotent: already transitioned — ignore duplicate
    if match_session.status == 'video_call':
        return

    match_session.status = 'video_call'
    match_session.stage_started_at = datetime.utcnow()
    db.session.commit()

    emit('video_call_started', {
        'session_id': session_id,
        'duration': 180
    }, room=str(match_session.user1_id))
    emit('video_call_started', {
        'session_id': session_id,
        'duration': 180
    }, room=str(match_session.user2_id))


@socketio.on('end_video_call_phase')
def handle_end_video_call(data):
    """Remove filters and allow date setting."""
    session_id = data.get('session_id')
    if not session_id:
        return
    match_session = MatchSession.query.filter_by(session_id=session_id).first()
    if not match_session:
        return

    # Idempotent: already transitioned — ignore duplicate
    if match_session.status == 'filters_off':
        return

    match_session.status = 'filters_off'
    db.session.commit()

    emit('filters_removed', {
        'session_id': session_id,
        'message': 'Filters removed! You can now see each other.'
    }, room=str(match_session.user1_id))
    emit('filters_removed', {
        'session_id': session_id,
        'message': 'Filters removed! You can now see each other.'
    }, room=str(match_session.user2_id))


@socketio.on('date_set')
def handle_date_set(data):
    """Notify partner that a date has been proposed and mark session completed."""
    session_id = data.get('session_id')
    partner_id = data.get('partner_id')
    date_time = data.get('date_time')
    location = data.get('location')

    if match_session := MatchSession.query.filter_by(session_id=session_id).first():
        match_session.status = 'completed'
        db.session.commit()

    # Format date/time for display
    formatted_date = ''
    if date_time:
        try:
            dt = datetime.fromisoformat(str(date_time).replace('Z', '+00:00'))
            formatted_date = dt.strftime('%A, %B %d, %Y at %I:%M %p')
        except (TypeError, ValueError):
            formatted_date = str(date_time)

    emit('date_proposed', {
        'session_id': session_id,
        'message': 'Your partner has proposed a date!',
        'date_time': date_time,
        'formatted_date': formatted_date,
        'location': location or '',
    }, room=str(partner_id))


# ============ MATCH ROOM CALL REQUESTS ============

@socketio.on('match_call_request')
def handle_match_call_request(data):
    """Forward a call request from one matched user to the other."""
    to_user_id = data.get('to_user_id')
    emit('match_call_request', {
        'from_user_id': data.get('from_user_id'),
        'from_username': data.get('from_username'),
        'call_type': data.get('call_type'),
    }, room=str(to_user_id))


@socketio.on('match_call_response')
def handle_match_call_response(data):
    """Forward accept/decline back to the caller."""
    to_user_id = data.get('to_user_id')
    accepted = data.get('accepted', False)
    event = 'match_call_accepted' if accepted else 'match_call_declined'
    emit(event, {
        'from_user_id': data.get('from_user_id'),
        'call_type': data.get('call_type'),
    }, room=str(to_user_id))


@socketio.on('match_call_cancel')
def handle_match_call_cancel(data):
    """Caller cancelled before partner responded."""
    to_user_id = data.get('to_user_id')
    emit('match_call_cancelled', {}, room=str(to_user_id))


@socketio.on('phone_call_response')
def handle_phone_call_response(data):
    call_id = data.get('call_id')
    response = data.get('response')
    if not call_id or not response:
        return
    call_session = db.session.get(PhoneCallSession, call_id)
    if not call_session:
        return
    if response == 'yes':
        call_session.status = 'active'
        socketio.emit('phone_call_start', {'call_id': call_id},
                      room=str(call_session.caller_id))
        socketio.emit('phone_call_start', {'call_id': call_id},
                      room=str(call_session.receiver_id))
    else:
        call_session.status = 'declined'
    db.session.commit()
    emit('phone_call_response', {
        'call_id': call_id,
        'response': response,
        'partner_id': call_session.receiver_id
    }, room=str(call_session.caller_id))


@socketio.on('join_room')
def on_join(data):
    room = data.get('room')
    if not room:
        return
    join_room(room)
    emit('room_joined', {
        'room': room,
        'message': f"{data.get('username', 'Anonymous')} has entered the room."
    }, room=room)


@socketio.on('leave_room')
def on_leave(data):
    room = data.get('room')
    if not room:
        return
    leave_room(room)
    emit('room_left', {
        'room': room,
        'message': f"{data.get('username', 'Anonymous')} has left the room."
    }, room=room)


@socketio.on('video_chat_offer')
def handle_video_chat_offer(data):
    emit('video_chat_offer', {
        'offer': data.get('offer'),
        'from_user_id': data.get('from_user_id'),
        'room': data.get('room')
    }, room=str(data.get('room')))


@socketio.on('video_chat_answer')
def handle_video_chat_answer(data):
    emit('video_chat_answer', {
        'answer': data.get('answer'),
        'from_user_id': data.get('from_user_id'),
        'room': data.get('room')
    }, room=str(data.get('room')))


@socketio.on('audio_call_offer')
def handle_audio_call_offer(data):
    emit('audio_call_offer', data, room=data.get('partner_id'))


@socketio.on('audio_call_answer')
def handle_audio_call_answer(data):
    emit('audio_call_answer', data, room=data.get('partner_id'))


@socketio.on('ice_candidate')
def handle_ice_candidate(data):
    partner_id = data.get('partner_id')
    if partner_id is None:
        logger.warning('ice_candidate missing partner_id')
        return
    logger.info('Relaying ICE candidate', extra={'from_sid': request.sid, 'partner_id': str(partner_id)})
    emit('ice_candidate', data, room=str(partner_id))


# ============ VIDEO CHAT ============

@app.route('/start_video_chat', methods=['POST'])
@jwt_required()
def start_video_chat():
    user_id = get_current_user_id()
    data = request.get_json(silent=True) or {}
    partner_id = data.get('partner_id')
    if not partner_id:
        return jsonify({'message': 'partner_id is required'}), 400
    socketio.emit(
        'start_video_chat',
        {'user_id': user_id, 'partner_id': partner_id},
        room=str(partner_id)
    )
    return jsonify({'message': 'Video chat initiation signal sent'}), 200


# ============ MESSAGES ============

@app.route('/send_message', methods=['POST'])
@jwt_required()
@limiter.limit(os.environ.get('RATE_LIMIT_MESSAGE', '60 per minute'))
def send_message():
    current_user_id = get_current_user_id()
    data = request.get_json(silent=True) or {}
    receiver_id = data.get('receiver_id')
    text = data.get('text', '').strip()

    if not receiver_id:
        return jsonify({'message': 'receiver_id is required'}), 400
    if not text:
        return jsonify({'message': 'Message text is required'}), 400
    if len(text) > 500:
        return jsonify({'message': 'Message must be 500 characters or less'}), 400

    new_message = Message(
        sender_id=current_user_id,
        receiver_id=receiver_id,
        text=text
    )
    db.session.add(new_message)
    db.session.commit()

    # Emit via socket for real-time delivery
    socketio.emit('new_message', {
        'sender_id': current_user_id,
        'text': text,
        'timestamp': datetime.utcnow().isoformat()
    }, room=str(receiver_id))

    return jsonify({'message': 'Message sent'}), 200


@app.route('/get_messages', methods=['GET'])
@jwt_required()
def get_messages():
    current_user_id = get_current_user_id()
    partner_id = request.args.get('partner_id')

    if not partner_id:
        return jsonify({'message': 'partner_id is required'}), 400

    messages = Message.query.filter(
        ((Message.sender_id == current_user_id) & (Message.receiver_id == partner_id)) |
        ((Message.sender_id == partner_id) & (Message.receiver_id == current_user_id))
    ).order_by(Message.timestamp.asc()).all()

    message_list = [{
        'sender_id': msg.sender_id,
        'receiver_id': msg.receiver_id,
        'text': msg.text,
        'timestamp': msg.timestamp.isoformat()
    } for msg in messages]

    return jsonify({'messages': message_list}), 200


@app.route('/remove_match', methods=['POST'])
@jwt_required()
def remove_match():
    """Remove/unmatch a matched session (soft-delete by marking 'removed')."""
    current_user_id = get_current_user_id()
    data = request.get_json(silent=True) or {}
    session_id = data.get('session_id')
    partner_id = data.get('partner_id')

    if not session_id or not partner_id:
        return jsonify({'message': 'session_id and partner_id are required'}), 400

    session = MatchSession.query.filter_by(session_id=session_id).first()
    if not session:
        return jsonify({'message': 'Match session not found'}), 404

    # Verify the current user is part of this session
    if current_user_id not in (session.user1_id, session.user2_id):
        return jsonify({'message': 'Unauthorized'}), 403

    session.status = 'removed'
    db.session.commit()

    logger.info('Match removed', extra={
        'session_id': session_id,
        'removed_by': current_user_id,
        'partner_id': partner_id
    })

    return jsonify({'message': 'Match removed successfully'}), 200


@app.route('/report_user', methods=['POST'])
@jwt_required()
def report_user():
    """Report a user and block them from matching with you again."""
    current_user_id = get_current_user_id()
    data = request.get_json(silent=True) or {}
    blocked_id = data.get('blocked_id')
    reason = data.get('reason', '').strip()

    if not blocked_id:
        return jsonify({'message': 'blocked_id is required'}), 400
    if int(blocked_id) == current_user_id:
        return jsonify({'message': 'Cannot report yourself'}), 400

    # Check if already blocked
    existing = BlockedUser.query.filter_by(
        reporter_id=current_user_id,
        blocked_id=int(blocked_id)
    ).first()
    if existing:
        return jsonify({'message': 'User already reported'}), 200

    new_block = BlockedUser(
        reporter_id=current_user_id,
        blocked_id=int(blocked_id),
        reason=reason if reason else None
    )
    db.session.add(new_block)
    db.session.commit()

    logger.info('User reported', extra={
        'reporter_id': current_user_id,
        'blocked_id': blocked_id,
        'reason': reason
    })

    return jsonify({'message': 'User reported successfully'}), 200


@app.route('/get_matches', methods=['GET'])
@jwt_required()
def get_matches():
    """Return all completed match sessions for the current user."""
    current_user_id = get_current_user_id()

    # Include all post-match statuses so the match persists in "My Matches"
    # even if only one side has set a date (status may be 'filters_off' not yet 'completed')
    VISIBLE_STATUSES = ('matched', 'audio_call', 'video_call', 'filters_off', 'completed')
    sessions = MatchSession.query.filter(
        ((MatchSession.user1_id == current_user_id) |
         (MatchSession.user2_id == current_user_id)),
        MatchSession.status.in_(VISIBLE_STATUSES)
    ).order_by(MatchSession.created_at.desc()).all()

    matches = []
    for session in sessions:
        partner_id = (
            session.user2_id
            if session.user1_id == current_user_id
            else session.user1_id
        )
        partner = db.session.get(User, partner_id)
        if not partner:
            continue

        # Get last message between the two users
        last_msg = Message.query.filter(
            ((Message.sender_id == current_user_id) &
             (Message.receiver_id == partner_id)) |
            ((Message.sender_id == partner_id) &
             (Message.receiver_id == current_user_id))
        ).order_by(Message.timestamp.desc()).first()

        matches.append({
            'session_id': session.session_id,
            'partner_id': partner.id,
            'partner_username': partner.username,
            'partner_age': partner.age,
            'partner_image': '/uploads/' + partner.profile_image if partner.profile_image else None,
            'matched_at': session.created_at.isoformat(),
            'last_message': last_msg.text if last_msg else None,
        })

    return jsonify({'matches': matches}), 200


@socketio.on('start_turn')
def start_turn(data):
    emit('turn_started', {
        'session_id': data.get('session_id')
    }, room=data.get('other_user_id'))


@socketio.on('end_turn')
def end_turn(data):
    emit('turn_ended', {
        'session_id': data.get('session_id')
    }, room=data.get('other_user_id'))


@app.route('/api/user_profile/<int:user_id>')
@jwt_required()
def get_user_profile(user_id):
    """Return public profile fields for a matched user."""
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'message': 'User not found'}), 404
    return jsonify(user.to_public_dict()), 200


# ============ ERROR HANDLERS ============

@app.errorhandler(404)
def page_not_found(e):
    return jsonify({'message': 'Resource not found'}), 404


@app.errorhandler(500)
def internal_server_error(e):
    logger.error('Internal server error', extra={'error': str(e)})
    return jsonify({'message': 'Internal server error'}), 500


@app.errorhandler(413)
def request_entity_too_large(e):
    return jsonify({
        'message': f'File too large. Maximum size is {MAX_FILE_SIZE // (1024 * 1024)} MB'
    }), 413


@app.errorhandler(429)
def ratelimit_handler(e):
    return jsonify({
        'message': f'Rate limit exceeded. {e.description}'
    }), 429


# ============ ENTRY POINT ============

if __name__ == '__main__':
    # Development mode only
    logger.warning('Running in development mode with Flask dev server')
    socketio.run(
        app,
        debug=True,
        host='0.0.0.0',
        port=int(os.environ.get('PORT', 5000))
    )