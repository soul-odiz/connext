import React, { useState, useContext, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import './App.css';
import { UserContext } from './components/UserContext';
import SignIn from './components/SignIn';
import SignUp from './components/SignUp';
import Profile from './components/Profile';
import Chat from './components/Chat';
import SetDateStage from './components/SetDateStage';
import SignOut from './components/SignOut';
import FaceFilter from './components/FaceFilter';
import { FILTERS, FILTER_IDS, DEFAULT_FILTER } from './components/FaceFiltersRegistry';
import MatchesPage from './components/MatchesPage';
import MatchChatRoom from './components/MatchChatRoom';
import API_BASE_URL from './config';

// ICE server config: Google STUN + optional TURN from env vars
// Defined at module level so it is a stable reference (no useCallback dependency issues)
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    ...(process.env.REACT_APP_TURN_URL ? [{
      urls: process.env.REACT_APP_TURN_URL,
      username: process.env.REACT_APP_TURN_USERNAME || '',
      credential: process.env.REACT_APP_TURN_CREDENTIAL || '',
    }] : []),
  ],
};

// Safe wrapper around getUserMedia that shows a clear error on non-HTTPS origins
const safeGetUserMedia = async (constraints) => {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const isHttps = window.location.protocol === 'https:';
    const msg = isHttps
      ? 'Camera/microphone access is not available in this browser.'
      : `Camera/microphone requires HTTPS.\n\nOpen the app at:\nhttps://${window.location.hostname}:3000\n\n(Accept the self-signed certificate warning on your device)`;
    alert(msg);
    throw new Error('getUserMedia not available');
  }
  return navigator.mediaDevices.getUserMedia(constraints);
};

const getJwtPayload = (jwtToken) => {
  try {
    const payload = jwtToken.split('.')[1];
    const normalizedPayload = payload.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(window.atob(normalizedPayload));
  } catch (error) {
    return null;
  }
};

// Flow stages:
// 0 - Auth screen
// 1 - Lobby (match button)
// 2 - In queue (waiting counter)
// 3 - Match found! 30s preparation
// 4 - Audio call (1.5 min, turn-based 45s each)
// 5 - Video call with filters (3 min counter)
// 6 - Filters off + Set Date button
// 7 - Completed

