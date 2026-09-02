import React, { useState, useEffect, useRef, useCallback, useContext } from 'react';
import axios from 'axios';
import { UserContext } from './UserContext';
import API_BASE_URL from '../config';
import Avatar from './Avatar';
import PartnerProfileModal from './PartnerProfileModal';
import ReportModal from './ReportModal';

// Helper: clear all auth state on token expiry / invalidity
const clearAuthState = (setToken, setCurrentUser) => {
  localStorage.removeItem('token');
  localStorage.removeItem('currentUser');
  localStorage.removeItem('profileImageUrl');
  setToken(null);
  setCurrentUser(null);
};

// ─── Private Match Chat Room ───────────────────────────────────────────────
// Shown when a user opens a chat with one of their successful matches.
// Features:
//   • Real-time text messaging (socket + REST fallback)
//   • Request a video call  → partner gets a pop-up to accept/decline
//   • Request a phone call  → partner gets a pop-up to accept/decline
//   • Incoming call pop-ups handled here too
// ──────────────────────────────────────────────────────────────────────────

const MatchChatRoom = ({ currentUser, match, socket, onClose, onStartVideoCall, onStartPhoneCall }) => {
  const { token: ctxToken, setToken, setCurrentUser } = useContext(UserContext);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [incomingCall, setIncomingCall] = useState(null); // { type: 'video'|'phone', from: username }
  const [callPending, setCallPending] = useState(false);  // waiting for partner to accept
  const [viewingProfile, setViewingProfile] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const messagesEndRef = useRef(null);

  // ── Load history ──────────────────────────────────────────────────────────
  const loadMessages = useCallback(async () => {
    try {
      const authToken = ctxToken || localStorage.getItem('token');
      if (!authToken) return;
      const response = await axios.get(
        `${API_BASE_URL}/get_messages?partner_id=${match.partner_id}`,
        { headers: { Authorization: `Bearer ${authToken}` } }
      );
      if (response.data?.messages) {
        setMessages(response.data.messages);
      }
    } catch (err) {
      // If the token is expired or invalid, clear all auth state so App
      // returns to the auth screen automatically.
      if (err.response && err.response.status === 401) {
        clearAuthState(setToken, setCurrentUser);
      }
      console.error('Error loading messages:', err);
    }
  }, [match.partner_id, ctxToken, setToken, setCurrentUser]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // ── Socket listeners ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const handleNewMessage = (msg) => {
      // Only show messages that belong to this conversation
      if (
        (msg.sender_id === match.partner_id && msg.receiver_id === currentUser.id) ||
        (msg.sender_id === currentUser.id && msg.receiver_id === match.partner_id)
      ) {
        setMessages((prev) => [...prev, msg]);
      }
    };

    const handleMatchCallRequest = (data) => {
      if (data.from_user_id === match.partner_id) {
        setIncomingCall({ type: data.call_type, from: match.partner_username });
      }
    };

    const handleMatchCallAccepted = (data) => {
      setCallPending(false);
      if (data.call_type === 'video') {
        onStartVideoCall(match.partner_id);
      } else {
        onStartPhoneCall(match.partner_id);
      }
    };

    const handleMatchCallDeclined = () => {
      setCallPending(false);
      alert(`${match.partner_username} declined your call.`);
    };

    socket.on('new_message', handleNewMessage);
    socket.on('match_call_request', handleMatchCallRequest);
    socket.on('match_call_accepted', handleMatchCallAccepted);
    socket.on('match_call_declined', handleMatchCallDeclined);

    return () => {
      socket.off('new_message', handleNewMessage);
      socket.off('match_call_request', handleMatchCallRequest);
      socket.off('match_call_accepted', handleMatchCallAccepted);
      socket.off('match_call_declined', handleMatchCallDeclined);
    };
  }, [socket, match, currentUser, onStartVideoCall, onStartPhoneCall]);

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const sendMessage = async () => {
    const text = newMessage.trim();
    if (!text) return;
    const authToken = ctxToken || localStorage.getItem('token');
    try {
      await axios.post(
        `${API_BASE_URL}/send_message`,
        { text, receiver_id: match.partner_id },
        { headers: { Authorization: `Bearer ${authToken}` } }
      );
      setMessages((prev) => [
        ...prev,
        { sender_id: currentUser.id, receiver_id: match.partner_id, text, timestamp: new Date().toISOString() },
      ]);
      setNewMessage('');
    } catch (err) {
      console.error('Error sending message:', err);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ── Call requests ─────────────────────────────────────────────────────────
  const requestCall = (callType) => {
    if (!socket) return;
    setCallPending(true);
    socket.emit('match_call_request', {
      to_user_id: match.partner_id,
      from_user_id: currentUser.id,
      from_username: currentUser.username,
      call_type: callType,
    });
  };

  const acceptCall = () => {
    if (!socket || !incomingCall) return;
    socket.emit('match_call_response', {
      to_user_id: match.partner_id,
      from_user_id: currentUser.id,
      call_type: incomingCall.type,
      accepted: true,
    });
    const type = incomingCall.type;
    setIncomingCall(null);
    if (type === 'video') {
      onStartVideoCall(match.partner_id);
    } else {
      onStartPhoneCall(match.partner_id);
    }
  };

  const declineCall = () => {
    if (!socket || !incomingCall) return;
    socket.emit('match_call_response', {
      to_user_id: match.partner_id,
      from_user_id: currentUser.id,
      call_type: incomingCall.type,
      accepted: false,
    });
    setIncomingCall(null);
  };

  // ── Unmatch handler ──────────────────────────────────────────────────────────
  const handleMatchUnmatch = async () => {
    const authToken = ctxToken || localStorage.getItem('token');
    if (!authToken) return;

    try {
      await axios.post(
        `${API_BASE_URL}/remove_match`,
        {
          session_id: match.session_id,
          partner_id: match.partner_id,
        },
        { headers: { Authorization: `Bearer ${authToken}` } }
      );
      onClose(); // close the chat room after unmatching
    } catch (err) {
      console.error('Error unmatching:', err);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="match-chatroom-overlay">
      <div className="match-chatroom">

        {/* Header */}
        <div className="match-chatroom-header">
          <button className="match-chatroom-back" onClick={onClose}>‹</button>
          <div className="match-chatroom-partner">
            <div className="match-chatroom-avatar">
              <Avatar
                src={match.partner_image ? (match.partner_image.startsWith('http') ? match.partner_image : `${API_BASE_URL}${match.partner_image}`) : null}
                alt={match.partner_username}
                placeholder={match.partner_username?.[0]?.toUpperCase() || '?'}
                imgClass="match-chatroom-avatar-img"
                fallbackClass="match-chatroom-avatar-fallback"
              />
            </div>
            <div>
              <h3
              className="match-chatroom-name"
              onClick={() => setViewingProfile(true)}
              style={{ cursor: 'pointer' }}
              title="View profile"
            >
              {match.partner_username}
            </h3>
              <p className="match-chatroom-sub">Private match chat</p>
            </div>
          </div>
          <div className="match-chatroom-call-btns">
            <button
              className="match-call-btn phone"
              onClick={() => requestCall('phone')}
              disabled={callPending}
              title="Request phone call"
            >
              📞
            </button>
            <button
              className="match-call-btn video"
              onClick={() => requestCall('video')}
              disabled={callPending}
              title="Request video call"
            >
              📹
            </button>
            <button
              onClick={() => setShowReportModal(true)}
              style={{background:"rgba(255,60,60,0.15)",border:"1px solid rgba(255,60,60,0.3)",color:"#ff6b6b",borderRadius:"6px",padding:"4px 8px",fontSize:"11px",cursor:"pointer",fontWeight:600,display:"flex",alignItems:"center",gap:"3px"}}
              title="Report this user"
            >
              🚩
            </button>
          </div>
        </div>

        {/* Pending call notice */}
        {callPending && (
          <div className="match-call-pending">
            <div className="match-call-pending-spinner"></div>
            <span>Waiting for {match.partner_username} to accept your call…</span>
            <button
              className="match-call-cancel"
              onClick={() => {
                setCallPending(false);
                socket?.emit('match_call_cancel', { to_user_id: match.partner_id });
              }}
            >
              Cancel
            </button>
          </div>
        )}

        {/* Incoming call pop-up */}
        {incomingCall && (
          <div className="match-incoming-call">
            <div className="match-incoming-icon">{incomingCall.type === 'video' ? '📹' : '📞'}</div>
            <p className="match-incoming-text">
              <strong>{incomingCall.from}</strong> is calling you ({incomingCall.type} call)
            </p>
            <div className="match-incoming-actions">
              <button className="match-accept-btn" onClick={acceptCall}>✅ Accept</button>
              <button className="match-decline-btn" onClick={declineCall}>❌ Decline</button>
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="match-chatroom-messages">
          {messages.length === 0 && (
            <div className="match-chatroom-empty">
              <p>No messages yet. Say something! 👋</p>
            </div>
          )}
          {messages.map((msg, idx) => {
            const isMine = msg.sender_id === currentUser.id;
            return (
              <div key={idx} className={`match-msg ${isMine ? 'mine' : 'theirs'}`}>
                <div className="match-msg-bubble">{msg.text}</div>
                <div className="match-msg-time">
                  {msg.timestamp
                    ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : ''}
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="match-chatroom-input">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={`Message ${match.partner_username}…`}
          />
          <button onClick={sendMessage} disabled={!newMessage.trim()}>
            Send
          </button>
        </div>
      </div>

      {/* Partner profile modal — shown when clicking the partner's name */}
      {viewingProfile && (
        <PartnerProfileModal
          partnerId={match.partner_id}
          partnerUsername={match.partner_username}
          sessionId={match.session_id}
          onClose={() => setViewingProfile(false)}
          onUnmatch={handleMatchUnmatch}
        />
      )}

      {/* Report Modal */}
      {showReportModal && (
        <ReportModal
          partnerId={match.partner_id}
          partnerUsername={match.partner_username}
          token={ctxToken || localStorage.getItem('token')}
          onClose={() => setShowReportModal(false)}
        />
      )}
    </div>
  );
};

export default MatchChatRoom;
