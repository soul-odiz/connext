import React, { useState } from 'react';
import axios from 'axios';
import closeButtonImage from '../close.jpg';
import SocialAuth from './SocialAuth';
import API_BASE_URL from '../config';
const GENDERS = ['Male', 'Female', 'Other'];
const INTEREST_CATEGORIES = [
  { label: 'נ® Gaming & Tech', items: ['Gaming', 'PC Gaming', 'Console Gaming', 'Mobile Gaming', 'VR / AR', 'Coding', 'AI & Tech', 'Gadgets', 'Cybersecurity', 'Crypto / Web3'] },
  { label: 'נ¬ Entertainment', items: ['Movies', 'TV Series', 'Anime', 'Documentaries', 'Stand-up Comedy', 'Podcasts', 'YouTube', 'Streaming', 'Theater', 'Board Games'] },
  { label: 'נµ Music', items: ['Pop', 'Rock', 'Hip-Hop', 'Electronic / EDM', 'Jazz', 'Classical', 'R&B', 'Metal', 'Indie', 'Playing Instruments'] },
  { label: 'נƒ Sports & Fitness', items: ['Gym / Weightlifting', 'Running', 'Cycling', 'Swimming', 'Football / Soccer', 'Basketball', 'Tennis', 'Martial Arts', 'Yoga', 'Hiking'] },
  { label: 'נ¿ Outdoors & Nature', items: ['Hiking', 'Camping', 'Rock Climbing', 'Surfing', 'Skiing / Snowboarding', 'Fishing', 'Gardening', 'Bird Watching', 'Astronomy', 'Backpacking'] },
  { label: 'נ• Food & Drink', items: ['Cooking', 'Baking', 'Coffee', 'Wine', 'Craft Beer', 'Sushi', 'Vegan / Plant-based', 'Street Food', 'Fine Dining', 'Meal Prep'] },
  { label: 'גˆן¸ Travel & Culture', items: ['Travelling', 'Backpacking', 'Road Trips', 'Languages', 'History', 'Museums', 'Photography', 'Architecture', 'Volunteering', 'Festivals'] },
  { label: 'נ“ Learning & Creativity', items: ['Reading', 'Writing', 'Drawing / Illustration', 'Painting', 'Sculpting', 'Photography', 'Filmmaking', 'Design', 'Fashion', 'DIY / Crafts'] },
  { label: 'נ§˜ Wellness & Lifestyle', items: ['Meditation', 'Mindfulness', 'Journaling', 'Astrology', 'Spirituality', 'Self-improvement', 'Minimalism', 'Sustainability', 'Mental Health', 'Nutrition'] },
  { label: 'נ¾ Animals & Pets', items: ['Dogs', 'Cats', 'Horses', 'Reptiles', 'Birds', 'Marine Life', 'Wildlife', 'Animal Rescue', 'Veganism', 'Zoo / Aquarium'] },
];