function App() {
  const { currentUser, setCurrentUser, token, setToken } = useContext(UserContext);
  const [isLoading, setIsLoading] = useState(false);
  const [currentStage, setCurrentStage] = useState(0);
  const [socket, setSocket] = useState(null);
  const [queueTime, setQueueTime] = useState(0);
  const [prepTimeLeft, setPrepTimeLeft] = useState(30);
  const [audioCallTimeLeft, setAudioCallTimeLeft] = useState(90);
  const [videoCallTimeLeft, setVideoCallTimeLeft] = useState(180);
  const [isMyTurnToSpeak, setIsMyTurnToSpeak] = useState(false);
  const isMyTurnRef = useRef(false);
  const [firstSpeakerId, setFirstSpeakerId] = useState(null);
  const [partnerId, setPartnerId] = useState(null);
  const [partnerUsername, setPartnerUsername] = useState('');
  const [partnerAge, setPartnerAge] = useState(null);
  const [partnerImage, setPartnerImage] = useState(null);
  const [isChatVisible, setIsChatVisible] = useState(false);
  const [remoteStream, setRemoteStream] = useState(null);
  const [remoteVolume, setRemoteVolume] = useState(1.0);
  const [muteTimer, setMuteTimer] = useState(null);
  const localVideoRef = useRef();   // used for video element in stage 5/6
  const localAudioRef = useRef();   // used for audio element in stage 4
  const remoteVideoRef = useRef();
  const peerConnection = useRef(null);
  const [isFilterEnabled, setIsFilterEnabled] = useState(true);
  const [, setLocalStream] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const queueTimerRef = useRef(null);
  const pendingIceCandidatesRef = useRef([]);
  const [showSetDateScreen, setShowSetDateScreen] = useState(false);
  const [filterType, setFilterType] = useState(DEFAULT_FILTER);
  const [isVideoPanelMinimized, setIsVideoPanelMinimized] = useState(false);

  // Matches page & chat room state
  const [showMatchesPage, setShowMatchesPage] = useState(false);
  const [activeChatMatch, setActiveChatMatch] = useState(null); // the match object currently open in chat
  // Match room call state (video/phone call initiated from match chat room)
  const [matchRoomCallType, setMatchRoomCallType] = useState(null); // 'video' | 'phone'
  // matchRoomPartnerId tracks the partner for the active match-room call
  const matchRoomPartnerIdRef = useRef(null);
  const matchRoomLocalVideoRef = useRef();
  const matchRoomRemoteVideoRef = useRef();
  const matchRoomPeerConnection = useRef(null);
  const [matchRoomRemoteStream, setMatchRoomRemoteStream] = useState(null);
  const [showMatchRoomCall, setShowMatchRoomCall] = useState(false);

  // Connect to socket on mount
  useEffect(() => {
    const newSocket = io(API_BASE_URL);
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('Connected to socket server');
      // Register session when we connect (pass JWT token for auth)
      if (currentUser && currentUser.id) {
        const tok = localStorage.getItem('token');
        newSocket.emit('register_session', { user_id: currentUser.id, token: tok });
      }
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from socket server');
    });

    return () => {
      newSocket.off('connect');
      newSocket.off('disconnect');
      newSocket.close();
    };
  }, [currentUser]);

  // Register session when user logs in (pass JWT token for auth)
  useEffect(() => {
    if (socket && currentUser && currentUser.id) {
      const tok = token || localStorage.getItem('token');
      socket.emit('register_session', { user_id: currentUser.id, token: tok });
    }
  }, [socket, currentUser, token]);

  // Listen for match events
  useEffect(() => {
    if (!socket) return;

    socket.on('queue_joined', (data) => {
      console.log('Queue joined:', data);
      setCurrentStage(2);
      // Start queue timer
      queueTimerRef.current = setInterval(() => {
        setQueueTime(prev => prev + 1);
      }, 1000);
    });

    socket.on('queue_status', (data) => {
      console.log('Queue status:', data);
    });

    socket.on('queue_error', (data) => {
      console.error('Queue error:', data);
      alert(data.message);
      setCurrentStage(1);
      setIsLoading(false);
    });

    socket.on('match_found', (data) => {
      console.log('Match found!', data);
      // Stop queue timer
      if (queueTimerRef.current) {
        clearInterval(queueTimerRef.current);
        queueTimerRef.current = null;
      }
      setQueueTime(0);
      
      // Set session info
      setSessionId(data.session_id);
      setPartnerId(data.partner_id);
      setPartnerUsername(data.partner_username);
      setPartnerAge(data.partner_age);
      setFirstSpeakerId(data.first_speaker_id);
      setPrepTimeLeft(data.preparation_time || 30);
      // Capture partner profile image
      if (data.partner_image) {
        setPartnerImage(data.partner_image);
      }
      
      // Go to preparation stage
      setCurrentStage(3);
    });

    socket.on('audio_call_started', (data) => {
      console.log('Audio call started:', data);
      setIsMyTurnToSpeak(data.speaking_user_id === currentUser.id);
      setAudioCallTimeLeft(90);
      setCurrentStage(4);
    });

    socket.on('audio_turn_swapped', (data) => {
      console.log('Audio turn swapped:', data);
      setIsMyTurnToSpeak(data.speaking_user_id === currentUser.id);
    });

    socket.on('video_call_started', (data) => {
      console.log('Video call started:', data);
      setIsFilterEnabled(true);
      setVideoCallTimeLeft(data.duration || 180);
      setCurrentStage(5);
    });

    socket.on('filters_removed', (data) => {
      console.log('Filters removed:', data);
      setIsFilterEnabled(false);
      setCurrentStage(6);
    });

    socket.on('date_proposed', (data) => {
      alert(data.message);
    });

    socket.on('video_chat_offer', async (data) => {
      console.log('Received video_chat_offer:', data);
      const pc = peerConnection.current;
      if (!pc) {
        console.error('No peer connection for incoming video offer');
        return;
      }
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        await flushPendingIceCandidates(pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('video_chat_answer', {
          answer: pc.localDescription,
          from_user_id: currentUser.id,
          room: String(data.from_user_id || data.room || partnerId)
        });
        console.log('Video answer sent');
      } catch (err) {
        console.error('Error handling video_chat_offer:', err);
      }
    });

    socket.on('video_chat_answer', async (data) => {
      const pc = peerConnection.current;
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        await flushPendingIceCandidates(pc);
      } catch (err) {
        console.error('Error setting video answer:', err);
      }
    });

    socket.on('audio_call_offer', async (data) => {
      console.log('Received audio_call_offer:', data);
      const offererId = data.from_user_id || data.partner_id || partnerId;
      createPeerConnection(offererId);
      const pc = peerConnection.current;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        await flushPendingIceCandidates(pc);
        const stream = await safeGetUserMedia({ audio: true });
        if (localAudioRef.current) {
          localAudioRef.current.srcObject = stream;
        }
        stream.getTracks().forEach(track => {
          if (pc.signalingState !== 'closed') {
            pc.addTrack(track, stream);
          }
        });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('audio_call_answer', { answer, partner_id: String(offererId) });
      } catch (err) {
        console.error('Error handling audio_call_offer:', err);
      }
    });

    socket.on('audio_call_answer', async (data) => {
      console.log('Received audio_call_answer:', data);
      const pc = peerConnection.current;
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        await flushPendingIceCandidates(pc);
      } catch (err) {
        console.error('Error setting audio answer:', err);
      }
    });

    socket.on('ice_candidate', async (data) => {
      console.log('REMOTE ICE RECEIVED:', data.candidate?.type, data.candidate?.protocol, data.candidate?.address);
      const candidate = new RTCIceCandidate(data.candidate);
      const pc = peerConnection.current;
      if (!pc || !pc.remoteDescription) {
        console.log('Queueing ICE candidate');
        pendingIceCandidatesRef.current.push(candidate);
        return;
      }
      try {
        await pc.addIceCandidate(candidate);
        console.log('REMOTE ICE ADDED:', candidate.type, candidate.protocol, candidate.address);
      } catch (err) {
        console.error('Error adding ICE candidate:', err);
      }
    });

    socket.on('queue_left', (data) => {
      console.log('Left queue:', data);
      setCurrentStage(1);
    });

    return () => {
      socket.off('queue_joined');
      socket.off('queue_status');
      socket.off('queue_error');
      socket.off('match_found');
      socket.off('audio_call_started');
      socket.off('audio_turn_swapped');
      socket.off('video_call_started');
      socket.off('filters_removed');
      socket.off('date_proposed');
      socket.off('video_chat_offer');
      socket.off('video_chat_answer');
      socket.off('audio_call_offer');
      socket.off('audio_call_answer');
      socket.off('ice_candidate');
      socket.off('queue_left');
    };
  }, [socket, currentUser]);

  // Preparation countdown timer (stage 3)
  useEffect(() => {
    if (currentStage === 3 && prepTimeLeft > 0) {
      const interval = setInterval(() => {
        setPrepTimeLeft(prev => {
          if (prev <= 1) {
            // Time's up! Start the audio call
            if (socket && sessionId) {
              socket.emit('start_audio_call', { session_id: sessionId });
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [currentStage, prepTimeLeft, socket, sessionId]);

  // Audio call timer (stage 4) - 1.5 minutes total
  useEffect(() => {
    if (currentStage === 4 && audioCallTimeLeft > 0) {
      const interval = setInterval(() => {
        setAudioCallTimeLeft(prev => {
          if (prev <= 1) {
            // Audio call phase is over, move to video
            if (socket && sessionId) {
              socket.emit('end_audio_call_phase', { session_id: sessionId });
            }
            return 0;
          }
          // Check if 45 seconds have passed for one speaker (swap at 45s remaining mark)
          // Only the current speaker requests the swap to prevent double-swapping
          if (prev === 45 && socket && sessionId && firstSpeakerId && isMyTurnRef.current) {
            socket.emit('request_turn_swap', { session_id: sessionId });
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [currentStage, audioCallTimeLeft, socket, sessionId, firstSpeakerId]);

  // Video call timer (stage 5) - 3 minutes
  useEffect(() => {
    if (currentStage === 5 && videoCallTimeLeft > 0) {
      const interval = setInterval(() => {
        setVideoCallTimeLeft(prev => {
          if (prev <= 1) {
            // Video call phase is over, remove filters
            if (socket && sessionId) {
              socket.emit('end_video_call_phase', { session_id: sessionId });
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [currentStage, videoCallTimeLeft, socket, sessionId]);

  // Sync isMyTurnRef with isMyTurnToSpeak so timer closures read the current value
  useEffect(() => {
    isMyTurnRef.current = isMyTurnToSpeak;
  }, [isMyTurnToSpeak]);

  // Initial auth check
  useEffect(() => {
    if (currentUser && token) {
      setCurrentStage(1);
    } else {
      setCurrentStage(0);
    }
  }, [currentUser, token]);

  const flushPendingIceCandidates = async (pc) => {
    while (pendingIceCandidatesRef.current.length > 0) {
      const candidate = pendingIceCandidatesRef.current.shift();
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        console.error('Error adding queued ICE candidate:', err);
      }
    }
  };

  const createPeerConnection = useCallback((partnerIdForCall) => {
    if (peerConnection.current) {
      peerConnection.current.close();
    }
    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnection.current = pc;

    console.log('PC CREATED', 'signaling=', pc.signalingState, 'ice=', pc.iceConnectionState, 'gathering=', pc.iceGatheringState, 'connection=', pc.connectionState);

    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        console.log('ICE gathering finished');
        return;
      }
      console.log('LOCAL ICE:', event.candidate.type, event.candidate.protocol, event.candidate.address);
      if (socket) {
        socket.emit('ice_candidate', { candidate: event.candidate, partner_id: String(partnerIdForCall) });
      }
    };

    pc.onicecandidateerror = (event) => {
      console.error('ICE candidate error:', event.errorCode, event.errorText, event.url);
    };

    pc.onicegatheringstatechange = () => {
      console.log('ICE gathering state:', pc.iceGatheringState);
    };

    pc.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', pc.iceConnectionState);
    };

    pc.onconnectionstatechange = () => {
      console.log('RTCPeerConnection state:', pc.connectionState);
      if (pc.connectionState === 'connected') {
        setTimeout(async () => {
          const stats = await pc.getStats();
          stats.forEach(report => {
            if (report.type === 'inbound-rtp') {
              console.log('RTP IN:', report.kind || report.mediaType, 'bytes=', report.bytesReceived, 'packets=', report.packetsReceived, 'lost=', report.packetsLost, 'frames=', report.framesDecoded);
            }
          });
        }, 3000);
      }
    };

    pc.ontrack = (event) => {
      console.log('Remote track received:', event.track.kind, 'readyState:', event.track.readyState, 'muted:', event.track.muted);
      event.track.onunmute = () => console.log('Remote track UNMUTED:', event.track.kind);
      event.track.onmute = () => console.log('Remote track MUTED:', event.track.kind);
      setRemoteStream(event.streams[0]);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    return pc;
  }, [socket]);

  // Local video stream
  const startLocalStream = useCallback(() => {
    safeGetUserMedia({ video: true, audio: true })
      .then((stream) => {
        setLocalStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        // Auto-toggle mute every 45 seconds
        const timer = setInterval(() => {
          const audioTracks = stream.getAudioTracks();
          if (audioTracks.length > 0) {
            audioTracks[0].enabled = !audioTracks[0].enabled;
          }
        }, 45000);
        setMuteTimer(timer);
      })
      .catch((err) => console.error('Error accessing media devices:', err));
  }, []);

  useEffect(() => {
    return () => {
      if (muteTimer) {
        clearInterval(muteTimer);
      }
    };
  }, [muteTimer]);

  const toggleMute = () => {
    if (localVideoRef.current && localVideoRef.current.srcObject) {
      const audioTracks = localVideoRef.current.srcObject.getAudioTracks();
      if (audioTracks.length > 0) {
        audioTracks[0].enabled = !audioTracks[0].enabled;
      }
    }
  };

  const handleFindMatch = () => {
    setIsLoading(true);
    if (socket) {
      const tok = token || localStorage.getItem('token');
      socket.emit('join_match_queue', { user_id: currentUser.id, token: tok });
    } else {
      alert('Not connected to server');
      setIsLoading(false);
    }
  };

  const handleLeaveQueue = () => {
    if (socket) {
      socket.emit('leave_match_queue', { user_id: currentUser.id });
    }
    if (queueTimerRef.current) {
      clearInterval(queueTimerRef.current);
      queueTimerRef.current = null;
    }
    setQueueTime(0);
    setIsLoading(false);
  };

  const handleReadyForCall = () => {
    // Start WebRTC audio call - only offerer creates offer (deterministic: smaller id)
    const amIOfferer = Number(currentUser?.id) < Number(partnerId);
    if (partnerId && socket && amIOfferer) {
      createPeerConnection(partnerId);
      safeGetUserMedia({ audio: true })
        .then(stream => {
          if (localAudioRef.current) {
            localAudioRef.current.srcObject = stream;
          }
          stream.getTracks().forEach(track => {
            if (peerConnection.current && peerConnection.current.signalingState !== 'closed') {
              peerConnection.current.addTrack(track, stream);
            }
          });
          return peerConnection.current.createOffer();
        })
        .then(offer => peerConnection.current.setLocalDescription(offer))
        .then(() => {
          socket.emit('audio_call_offer', {
            offer: peerConnection.current.localDescription,
            from_user_id: currentUser.id,
            partner_id: String(partnerId)
          });
        })
        .catch(err => console.error('Error setting up audio call:', err));
    }
    socket.emit('start_audio_call', { session_id: sessionId });
  };

  const startVideoCall = useCallback(async () => {
    if (!partnerId || !socket) return;
    const amIOfferer = Number(currentUser?.id) < Number(partnerId);
    try {
      const stream = await safeGetUserMedia({ video: true, audio: true });
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      setLocalStream(stream);
      // BOTH users create PC and add local tracks
      const pc = createPeerConnection(partnerId);
      stream.getTracks().forEach((track) => {
        if (pc.signalingState !== 'closed') {
          pc.addTrack(track, stream);
        }
      });
      // Only the offerer creates the SDP offer
      if (!amIOfferer) return;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('video_chat_offer', {
        offer: pc.localDescription,
        from_user_id: currentUser.id,
        room: String(partnerId)
      });
    } catch (error) {
      console.error('Error starting video call:', error);
    }
  }, [createPeerConnection, socket, partnerId, currentUser]);

  // Start video call when entering stage 5
  useEffect(() => {
    if (currentStage === 5) {
      startVideoCall();
    }
  }, [currentStage, startVideoCall]);

  useEffect(() => {
    const el = remoteVideoRef.current;
    if (el && remoteStream) {
      // Only set srcObject if it changed (prevents aborting an in-progress play)
      if (el.srcObject !== remoteStream) {
        el.srcObject = remoteStream;
      }
      // Always try to play — browser may block autoplay for unmuted audio
      el.play().then(() => {
        console.log('Remote media play started successfully');
      }).catch(err => {
        console.error('Remote play error:', err.name, err.message);
        // If NotAllowedError, schedule a retry after a short delay
        if (err.name === 'NotAllowedError') {
          setTimeout(() => {
            if (el.paused) el.play().catch(() => {});
          }, 500);
        }
      });
    }
  }, [remoteStream, currentStage]);

  const updateProfile = async (profileData) => {
    try {
      const activeToken = token || localStorage.getItem('token');
      if (!activeToken) {
        alert('Your session is missing. Please sign in again.');
        return;
      }

      const tokenPayload = getJwtPayload(activeToken);
      if (!tokenPayload || typeof tokenPayload.sub !== 'string') {
        localStorage.removeItem('token');
        localStorage.removeItem('currentUser');
        setToken(null);
        setCurrentUser(null);
        alert('Your saved session is outdated. Please sign in again, then update your profile.');
        return;
      }

      const response = await axios.post(`${API_BASE_URL}/update_profile`, profileData, {
        headers: { Authorization: `Bearer ${activeToken}` }
      });
      setCurrentUser(response.data.updatedUser);
      localStorage.setItem('currentUser', JSON.stringify(response.data.updatedUser));
    } catch (error) {
      if (error.response && error.response.data) {
        const serverMessage = error.response.data.message || error.response.data.msg || 'Profile update failed.';
        console.error('Profile update failed:', error.response.status, error.response.data);

        if (error.response.status === 422 && serverMessage.includes('Subject must be a string')) {
          localStorage.removeItem('token');
          localStorage.removeItem('currentUser');
          setToken(null);
          setCurrentUser(null);
          alert('Your saved session is outdated. Please sign in again, then update your profile.');
          return;
        }

        alert(serverMessage);
      } else {
        console.error('Profile update failed:', error);
        alert('Profile update failed. Please try again.');
      }
    }
  };

  const handleSetDate = () => {
    setShowSetDateScreen(true);
  };

  const handleDateConfirmed = (dateData) => {
    if (socket && sessionId && partnerId) {
      socket.emit('date_set', { session_id: sessionId, partner_id: partnerId });
    }
    setShowSetDateScreen(false);
    setCurrentStage(7);
  };

  // ── Match room call handlers ──────────────────────────────────────────────
  const startMatchRoomVideoCall = useCallback(async (partnerIdForCall) => {
    matchRoomPartnerIdRef.current = partnerIdForCall;
    setMatchRoomCallType('video');
    setShowMatchRoomCall(true);

    if (matchRoomPeerConnection.current) {
      matchRoomPeerConnection.current.close();
    }
    const pc = new RTCPeerConnection(ICE_SERVERS);
    matchRoomPeerConnection.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('ice_candidate', { candidate: event.candidate, partner_id: String(partnerIdForCall) });
      }
    };
    pc.ontrack = (event) => {
      setMatchRoomRemoteStream(event.streams[0]);
    };

    try {
      const stream = await safeGetUserMedia({ video: true, audio: true });
      if (matchRoomLocalVideoRef.current) {
        matchRoomLocalVideoRef.current.srcObject = stream;
      }
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('video_chat_offer', { offer, room: String(partnerIdForCall) });
    } catch (err) {
      console.error('Match room video call error:', err);
    }
  }, [socket]);

  const startMatchRoomPhoneCall = useCallback(async (partnerIdForCall) => {
    matchRoomPartnerIdRef.current = partnerIdForCall;
    setMatchRoomCallType('phone');
    setShowMatchRoomCall(true);

    if (matchRoomPeerConnection.current) {
      matchRoomPeerConnection.current.close();
    }
    const pc = new RTCPeerConnection(ICE_SERVERS);
    matchRoomPeerConnection.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('ice_candidate', { candidate: event.candidate, partner_id: String(partnerIdForCall) });
      }
    };
    pc.ontrack = (event) => {
      setMatchRoomRemoteStream(event.streams[0]);
    };

    try {
      const stream = await safeGetUserMedia({ audio: true });
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('audio_call_offer', { offer, partner_id: String(partnerIdForCall) });
    } catch (err) {
      console.error('Match room phone call error:', err);
    }
  }, [socket]);

  const endMatchRoomCall = () => {
    if (matchRoomPeerConnection.current) {
      matchRoomPeerConnection.current.close();
      matchRoomPeerConnection.current = null;
    }
    matchRoomPartnerIdRef.current = null;
    setMatchRoomRemoteStream(null);
    setShowMatchRoomCall(false);
    setMatchRoomCallType(null);
  };

  // Sync match room remote stream to video element
  useEffect(() => {
    if (matchRoomRemoteVideoRef.current && matchRoomRemoteStream) {
      matchRoomRemoteVideoRef.current.srcObject = matchRoomRemoteStream;
    }
  }, [matchRoomRemoteStream]);

  const handleReturnToLobby = () => {
    // Clean up
    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }
    setSessionId(null);
    setPartnerId(null);
    setPartnerUsername('');
    setPartnerAge(null);
    setFirstSpeakerId(null);
    setIsMyTurnToSpeak(false);
    setRemoteStream(null);
    setLocalStream(null);
    setPartnerImage(null);
    setCurrentStage(1);
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // Sync remote volume to the audio element
  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.volume = remoteVolume;
    }
  }, [remoteVolume]);

  // ============ RENDER METHODS ============

  const renderAuthScreen = () => (
    <div className="case-zero">
      <div className="auth-forms">
        <SignIn />
        <SignUp />
      </div>
    </div>
  );

  const renderLobby = () => (
    <div className="case-one">
      <div className="users-lobby">
        <div className="lobby-content">
          <h2 className="lobby-title">Find Your Match</h2>
          <p className="lobby-subtitle">Press the button to enter the matching queue</p>
          <button 
            className="match-button pulse-animation" 
            onClick={handleFindMatch}
            disabled={isLoading}
          >
            {isLoading ? 'Connecting...' : 'Find a Match'}
          </button>
          <button
            className="my-matches-button"
            onClick={() => setShowMatchesPage(true)}
          >
            💕 My Matches
          </button>
          <p className="lobby-hint">You'll be matched anonymously based on your preferences</p>
        </div>
      </div>
    </div>
  );

  const renderQueue = () => (
    <div className="case-two">
      <div className="queue-container">
        <div className="queue-spinner"></div>
        <h2>Looking for a match...</h2>
        <div className="queue-timer">
          <div className="timer-display">{formatTime(queueTime)}</div>
          <p>Waiting time</p>
        </div>
        <button className="cancel-button" onClick={handleLeaveQueue}>
          Cancel
        </button>
      </div>
    </div>
  );

  const renderPreparation = () => (
    <div className="case-three">
      <div className="preparation-container">
        <div className="match-info">
          <div className="match-anonymous-avatar">
            {partnerImage ? (
              <img src={`${API_BASE_URL}${partnerImage}`} alt={partnerUsername} className="partner-profile-pic" />
            ) : (
              '?'
            )}
          </div>
          <h2>Match Found!</h2>
          <p className="partner-info-text">
            You've been matched with <strong>{partnerUsername}</strong>, Age {partnerAge}
          </p>
          <p className="preparation-subtitle">
            Get ready! You'll have 30 seconds to prepare before the audio call starts.
          </p>
          <div className="prep-timer">
            <div className="timer-ring">
              <svg width="120" height="120">
                <circle cx="60" cy="60" r="54" fill="none" stroke="#333" strokeWidth="4" />
                <circle 
                  cx="60" cy="60" r="54" fill="none" stroke="#ff6b6b" strokeWidth="4"
                  strokeDasharray={`${2 * Math.PI * 54}`}
                  strokeDashoffset={`${2 * Math.PI * 54 * (1 - prepTimeLeft / 30)}`}
                  transform="rotate(-90 60 60)"
                  style={{ transition: 'stroke-dashoffset 1s linear' }}
                />
              </svg>
              <div className="timer-center">{prepTimeLeft}</div>
            </div>
          </div>
          <button className="ready-button" onClick={handleReadyForCall}>
            I'm Ready!
          </button>
        </div>
      </div>
    </div>
  );

  const renderAudioCall = () => {
    return (
      <div className="case-four">
        <div className="audio-call-container">
          <div className="audio-visualizer">
            <div className="mic-icon">{isMyTurnToSpeak ? '🎤' : '🔇'}</div>
            <h2>{isMyTurnToSpeak ? 'Your Turn to Speak' : `${partnerUsername} is Speaking...`}</h2>
            <p className="turn-hint">
              {isMyTurnToSpeak 
                ? 'Introduce yourself! Tell your partner about who you are.'
                : 'Listen carefully! Your turn to speak will come.'}
            </p>
          </div>
          <div className="audio-timer">
            <div className="audio-timer-ring">
              <svg width="160" height="160">
                <circle cx="80" cy="80" r="72" fill="none" stroke="#333" strokeWidth="6" />
                <circle 
                  cx="80" cy="80" r="72" fill="none" 
                  stroke={isMyTurnToSpeak ? '#4ecdc4' : '#ff6b6b'} 
                  strokeWidth="6"
                  strokeDasharray={`${2 * Math.PI * 72}`}
                  strokeDashoffset={`${2 * Math.PI * 72 * (1 - audioCallTimeLeft / 90)}`}
                  transform="rotate(-90 80 80)"
                  style={{ transition: 'stroke-dashoffset 1s linear' }}
                />
              </svg>
              <div className="audio-timer-text">
                <div className="time">{formatTime(audioCallTimeLeft)}</div>
                <div className="time-label">remaining</div>
              </div>
            </div>
          </div>
          <div className="audio-call-stage-info">
            <p>Audio Call • Phase {audioCallTimeLeft <= 45 ? '2/2' : '1/2'}</p>
            {isMyTurnToSpeak && <p className="speaking-hint">You are unmuted - speak now</p>}
            {!isMyTurnToSpeak && <p className="muted-hint">You are muted - listen to your partner</p>}
          </div>
          {/* Volume slider for partner audio */}
          <div className="volume-slider-wrapper">
            <label className="volume-slider-label">🔊 Volume</label>
            <input type="range" min="0" max="1" step="0.05" value={remoteVolume}
              onChange={(e) => setRemoteVolume(parseFloat(e.target.value))} className="volume-slider" />
          </div>
          {/* Hang up button - icon only */}
          <div className="audio-hangup-wrapper">
            <button className="hangup-button" onClick={handleReturnToLobby} title="End call">📞</button>
          </div>
        </div>
        <audio ref={localAudioRef} autoPlay muted />
        <audio ref={remoteVideoRef} autoPlay />
      </div>
    );
  };

  const renderVideoCall = () => {
    const threeMinutes = 180;
    const filtersPhase = videoCallTimeLeft > 0;
    const currentFilter = FILTERS[filterType];

    return (
      <div className="case-five">
        <div className="video-chat-stage">

          {/* ── Countdown timer — top center of screen ── */}
          <div className="video-timer-top">
            <svg width="56" height="56">
              <circle cx="28" cy="28" r="23" fill="none" stroke="rgba(0,212,255,0.15)" strokeWidth="3" />
              <circle
                cx="28" cy="28" r="23" fill="none" stroke="#ffd93d" strokeWidth="3"
                strokeDasharray={`${2 * Math.PI * 23}`}
                strokeDashoffset={`${2 * Math.PI * 23 * (1 - videoCallTimeLeft / threeMinutes)}`}
                transform="rotate(-90 28 28)"
                style={{ transition: 'stroke-dashoffset 1s linear' }}
              />
            </svg>
            <div className="video-timer-text">{formatTime(videoCallTimeLeft)}</div>
          </div>

          {/* ── Full-screen video grid ── */}
          <div className="video-grid">
            <div className="video-wrapper">
              <video className="video-con local-video" ref={localVideoRef} autoPlay playsInline muted></video>
              {isFilterEnabled && filtersPhase && <FaceFilter videoRef={localVideoRef} filterType={filterType} mirrored={true} />}
              <div className="video-label">You</div>
            </div>
            <div className="video-wrapper">
              <video className="video-con" ref={remoteVideoRef} autoPlay playsInline></video>
              <div className="video-label">{partnerUsername || 'Partner'}</div>
            </div>
          </div>

          {/* ── Floating side control panel ── */}
          <div className={`video-controls${isVideoPanelMinimized ? ' minimized' : ''}`}>

            {/* Minimize / expand toggle */}
            <button
              className="video-panel-toggle"
              onClick={() => setIsVideoPanelMinimized(v => !v)}
              title={isVideoPanelMinimized ? 'Expand controls' : 'Minimize controls'}
            >
              {isVideoPanelMinimized ? '‹' : '›'}
            </button>

            {!isVideoPanelMinimized && (
              <>
                <div className="video-panel-divider" />

                {/* Mic + Camera buttons */}
                <div className="video-buttons">
                  <button className="control-btn" onClick={toggleMute} title="Toggle Mic">🎤</button>
                  <button className="control-btn" onClick={startLocalStream} title="Restart Camera">📷</button>
                </div>

                <div className="video-panel-divider" />

                {/* Active filter badge */}
                <div className="filter-badge">
                  {isFilterEnabled && currentFilter ? `${currentFilter.icon} ${currentFilter.name}` : '🎭 Off'}
                </div>

                {/* Filter picker — floats to the left of the panel */}
                {filtersPhase && (
                  <div className="filter-selector">
                    <p className="filter-selector-label">Face filter</p>
                    <div className="filter-options">
                      {FILTER_IDS.map((fid) => {
                        const f = FILTERS[fid];
                        return (
                          <button
                            key={fid}
                            className={`filter-option-btn ${filterType === fid ? 'active' : ''}`}
                            onClick={() => setFilterType(fid)}
                            title={f.description}
                          >
                            <span className="filter-option-icon">{f.icon}</span>
                            <span className="filter-option-name">{f.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="video-panel-divider" />

                {/* Hint */}
                <p className="video-hint">
                  {filtersPhase ? 'Filters on' : 'Filters off'}
                </p>

                <div className="video-panel-divider" />

                {/* Hang up - icon only */}
                <button className="control-btn end-call" onClick={handleReturnToLobby} title="End call">📞</button>
              </>
            )}
          </div>

        </div>
      </div>
    );
  };

  const renderFiltersOff = () => (
    <div className="case-six">
      <div className="filters-off-container">

        {/* Full-screen video grid (reuses same refs) */}
        <div className="video-grid">
          <div className="video-wrapper">
            <video className="video-con local-video" ref={localVideoRef} autoPlay playsInline muted></video>
            <div className="video-label">You</div>
          </div>
          <div className="video-wrapper">
            <video className="video-con" ref={remoteVideoRef} autoPlay playsInline></video>
            <div className="video-label">{partnerUsername || 'Partner'}</div>
          </div>
        </div>

        {/* Floating reveal banner at the top */}
        <div className="reveal-animation">
          <div className="reveal-icon">👀</div>
          <h2>Filters Removed!</h2>
          <p className="reveal-text">
            You can now see each other. Set a date if you feel a connection!
          </p>
        </div>

        {/* Floating action buttons at the bottom center */}
        <div className="action-buttons" style={{
          position: 'absolute',
          bottom: '28px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 410,
          background: 'rgba(5,5,20,0.72)',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(0,212,255,0.2)',
          borderRadius: '50px',
          padding: '10px 20px',
          flexWrap: 'nowrap',
        }}>
          <button className="date-button" onClick={handleSetDate}>
            💕 Set a Date
          </button>
          <button className="lobby-button" onClick={handleReturnToLobby}>
            Back to Lobby
          </button>
        </div>

        {showSetDateScreen && (
          <div className="date-overlay">
            <SetDateStage
              onDateSet={handleDateConfirmed}
              onCancel={() => setShowSetDateScreen(false)}
            />
          </div>
        )}
      </div>
    </div>
  );

  const renderCompleted = () => (
    <div className="case-seven">
      <div className="completed-container">
        <div className="completed-icon">🎉</div>
        <h2>Date Set!</h2>
        <p className="completed-text">
          You've scheduled a date with {partnerUsername}. 
          Check your profile for the details!
        </p>
        <button className="lobby-button" onClick={handleReturnToLobby}>
          Back to Lobby
        </button>
      </div>
    </div>
  );

  const renderCurrentStage = () => {
    switch (currentStage) {
      case 0: return renderAuthScreen();
      case 1: return renderLobby();
      case 2: return renderQueue();
      case 3: return renderPreparation();
      case 4: return renderAudioCall();
      case 5: return renderVideoCall();
      case 6: return renderFiltersOff();
      case 7: return renderCompleted();
      default: return renderLobby();
    }
  };

  return (
    <div className="App">
      <div className="stars">
        {currentUser && <SignOut />}
        <h1 className="app-head">Connext</h1>
        {currentUser ? (
          <div className="user-dashboard">
            <Profile updateProfile={updateProfile} currentUser={currentUser} />
            <div className="main-stage">
              {renderCurrentStage()}
            </div>
            {currentStage >= 2 && currentStage <= 6 && (
              <button className="skip-button" onClick={() => setCurrentStage(prev => Math.min(prev + 1, 7))} style={{ marginTop: '10px', opacity: 0.5, fontSize: '12px' }}>
                Skip (dev)
              </button>
            )}
            {isChatVisible && <Chat socket={socket} currentUser={currentUser} closeChat={() => setIsChatVisible(false)} partnerId={partnerId} />}

            {/* Matches page overlay */}
            {showMatchesPage && !activeChatMatch && (
              <MatchesPage
                currentUser={currentUser}
                token={token || localStorage.getItem('token')}
                socket={socket}
                onClose={() => setShowMatchesPage(false)}
                onOpenChat={(match) => setActiveChatMatch(match)}
              />
            )}

            {/* Match chat room overlay */}
            {activeChatMatch && !showMatchRoomCall && (
              <MatchChatRoom
                currentUser={currentUser}
                token={token || localStorage.getItem('token')}
                match={activeChatMatch}
                socket={socket}
                onClose={() => setActiveChatMatch(null)}
                onStartVideoCall={startMatchRoomVideoCall}
                onStartPhoneCall={startMatchRoomPhoneCall}
              />
            )}

            {/* Match room active call overlay — full-screen, matches Stage 5 style */}
            {showMatchRoomCall && (
              <div className="match-room-call-overlay">
                <div className="match-room-call-container">

                  {/* Floating top-center header bar */}
                  <div className="match-room-call-header">
                    <span>{matchRoomCallType === 'video' ? '📹 Video Call' : '📞 Phone Call'}</span>
                    {activeChatMatch?.partner_username && (
                      <span style={{ color: 'rgba(255,255,255,0.7)', fontWeight: 400 }}>
                        with {activeChatMatch.partner_username}
                      </span>
                    )}
                    <button className="match-room-end-btn" onClick={endMatchRoomCall}>End Call</button>
                  </div>

                  {matchRoomCallType === 'video' ? (
                    /* Full-screen two-video grid */
                    <div className="match-room-video-grid">
                      <div className="match-room-video-wrapper">
                        <video ref={matchRoomLocalVideoRef} autoPlay playsInline muted className="match-room-video local-video" />
                        <div className="video-label">You</div>
                      </div>
                      <div className="match-room-video-wrapper">
                        <video ref={matchRoomRemoteVideoRef} autoPlay playsInline className="match-room-video" />
                        <div className="video-label">{activeChatMatch?.partner_username || 'Partner'}</div>
                      </div>
                    </div>
                  ) : (
                    /* Phone call — full-screen centered UI */
                    <div className="match-room-phone-ui">
                      <div className="match-room-phone-avatar">
                        {activeChatMatch?.partner_username?.[0]?.toUpperCase() || '?'}
                      </div>
                      <p className="match-room-phone-name">{activeChatMatch?.partner_username}</p>
                      <p className="match-room-phone-status">📞 Call in progress…</p>
                      <audio ref={matchRoomRemoteVideoRef} autoPlay />
                    </div>
                  )}

                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="case-zero">
            <div className="auth-forms">
              <SignIn />
              <SignUp />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;