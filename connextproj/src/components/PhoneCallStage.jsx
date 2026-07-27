import React, { useState, useEffect, useRef } from 'react';

// PhoneCallStage receives the shared socket from App.js instead of creating
// its own connection, which would cause duplicate sessions and registration
// conflicts with the match queue.

const PhoneCallStage = ({ partnerId, socket, onCallEnd }) => {
  const [timeLeft, setTimeLeft] = useState(45);
  const localAudioRef = useRef();
  const remoteAudioRef = useRef();
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
  const peerConnection = useRef(new RTCPeerConnection(ICE_SERVERS));

  useEffect(() => {
    if (timeLeft === 0) {
      onCallEnd();
      return;
    }

    const timer = setTimeout(() => {
      setTimeLeft(timeLeft - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [timeLeft, onCallEnd]);

  useEffect(() => {
    if (!socket) return;

    const pc = peerConnection.current;

    if (pc.signalingState === 'closed') {
      console.error('Peer connection is closed.');
      return;
    }

    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        if (localAudioRef.current) {
          localAudioRef.current.srcObject = stream;
        }
        stream.getTracks().forEach(track => pc.addTrack(track, stream));
      });

    pc.ontrack = event => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = event.streams[0];
      }
    };

    // Use snake_case partner_id to match the backend ice_candidate handler
    pc.onicecandidate = event => {
      if (event.candidate) {
        socket.emit('ice_candidate', { candidate: event.candidate, partner_id: String(partnerId) });
      }
    };

    const handleAudioCallOffer = async (data) => {
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      // Use snake_case partner_id to match the backend audio_call_answer handler
      socket.emit('audio_call_answer', { answer, partner_id: String(data.partner_id || partnerId) });
    };

    const handleAudioCallAnswer = (data) => {
      pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    };

    const handleIceCandidate = (data) => {
      pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    };

    socket.on('audio_call_offer', handleAudioCallOffer);
    socket.on('audio_call_answer', handleAudioCallAnswer);
    socket.on('ice_candidate', handleIceCandidate);

    // Start the call with an offer
    if (partnerId) {
      pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .then(() => {
          socket.emit('audio_call_offer', { offer: pc.localDescription, partner_id: String(partnerId) });
        })
        .catch(error => console.error('Error creating offer:', error));
    }

    return () => {
      socket.off('audio_call_offer', handleAudioCallOffer);
      socket.off('audio_call_answer', handleAudioCallAnswer);
      socket.off('ice_candidate', handleIceCandidate);
      pc.close();
    };
  }, [partnerId, socket]);

  const handleEndCall = () => {
    if (peerConnection.current.signalingState !== 'closed') {
      peerConnection.current.close();
    }
    onCallEnd();
  };

  return (
    <div className='case-three'>
      <div className="phone-call-stage">
        <div className="partner-info">
          <h2>Calling... {partnerId}</h2>
          <p>{timeLeft} seconds remaining</p>
        </div>
        <div className="controls">
          <button className="button end-call" onClick={handleEndCall}>
            End Call
          </button>
        </div>
        <audio ref={localAudioRef} autoPlay muted />
        <audio ref={remoteAudioRef} autoPlay />
      </div>
    </div>
  );
};

export default PhoneCallStage;
