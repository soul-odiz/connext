import React, { useState } from 'react';
import axios from 'axios';
import closeButtonImage from '../close.jpg';
import API_BASE_URL from '../config';
const GENDERS = ['Male', 'Female', 'Other'];
const INTERESTS = ['Nature', 'Gaming', 'Movies', 'TV Series'];

function SignUp() {
  const [formData, setFormData] = useState({
    username: '',
    password: '',
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

  const register = async () => {
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

      const response = await axios.post(`${API_BASE_URL}/register`, formDataToSend);
      setSuccessMessage(response.data.message);
      setTimeout(() => {
        setShowSignUpForm(false);
      }, 1500);
    } catch (error) {
      if (error.response && error.response.data) {
        setErrorMessage(error.response.data.message);
      } else {
        console.error('Error during registration:', error);
        setErrorMessage('An error occurred during registration.');
      }
    } finally {
      setLoading(false);
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
            <div className='user-box'>
              <label>Interests (up to 5)</label>
              {INTERESTS.map(interest => (
                <div key={interest}>
                  <input
                    type="checkbox"
                    name="interests"
                    value={interest}
                    checked={formData.interests.includes(interest)}
                    onChange={handleChange}
                    disabled={formData.interests.length >= 5 && !formData.interests.includes(interest)}
                  />
                  {interest}
                </div>
              ))}
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
            <button className='btn-2' onClick={register} disabled={loading}>{loading ? 'Registering...' : 'Register'}
              <span></span>
              <span></span>
              <span></span>
              <span></span>
            </button>
          </div>
        </div>
      )}
    </div>
  );

}

export default SignUp;