function SignUp() {
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    email: '',
    age: '',
    gender: '',
    bio: '',
    interests: [],
    preferredAgeRange: { min: 18, max: 60 },
    preferredGender: '',
    city: '',
    phoneNumber: ''
  });
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [showSignUpForm, setShowSignUpForm] = useState(false);
  const [showVerifyNotice, setShowVerifyNotice] = useState(false);
  const [resendMessage, setResendMessage] = useState('');

  const handleChange = (e) => {
    const { name, value, type, checked, files } = e.target;
    if (type === 'file') {
      setFormData({ ...formData, [name]: files[0] });
    } else if (type === 'checkbox') {
      setFormData(prevState => ({
        ...prevState,
        interests: checked
          ? [...prevState.interests, value]
          : prevState.interests.filter(interest => interest !== value)
      }));
    } else {
        setFormData({ ...formData, [name]: value });
      }
    };

  const handleRangeChange = (e) => {
    const { name, value } = e.target;
    setFormData(prevState => ({
      ...prevState,
      preferredAgeRange: {
        ...prevState.preferredAgeRange,
        [name]: parseInt(value, 10)
      }
    }));
  };

  const isFormValid = () => {
    if (!formData.username || !formData.password || !formData.age || !formData.gender || !formData.city) {
      return false;
    }
    if (!formData.preferredGender) return false;
    return true;
  };

  const register = async (useFirebase = false) => {
    if (!isFormValid()) {
      setErrorMessage('Please fill in all required fields.');
      return;
    }

    const formDataToSend = new FormData();
    for (const key in formData) {
      if (key === 'profileImage' && formData[key]) {
        formDataToSend.append('file', formData[key]);
      } else if (key === 'preferredAgeRange') {
        formDataToSend.append('preferredAgeRange[min]', formData[key].min);
        formDataToSend.append('preferredAgeRange[max]', formData[key].max);
      } else if (key === 'interests') {
        // Convert array to JSON string for the backend
        formDataToSend.append('interests', JSON.stringify(formData[key]));
      } else {
        formDataToSend.append(key, formData[key]);
      }
    }

    try {
      setLoading(true);
      setErrorMessage('');
      setSuccessMessage('');
      setShowVerifyNotice(false);
      setResendMessage('');

      // If the user provided an email and Firebase is configured, create a
      // Firebase account so we can send an email-verification link.
      let firebaseUid = '';
      let authProvider = 'local';
      if (useFirebase && formData.email) {
        const { getAuth, firebaseConfigured } = await import('../firebase');
        const { createUserWithEmailAndPassword, sendEmailVerification } = await import('firebase/auth');
        if (firebaseConfigured) {
          const auth = await getAuth();
          if (auth) {
            const cred = await createUserWithEmailAndPassword(auth, formData.email, formData.password);
            firebaseUid = cred.user.uid;
            authProvider = 'email';
            await sendEmailVerification(cred.user);
            setShowVerifyNotice(true);
          }
        }
      }

      if (firebaseUid) {
        formDataToSend.append('firebase_uid', firebaseUid);
        formDataToSend.append('auth_provider', 'email');
        formDataToSend.append('email', formData.email);
      }

      const response = await axios.post(`${API_BASE_URL}/register`, formDataToSend);
      setSuccessMessage(response.data.message);
      setTimeout(() => {
        setShowSignUpForm(false);
      }, 1500);
    } catch (error) {
      if (error.response && error.response.data) {
        setErrorMessage(error.response.data.message);
      } else if (error.code === 'auth/email-already-in-use') {
        setErrorMessage('An account with this email already exists. Please sign in.');
      } else if (error.code === 'auth/weak-password') {
        setErrorMessage('Password is too weak. Use at least 6 characters.');
      } else if (error.code === 'auth/invalid-email') {
        setErrorMessage('Please enter a valid email address.');
      } else {
        console.error('Error during registration:', error);
        setErrorMessage('An error occurred during registration.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    setResendMessage('');
    try {
      const { getAuth, firebaseConfigured } = await import('../firebase');
      const { sendEmailVerification } = await import('firebase/auth');
      if (!firebaseConfigured) {
        setResendMessage('Please sign in to resend the verification email.');
        return;
      }
      const auth = await getAuth();
      if (!auth || !auth.currentUser) {
        setResendMessage('Please sign in to resend the verification email.');
        return;
      }
      await sendEmailVerification(auth.currentUser);
      setResendMessage('Verification email sent. Check your inbox.');
    } catch (err) {
      console.error('Resend verification error:', err);
      setResendMessage('Could not resend the email. Please try again.');
    }
  };

  const handleShowSignUpForm = () => {
    setShowSignUpForm(true);
  };
  const handleCloseSignUpForm = () => {
    setShowSignUpForm(false);
  };

  return (
    <div className="signup-container">
      {!showSignUpForm && (
        <button onClick={handleShowSignUpForm}>Register</button>
      )}

      {showSignUpForm && (
        <div className="overlay">
          <div className='signup-page'>
            <button onClick={handleCloseSignUpForm} className="close-button">
              <img src={closeButtonImage} alt="Close" />
            </button>
            <h2>Register</h2>

            {/* Social sign-up (Google / Apple) */}
            <SocialAuth onSignIn={() => {}} dividerText="or sign up with" />

            {/* Email verification notice (email sign-up) */}
            {showVerifyNotice && (
              <div className="verify-notice">
                <p>ג… A verification link was sent to <strong>{formData.email}</strong>.</p>
                <p>Click it to confirm your email, then sign in.</p>
                <button type="button" className="link-button" onClick={handleResendVerification}>
                  Resend verification email
                </button>
                {resendMessage && <p className="success-message">{resendMessage}</p>}
              </div>
            )}

            {/* Username */}
            <div className='user-box'>
              <input
                type="text"
                name="username"
                value={formData.username}
                onChange={handleChange}
                placeholder="Username"
              />
              <label>Username</label>
            </div>

            {/* Password */}
            <div className='user-box'>
              <input
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="Password"
              />
              <label>Password</label>
            </div>

            {/* Email (used for account verification when provided) */}
            <div className='user-box'>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="Email (optional, for verification)"
              />
              <label>Email</label>
            </div>

            {/* Gender */}
            <div className='user-box'>
              <select name="gender" onChange={handleChange} value={formData.gender}>
                <option value="">Gender</option>
                {GENDERS.map(gender => (
                  <option key={gender} value={gender}>{gender}</option>
                ))}
              </select>
            </div>

            {/* Age */}
            <div className='user-box'>
              <input
                type="number"
                name="age"
                value={formData.age}
                onChange={handleChange}
                placeholder="Age"
                min="18"
                max="120"
              />
              <label>Age</label>
            </div>

            {/* City */}
            <div className='user-box'>
              <input
                type="text"
                name="city"
                value={formData.city}
                onChange={handleChange}
                placeholder="City"
              />
              <label>City</label>
            </div>

            {/* Phone Number */}
            <div className='user-box'>
              <input
                type="tel"
                name="phoneNumber"
                value={formData.phoneNumber}
                onChange={handleChange}
                placeholder="Phone Number"
              />
              <label>Phone Number</label>
            </div>

            {/* Preferred Gender */}
            <div className='user-box'>
            <select name="preferredGender" onChange={handleChange} value={formData.preferredGender}>
                <option value="">Looking for...</option>
                {GENDERS.map(gender => (
                <option key={gender} value={gender}>{gender}</option>
                ))}
            </select>
            <label>I'm looking for...</label>
            </div><br />

            {/* Interests */}
            <div className='user-box' style={{ marginTop: '15px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
                Interests ({formData.interests.length} selected)
              </label>
              <div className="profile-interests-categories" style={{ maxHeight: '300px', overflowY: 'auto', padding: '8px', border: '1px solid rgba(0,212,255,0.2)', borderRadius: '8px', background: 'rgba(5,5,20,0.4)' }}>
                {INTEREST_CATEGORIES.map(cat => (
                  <div key={cat.label} style={{ marginBottom: '8px' }}>
                    <p style={{ color: 'rgba(0,212,255,0.8)', fontSize: '12px', margin: '4px 0', fontWeight: 'bold' }}>{cat.label}</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {cat.items.map(interest => (
                        <label
                          key={interest}
                          className="interest-chip"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            padding: '3px 8px',
                            borderRadius: '14px',
                            fontSize: '11px',
                            cursor: 'pointer',
                            background: formData.interests.includes(interest) ? 'rgba(0,212,255,0.25)' : 'rgba(255,255,255,0.06)',
                            border: formData.interests.includes(interest) ? '1px solid rgba(0,212,255,0.6)' : '1px solid rgba(255,255,255,0.1)',
                            color: formData.interests.includes(interest) ? '#fff' : 'rgba(255,255,255,0.6)',
                            opacity: formData.interests.includes(interest) ? 1 : 0.7,
                          }}
                        >
                          <input
                            type="checkbox"
                            name="interests"
                            value={interest}
                            checked={formData.interests.includes(interest)}
                            onChange={handleChange}
                            style={{ display: 'none' }}
                          />
                          {interest}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div><br />

            {/* Preferred Age Range */}
            <div className='user-box'>
              <label>Age Range</label><br />
              <input
                type="range"
                name="min"
                min="18"
                max="100"
                value={formData.preferredAgeRange.min}
                onChange={handleRangeChange}
              />
              <input
                type="range"
                name="max"
                min="18"
                max="100"
                value={formData.preferredAgeRange.max}
                onChange={handleRangeChange}
              />
              <div>Min: {formData.preferredAgeRange.min} - Max: {formData.preferredAgeRange.max}</div>
            </div>

            {/* Bio */}
            <div className='user-box'>
              <textarea
                name="bio"
                value={formData.bio}
                onChange={handleChange}
                placeholder="Bio"
              />
              <label>Bio</label>
            </div>

            <div className='user-box'>
            <input
                type="file"
                name="profileImage"
                onChange={handleChange}
            />
            <label>Profile Image</label>
            </div>

            {/* Error and Success Messages */}
            {errorMessage && <div className="error-message">{errorMessage}</div>}
            {successMessage && <div className="success-message">{successMessage}</div>}

            {/* Register Button */}
            <button className='btn-2' onClick={() => register(true)} disabled={loading}>{loading ? 'Registering...' : 'Register'}
              <span></span>
              <span></span>
              <span></span>
              <span></span>
            </button>
            {formData.email && (
              <p className="form-hint">💡 Adding an email lets us verify your account.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );

}

export default SignUp;