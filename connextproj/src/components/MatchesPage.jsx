import React, { useState, useEffect, useContext } from 'react';
import axios from 'axios';
import { UserContext } from './UserContext';
import API_BASE_URL from '../config';
import Avatar from './Avatar';
import PartnerProfileModal from './PartnerProfileModal';

const MatchesPage = ({ currentUser, token: propToken, socket, onClose, onOpenChat }) => {
  const { token: contextToken, setToken, setCurrentUser } = useContext(UserContext);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewingProfile, setViewingProfile] = useState(null); // { partner_id, partner_username, session_id }

  useEffect(() => {
    const authToken = propToken || contextToken || localStorage.getItem('token');

    if (!authToken) {
      setLoading(false);
      setError('Not logged in. Please sign in again.');
      return;
    }

    const loadMatches = async () => {
      try {
        setLoading(true);
        setError('');
        const response = await axios.get(`${API_BASE_URL}/get_matches`, {
          headers: { Authorization: `Bearer ${authToken}` }
        });
        setMatches(response.data.matches || []);
      } catch (err) {
        if (err.response && err.response.status === 401) {
          localStorage.removeItem('token');
          localStorage.removeItem('currentUser');
          setToken(null);
          setCurrentUser(null);
          setError('Your session has expired. Please sign in again.');
        } else {
          setError('Failed to load matches.');
        }
        console.error('Error loading matches:', err);
      } finally {
        setLoading(false);
      }
    };

    loadMatches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propToken, contextToken, setToken, setCurrentUser]);

  // ── Unmatch handler ─────────────────────────────────────────────────────────
  const handleUnmatch = async () => {
    if (!viewingProfile) return;

    const authToken = propToken || contextToken || localStorage.getItem('token');
    if (!authToken) return;

    try {
      await axios.post(
        `${API_BASE_URL}/remove_match`,
        {
          session_id: viewingProfile.session_id,
          partner_id: viewingProfile.partner_id,
        },
        { headers: { Authorization: `Bearer ${authToken}` } }
      );

      // Remove from local list
      setMatches((prev) =>
        prev.filter((m) => m.session_id !== viewingProfile.session_id)
      );
      setViewingProfile(null);
    } catch (err) {
      console.error('Error unmatching:', err);
      // Re-enable the button by resetting — the modal needs to know to re-show the button
      // We force-close and reopen by briefly nulling then restoring
      setViewingProfile(null);
      setTimeout(() => {
        setViewingProfile({
          partner_id: viewingProfile.partner_id,
          partner_username: viewingProfile.partner_username,
          session_id: viewingProfile.session_id,
        });
      }, 50);
    }
  };

  return (
    <>
      <div className="matches-page-overlay">
        <div className="matches-page">
          <div className="matches-page-header">
            <h2 className="matches-page-title">💕 Your Matches</h2>
            <button className="matches-close-btn" onClick={onClose}>✕</button>
          </div>

          {loading && (
            <div className="matches-loading">
              <div className="matches-spinner"></div>
              <p>Loading your matches...</p>
            </div>
          )}

          {error && <p className="matches-error">{error}</p>}

          {!loading && !error && matches.length === 0 && (
            <div className="matches-empty">
              <div className="matches-empty-icon">💔</div>
              <h3>No matches yet</h3>
              <p>Complete a full session with someone to unlock a private chat room!</p>
            </div>
          )}

          {!loading && matches.length > 0 && (
            <div className="matches-list">
              {matches.map((match) => (
                <div key={match.partner_id} className="match-card">
                  {/* Avatar */}
                  <div className="match-card-avatar">
                    <Avatar
                      src={match.partner_image ? (match.partner_image.startsWith('http') ? match.partner_image : `${API_BASE_URL}${match.partner_image}`) : null}
                      alt={match.partner_username}
                      placeholder={match.partner_username ? match.partner_username[0].toUpperCase() : '?'}
                      imgClass="match-card-img"
                      fallbackClass="match-card-avatar-placeholder"
                    />
                    <div className="match-card-online-dot"></div>
                  </div>

                  {/* Info — clicking opens chat */}
                  <div className="match-card-info" onClick={() => onOpenChat(match)} style={{ cursor: 'pointer' }}>
                    <h3 className="match-card-name">{match.partner_username}</h3>
                    <p className="match-card-meta">Age {match.partner_age} • Matched {new Date(match.matched_at).toLocaleDateString()}</p>
                    {match.last_message ? (
                      <p className="match-card-last-msg">{match.last_message}</p>
                    ) : (
                      <p className="match-card-last-msg muted">Say hello! 👋</p>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="match-card-actions">
                    <button
                      className="match-card-profile-btn"
                      onClick={() => setViewingProfile({ partner_id: match.partner_id, partner_username: match.partner_username, session_id: match.session_id })}
                      title="View profile"
                    >
                      👤
                    </button>
                    <button
                      className="match-card-chat-btn"
                      onClick={() => onOpenChat(match)}
                      title="Open chat"
                    >
                      💬
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Partner profile modal */}
      {viewingProfile && (
        <PartnerProfileModal
          partnerId={viewingProfile.partner_id}
          partnerUsername={viewingProfile.partner_username}
          sessionId={viewingProfile.session_id}
          onClose={() => setViewingProfile(null)}
          onUnmatch={handleUnmatch}
        />
      )}
    </>
  );
};

export default MatchesPage;
