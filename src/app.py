from flask import Flask, request, jsonify, send_from_directory
import requests
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from sqlalchemy.orm import Session
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
import os
import logging
import json
from math import radians, cos, sin, asin, sqrt
from datetime import datetime, timedelta
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS
from geopy.geocoders import Nominatim

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///dating_app.db'
app.config['JWT_SECRET_KEY'] = os.environ.get('JWT_SECRET_KEY', 'your_default_secret_key')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = True
db = SQLAlchemy(app)
migrate = Migrate(app, db)
jwt = JWTManager(app)
socketio = SocketIO(app)
account_sid = 'YOUR_ACCOUNT_SID'
auth_token = 'YOUR_AUTH_TOKEN'
CORS(app, resources={r"/*": {"origins": "http://localhost:3000"}})
socketio = SocketIO(app, cors_allowed_origins="http://localhost:3000")
geolocator = Nominatim(user_agent="MyApp/1.0 (maor.odiz1@gmail.com)")


# User model
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(120), nullable=False)
    age = db.Column(db.Integer)
    gender = db.Column(db.String(10))
    bio = db.Column(db.String(500))
    interests = db.Column(db.String(200))
    profile_image = db.Column(db.String(100))
    preferred_age_min = db.Column(db.Integer)
    preferred_age_max = db.Column(db.Integer)
    preferred_gender = db.Column(db.String(10))
    city = db.Column(db.String(100))
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    phone_number = db.Column(db.String(15))

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

