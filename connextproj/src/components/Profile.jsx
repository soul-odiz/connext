import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import API_BASE_URL from '../config';

// ── Full interests catalogue ──────────────────────────────────────────────
const INTEREST_CATEGORIES = [
  {
    label: '🎮 Gaming & Tech',
    items: ['Gaming', 'PC Gaming', 'Console Gaming', 'Mobile Gaming', 'VR / AR', 'Coding', 'AI & Tech', 'Gadgets', 'Cybersecurity', 'Crypto / Web3'],
  },
  {
    label: '🎬 Entertainment',
    items: ['Movies', 'TV Series', 'Anime', 'Documentaries', 'Stand-up Comedy', 'Podcasts', 'YouTube', 'Streaming', 'Theater', 'Board Games'],
  },
  {
    label: '🎵 Music',
    items: ['Pop', 'Rock', 'Hip-Hop', 'Electronic / EDM', 'Jazz', 'Classical', 'R&B', 'Metal', 'Indie', 'Playing Instruments'],
  },
  {
    label: '🏃 Sports & Fitness',
    items: ['Gym / Weightlifting', 'Running', 'Cycling', 'Swimming', 'Football / Soccer', 'Basketball', 'Tennis', 'Martial Arts', 'Yoga', 'Hiking'],
  },
  {
    label: '🌿 Outdoors & Nature',
    items: ['Hiking', 'Camping', 'Rock Climbing', 'Surfing', 'Skiing / Snowboarding', 'Fishing', 'Gardening', 'Bird Watching', 'Astronomy', 'Backpacking'],
  },
  {
    label: '🍕 Food & Drink',
    items: ['Cooking', 'Baking', 'Coffee', 'Wine', 'Craft Beer', 'Sushi', 'Vegan / Plant-based', 'Street Food', 'Fine Dining', 'Meal Prep'],
  },
  {
    label: '✈️ Travel & Culture',
    items: ['Travelling', 'Backpacking', 'Road Trips', 'Languages', 'History', 'Museums', 'Photography', 'Architecture', 'Volunteering', 'Festivals'],
  },
  {
    label: '📚 Learning & Creativity',
    items: ['Reading', 'Writing', 'Drawing / Illustration', 'Painting', 'Sculpting', 'Photography', 'Filmmaking', 'Design', 'Fashion', 'DIY / Crafts'],
  },
  {
    label: '🧘 Wellness & Lifestyle',
    items: ['Meditation', 'Mindfulness', 'Journaling', 'Astrology', 'Spirituality', 'Self-improvement', 'Minimalism', 'Sustainability', 'Mental Health', 'Nutrition'],
  },
  {
    label: '🐾 Animals & Pets',
    items: ['Dogs', 'Cats', 'Horses', 'Reptiles', 'Birds', 'Marine Life', 'Wildlife', 'Animal Rescue', 'Veganism', 'Zoo / Aquarium'],
  },
];

// Normalise a currentUser object — handles both camelCase (frontend) and
// snake_case (backend) field names so the form always pre-populates.
const normaliseUser = (u) => ({
  username:         u.username         || '',
  age:              u.age              || '',
  gender:           u.gender           || '',
  bio:              u.bio              || '',
  interests:        Array.isArray(u.interests) ? u.interests : [],
  preferredAgeRange: u.preferredAgeRange || u.preferred_age_range || { min: 18, max: 60 },
  preferredGender:  u.preferredGender  || u.preferred_gender || '',
  city:             u.city             || '',
  phoneNumber:      u.phoneNumber      || u.phone_number || '',
  profileImageUrl:  u.profileImage     || u.profile_image || '',
});

