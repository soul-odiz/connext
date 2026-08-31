import React, { useState } from 'react';
import axios from 'axios';
import API_BASE_URL from '../config';

const GENDERS = ['Male', 'Female', 'Other'];

/**
 * Shown once after a brand-new Google/Apple sign-up so the user fills in the
 * minimum fields required for matching (gender, age, city, preferred gender).
 */
const CompleteProfile = ({ currentUser, token, onComplete, onCancel }) => {
  const [form, setForm] = useState({
    age: currentUser?.age || '',
    gender: currentUser?.gender || '',
    city: currentUser?.city || '',
    preferredGender: currentUser?.preferred_gender || currentUser?.preferredGender || '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const canSubmit = form.age >= 18 && form.gender && form.city && form.preferredGender;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) {
      setError('Please fill in age (18+), gender, city and preferred gender.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const activeToken = token || localStorage.getItem('token');
      const res = await axios.post(
        `${API_BASE_URL}/update_profile`,
        {
          age: parseInt(form.age, 10),
          gender: form.gender,
          city: form.city,
          preferred_gender: form.preferredGender,
        },
        { headers: { Authorization: `Bearer ${activeToken}` } }
      );
      const updated = res.data?.updatedUser || res.data?.user;
      localStorage.setItem('currentUser', JSON.stringify(updated));
      if (onComplete) onComplete(updated);
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not save your profile. Please try again.');
      console.error('CompleteProfile error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="complete-profile-overlay">
      <div className="complete-profile-card">
        <h2>Almost done! 👋</h2>
        <p className="complete-profile-sub">
          We just need a few details to find your matches.
        </p>

        <div className="complete-profile-field">
          <label>Age</label>
          <input
            type="number"
            min="18"
            max="120"
            value={form.age}
            onChange={(e) => setForm({ ...form, age: e.target.value })}
            placeholder="Age"
          />
        </div>

        <div className="complete-profile-field">
          <label>Gender</label>
          <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
            <option value="">Select gender</option>
            {GENDERS.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>

        <div className="complete-profile-field">
          <label>City</label>
          <input
            type="text"
            value={form.city}
            onChange={(e) => setForm({ ...form, city: e.target.value })}
            placeholder="City"
          />
        </div>

        <div className="complete-profile-field">
          <label>I'm interested in</label>
          <select
            value={form.preferredGender}
            onChange={(e) => setForm({ ...form, preferredGender: e.target.value })}
          >
            <option value="">Select preference</option>
            {GENDERS.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>

        {error && <div className="error-message">{error}</div>}

        <div className="complete-profile-actions">
          <button className="btn-2" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Saving…' : 'Save & Continue'}
          </button>
          {onCancel && (
            <button className="lobby-button" onClick={onCancel} disabled={loading}>
              Skip for now
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default CompleteProfile;