class PhoneCallSession(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    caller_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    receiver_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    status = db.Column(db.String(20), default='waiting')  # e.g., 'waiting', 'active', 'ended'

class DateDetails(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user1_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    user2_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    date_time = db.Column(db.DateTime)
    location = db.Column(db.String(100))


class Message(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    sender_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    receiver_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    text = db.Column(db.String(500))
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)
    
class MatchQueue(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

    @property
    def waiting_time(self):
        # Calculate the waiting time since the user joined the queue
        return datetime.utcnow() - self.timestamp


# Initialize database
with app.app_context():
    db.create_all()

@app.route('/register', methods=['POST'])
def register():
    username = request.form.get('username')
    password = request.form.get('password')
    age = request.form.get('age')
    gender = request.form.get('gender')
    bio = request.form.get('bio')
    preferred_gender = request.form.get('preferredGender')
    preferred_age_min = request.form.get('preferredAgeRange[min]')
    preferred_age_max = request.form.get('preferredAgeRange[max]')
    interests = request.form.get('interests') # Handle conversion to JSON if needed
    phone_number = request.form.get('phoneNumber', '')
    profile_image = ''
    file = request.files.get('file')
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
        profile_image = filename

    if not username or not password:
        return jsonify({'message': 'Missing username or password'}), 400
    
    city = request.form.get('city')
    geolocator = Nominatim(user_agent="geoapiExercises")
    location = geolocator.geocode(city)
    if location:
        latitude, longitude = location.latitude, location.longitude
    else:
        return jsonify({'message': 'Invalid city name'}), 400

    new_user = User(
        username=username,
        age=age,
        gender=gender,
        bio=bio,
        interests=interests,
        profile_image=profile_image,
        preferred_age_min=preferred_age_min,
        preferred_age_max=preferred_age_max,
        preferred_gender=preferred_gender,
        city=city,
        latitude=latitude,
        longitude=longitude,
        phone_number=phone_number
    )
    new_user.set_password(password)
    db.session.add(new_user)
    db.session.commit()
    return jsonify({'message': 'User created successfully'}), 201


# User login
@app.route('/login', methods=['POST'])
def login():
    username = request.json.get('username')
    password = request.json.get('password')
    user = User.query.filter_by(username=username).first()
    if user and user.check_password(password):
        access_token = create_access_token(identity=user.id)
        return jsonify(access_token=access_token, user_id=user.id), 200
    return jsonify({'message': 'Invalid username or password'}), 401

@app.route('/update_preferences', methods=['POST'])
@jwt_required()
def update_preferences():
    current_user_id = get_jwt_identity()
    with Session(db.engine) as session:
        user = session.get(User, current_user_id)
        user.preferred_age_range = request.json.get('preferred_age_range')
        user.preferred_gender = request.json.get('preferred_gender')

    db.session.commit()
    return jsonify({'message': 'Preferences updated successfully'}), 200

@app.route('/update_profile', methods=['POST'])
@jwt_required()
def update_profile():
    current_user_id = get_jwt_identity()
    user = db.session.query(User).get(current_user_id)
    user.profile_image = request.json.get('profile_image', user.profile_image)
    user.age = request.json.get('age', user.age)
    user.gender = request.json.get('gender', user.gender)
    user.bio = request.json.get('bio', user.bio)
    user.interests = request.json.get('interests', user.interests)
    user.latitude = request.json.get('latitude', user.latitude)
    user.longitude = request.json.get('longitude', user.longitude)
    user.phone_number = request.json.get('phone_number', user.phone_number)
    # Add updates for other personal fields here

    db.session.commit()
    return jsonify({'message': 'Profile updated successfully'}), 200


UPLOAD_FOLDER = '/uploads'
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif'}

app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(__file__), 'uploads')


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/upload_image', methods=['POST'])
@jwt_required()
def upload_image():
    if 'file' not in request.files:
        return jsonify({'message': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'message': 'No selected file'}), 400
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
        current_user_id = get_jwt_identity()
        user = db.session.query(User).get(current_user_id)
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
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

# Real-time notifications

@socketio.on('notification')
def handle_notification(data):
    emit('notification', data, broadcast=True, include_self=False)  # Exclude the sender from broadcasting


# Admin routes
@app.route('/admin/users', methods=['GET'])
def admin_list_users():
    users = User.query.all()
    user_list = [{'id': user.id, 'username': user.username} for user in users]
    return jsonify({'users': user_list}), 200

@app.route('/admin/delete_user', methods=['POST'])
def admin_delete_user():
    user_id = request.json.get('user_id')
    user = User.query.get(user_id)
    if user:
        db.session.delete(user)
        db.session.commit()
        return jsonify({'message': 'User deleted successfully'}), 200
    else:
        return jsonify({'message': 'User not found'}), 404

# Error handling
@app.errorhandler(404)
def page_not_found(e):
    return jsonify({'message': 'Resource not found'}), 404

@app.errorhandler(500)
def internal_server_error(e):
    return jsonify({'message': 'Internal server error'}), 500


@app.route('/set_date', methods=['POST'])
@jwt_required()
def set_date():
    current_user_id = get_jwt_identity()
    partner_id = request.json.get('partner_id')
    date_time = request.json.get('date_time')
    location = request.json.get('location')

    new_date = DateDetails(user1_id=current_user_id, user2_id=partner_id, date_time=date_time, location=location)
    db.session.add(new_date)
    db.session.commit()

    return jsonify({'message': 'Date set successfully'}), 200


def haversine(lon1, lat1, lon2, lat2):
    # Convert decimal degrees to radians
    lon1, lat1, lon2, lat2 = map(radians, [lon1, lat1, lon2, lat2])
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
    c = 2 * asin(sqrt(a))
    # 6371 km, the radius of Earth
    km = 6371 * c
    return km

def get_coordinates(city):
    API_KEY = 'YOUR_GOOGLE_MAPS_API_KEY'
    base_url = "https://maps.googleapis.com/maps/api/geocode/json"
    endpoint = f"{base_url}?address={city}&key={API_KEY}"
    response = requests.get(endpoint)
    if response.status_code == 200:
        results = response.json()['results']
        if results:
            location = results[0]['geometry']['location']
            return location['lat'], location['lng']
    return None, None

@app.route('/match', methods=['GET'])
@jwt_required()
def match_user():
    current_user_id = get_jwt_identity()
    current_user = User.query.get(current_user_id)

    if not current_user:
        return jsonify({'message': 'Current user not found'}), 404

    # Filter potential matches based on gender preference
    potential_matches = User.query.filter(
        User.id != current_user_id,
        User.gender == current_user.preferred_gender
    ).all()

    # Sort matches by distance
    sorted_matches = sorted(potential_matches, key=lambda user: haversine(current_user.longitude, current_user.latitude, user.longitude, user.latitude))

    matches = [{
        'id': user.id,
        'username': user.username,
        'age': user.age,
        'profile_image': os.path.join(request.host_url, 'uploads', user.profile_image) if user.profile_image else None,
        'gender': user.gender,
        'distance': haversine(current_user.longitude, current_user.latitude, user.longitude, user.latitude)
    } for user in sorted_matches]


    print(f"Matches found: {matches}")
    return jsonify(matches=matches), 200



@socketio.on('join_room')
def on_join(data):
    username = data['username']
    room = data['room']
    join_room(room)
    emit('room_joined', {'room': room, 'message': f'{username} has entered the room.'}, room=room)

@socketio.on('leave_room')
def on_leave(data):
    username = data['username']
    room = data['room']
    leave_room(room)
    emit('room_left', {'room': room, 'message': f'{username} has left the room.'}, room=room)

@socketio.on('video_chat_offer')
def handle_video_chat_offer(data):
    room = data['room']
    offer = data['offer']
    emit('video_chat_offer', {'offer': offer}, room=room)

@socketio.on('video_chat_answer')
def handle_video_chat_answer(data):
    room = data['room']
    answer = data['answer']
    emit('video_chat_answer', {'answer': answer}, room=room)

# SocketIO Event Handlers for WebRTC signaling
@socketio.on('audio_call_offer')
def handle_audio_call_offer(data):
    emit('audio_call_offer', data, room=data['partner_id'])

@socketio.on('audio_call_answer')
def handle_audio_call_answer(data):
    emit('audio_call_answer', data, room=data['partner_id'])

@socketio.on('ice_candidate')
def handle_ice_candidate(data):
    emit('ice_candidate', data, room=data['partner_id'])


@app.route('/start_video_chat', methods=['POST'])
@jwt_required()
def start_video_chat():
    user_id = get_jwt_identity()
    partner_id = request.json.get('partner_id')

    socketio.emit('start_video_chat', {'user_id': user_id, 'partner_id': partner_id}, room=partner_id)

    return jsonify({'message': 'Video chat initiation signal sent'}), 200



@app.route('/send_message', methods=['POST'])
@jwt_required()
def send_message():
    current_user_id = get_jwt_identity()
    receiver_id = request.json.get('receiver_id')
    text = request.json.get('text')

    new_message = Message(sender_id=current_user_id, receiver_id=receiver_id, text=text)
    db.session.add(new_message)
    db.session.commit()

    return jsonify({'message': 'Message sent'}), 200

@app.route('/get_messages', methods=['GET'])
@jwt_required()
def get_messages():
    current_user_id = get_jwt_identity()
    partner_id = request.args.get('partner_id')

    messages = Message.query.filter(
        (Message.sender_id == current_user_id & Message.receiver_id == partner_id) |
        (Message.sender_id == partner_id & Message.receiver_id == current_user_id)
    ).order_by(Message.timestamp.asc()).all()

    message_list = [{'sender_id': msg.sender_id, 'text': msg.text, 'timestamp': msg.timestamp} for msg in messages]
    return jsonify({'messages': message_list}), 200

@socketio.on('start_turn')
def start_turn(data):
    # Logic to handle the start of a user's turn in the phone call
    # This could involve notifying the other user that it's their turn to speak
    emit('turn_started', {'session_id': data['session_id']}, room=data['other_user_id'])

@socketio.on('end_turn')
def end_turn(data):
    # Logic to handle the end of a user's turn
    emit('turn_ended', {'session_id': data['session_id']}, room=data['other_user_id'])



if __name__ == '__main__':
    socketio.run(app, debug=True)