const Profile = ({ currentUser, updateProfile }) => {
  const [isProfileVisible, setIsProfileVisible] = useState(false);
  const [profileData, setProfileData] = useState(() => normaliseUser(currentUser));
  const [profileImageUrl, setProfileImageUrl] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef(null);

  // ── Fetch profile image ──────────────────────────────────────────────────
  const fetchProfileImageUrl = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/get_profile_image_url/${currentUser.id}`);
      if (res.data.success) {
        const url = `${API_BASE_URL}${res.data.imageUrl}`;
        setProfileImageUrl(url);
        localStorage.setItem('profileImageUrl', url);
      }
    } catch (err) {
      console.error('Error fetching profile image URL:', err);
    }
  }, [currentUser.id]);

  useEffect(() => {
    const saved = localStorage.getItem('profileImageUrl');
    if (saved) {
      setProfileImageUrl(saved);
    } else if (currentUser.id) {
      fetchProfileImageUrl();
    }
  }, [currentUser.id, fetchProfileImageUrl]);

  // ── Sync form when currentUser changes ───────────────────────────────────
  useEffect(() => {
    setProfileData(normaliseUser(currentUser));
  }, [currentUser]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    if (type === 'checkbox') {
      setProfileData(prev => ({
        ...prev,
        interests: checked
          ? [...prev.interests, value]
          : prev.interests.filter(i => i !== value),
      }));
    } else if (name === 'min' || name === 'max') {
      setProfileData(prev => ({
        ...prev,
        preferredAgeRange: { ...prev.preferredAgeRange, [name]: parseInt(value, 10) },
      }));
    } else {
      setProfileData(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    updateProfile(profileData);
    setIsProfileVisible(false);
  };

  // ── Profile picture upload ────────────────────────────────────────────────
  const handleImageChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const authToken = localStorage.getItem('token');
    if (!authToken) return;

    setUploadingImage(true);
    setUploadError('');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await axios.post(`${API_BASE_URL}/upload_image`, formData, {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'multipart/form-data',
        },
      });

      if (res.data.filename) {
        const newUrl = `${API_BASE_URL}/uploads/${res.data.filename}`;
        setProfileImageUrl(newUrl);
        localStorage.setItem('profileImageUrl', newUrl);
        // Also update profileData so the submit includes the new image
        setProfileData(prev => ({ ...prev, profileImageUrl: `/uploads/${res.data.filename}` }));
      }
    } catch (err) {
      console.error('Image upload error:', err);
      setUploadError('Image upload failed. Please try again.');
    } finally {
      setUploadingImage(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={`user-dashboard-form ${isProfileVisible ? 'open' : 'closed'}`}>
      {/* Avatar button */}
      <button
        type="button"
        className="profile-avatar-button"
        onClick={() => setIsProfileVisible(v => !v)}
        aria-label={isProfileVisible ? 'Close profile' : 'Edit profile'}
      >
        <img
          className="profile-image"
          src={profileImageUrl || '/logo192.png'}
          alt="Profile"
          onError={(e) => { e.target.onerror = null; e.target.src = '/logo192.png'; }}
        />
        {!isProfileVisible && <span className="profile-avatar-ring" />}
      </button>

      {isProfileVisible && (
        <div className="profile-panel">
          {/* ── Header ── */}
          <div className="profile-panel-header">
            <div className="profile-title-block" style={{ textAlign: 'left' }}>
              <span className="profile-kicker">My Profile</span>
              <h2>Edit Details</h2>
              <p>Update your info to help us find better matches.</p>
            </div>
            <button
              type="button"
              className="profile-close-button"
              onClick={() => setIsProfileVisible(false)}
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <form onSubmit={handleSubmit} className="profile-form">

            {/* ── Profile Picture ── */}
            <section className="profile-section">
              <h3>Profile Picture</h3>
              <div className="profile-photo-row">
                <div className="profile-photo-preview">
                  <img
                    src={profileImageUrl || '/logo192.png'}
                    alt="Profile"
                    onError={(e) => { e.target.onerror = null; e.target.src = '/logo192.png'; }}
                  />
                  {uploadingImage && <div className="profile-photo-uploading">⏳</div>}
                </div>
                <div className="profile-photo-actions">
                  <button
                    type="button"
                    className="profile-photo-btn"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingImage}
                  >
                    {uploadingImage ? 'Uploading…' : '📷 Change Photo'}
                  </button>
                  <p className="profile-photo-hint">JPG, PNG or GIF · Max 5 MB</p>
                  {uploadError && <p className="profile-photo-error">{uploadError}</p>}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleImageChange}
                />
              </div>
            </section>

            {/* ── Personal Details ── */}
            <section className="profile-section">
              <h3>Personal Details</h3>
              <div className="profile-grid">
                <label className="profile-field">
                  <span>Username</span>
                  <input
                    type="text"
                    name="username"
                    value={profileData.username}
                    onChange={handleChange}
                    placeholder="Your username"
                  />
                </label>

                <label className="profile-field">
                  <span>Age</span>
                  <input
                    type="number"
                    name="age"
                    value={profileData.age}
                    onChange={handleChange}
                    placeholder="18"
                    min="18"
                  />
                </label>

                <label className="profile-field">
                  <span>Gender</span>
                  <select name="gender" value={profileData.gender} onChange={handleChange}>
                    <option value="">Select…</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </label>

                <label className="profile-field">
                  <span>City</span>
                  <input
                    type="text"
                    name="city"
                    value={profileData.city}
                    onChange={handleChange}
                    placeholder="Your city"
                  />
                </label>
              </div>

              <label className="profile-field profile-field-full">
                <span>Bio</span>
                <textarea
                  name="bio"
                  value={profileData.bio}
                  onChange={handleChange}
                  placeholder="Tell people a bit about yourself…"
                  rows={4}
                />
              </label>
            </section>

            {/* ── Interests ── */}
            <section className="profile-section">
              <h3>Interests</h3>
              <p className="profile-interests-hint">
                {profileData.interests.length} selected — pick everything that fits you
              </p>
              <div className="profile-interests-categories">
                {INTEREST_CATEGORIES.map(cat => (
                  <div key={cat.label} className="profile-interest-category">
                    <p className="profile-interest-category-label">{cat.label}</p>
                    <div className="interest-chip-list">
                      {cat.items.map(interest => (
                        <label className="interest-chip" key={interest}>
                          <input
                            type="checkbox"
                            name="interests"
                            value={interest}
                            checked={profileData.interests.includes(interest)}
                            onChange={handleChange}
                          />
                          <span>{interest}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* ── Match Preferences ── */}
            <section className="profile-section">
              <h3>Match Preferences</h3>
              <div className="profile-grid">
                <label className="profile-field">
                  <span>I'm looking for…</span>
                  <select name="preferredGender" value={profileData.preferredGender} onChange={handleChange}>
                    <option value="">Select…</option>
                    <option value="Male">Men</option>
                    <option value="Female">Women</option>
                    <option value="Other">Other</option>
                  </select>
                </label>

                <label className="profile-field">
                  <span>Phone Number</span>
                  <input
                    type="tel"
                    name="phoneNumber"
                    value={profileData.phoneNumber}
                    onChange={handleChange}
                    placeholder="+1 555 000 0000"
                  />
                </label>
              </div>

              <div className="age-range-card">
                <div className="age-range-heading">
                  <span>Preferred Age Range</span>
                  <strong>{profileData.preferredAgeRange.min} – {profileData.preferredAgeRange.max}</strong>
                </div>
                <input
                  type="range"
                  name="min"
                  min="18"
                  max="100"
                  value={profileData.preferredAgeRange.min}
                  onChange={handleChange}
                />
                <input
                  type="range"
                  name="max"
                  min="18"
                  max="100"
                  value={profileData.preferredAgeRange.max}
                  onChange={handleChange}
                />
              </div>
            </section>

            {/* ── Actions ── */}
            <div className="profile-actions">
              <button type="button" className="profile-secondary-button" onClick={() => setIsProfileVisible(false)}>
                Cancel
              </button>
              <button type="submit" className="profile-submit-button">
                Save Profile
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default Profile;
