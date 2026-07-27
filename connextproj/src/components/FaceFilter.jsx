import React, { useEffect, useRef } from 'react';
import * as faceapi from 'face-api.js';
import { FILTERS, getFaceBBox, DEFAULT_FILTER } from './FaceFiltersRegistry';

const FaceFilter = ({ videoRef: externalVideoRef, filterType = DEFAULT_FILTER, mirrored = false }) => {
  const canvasRef = useRef(null);
  const modelsLoaded = useRef(false);
  const animationFrameRef = useRef(null);

  const loadModels = async () => {
    try {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
        faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
      ]);
      modelsLoaded.current = true;
      console.log('Face filter models loaded');
    } catch (error) {
      console.error('Error loading face-api models:', error);
    }
  };

  useEffect(() => {
    loadModels();
  }, []);

  useEffect(() => {
    if (!externalVideoRef?.current) return;

    const video = externalVideoRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Cancel any existing animation loop before starting a new one
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    const onFrame = async () => {
      if (!modelsLoaded.current) {
        animationFrameRef.current = requestAnimationFrame(onFrame);
        return;
      }

      // Use the video's intrinsic resolution for detection & drawing
      const vw = video.videoWidth;
      const vh = video.videoHeight;

      if (!vw || !vh) {
        animationFrameRef.current = requestAnimationFrame(onFrame);
        return;
      }

      // Canvas pixel dimensions must match the detection space (video resolution)
      if (canvas.width !== vw || canvas.height !== vh) {
        canvas.width = vw;
        canvas.height = vh;
      }

      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      try {
        const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 });
        const result = await faceapi.detectSingleFace(video, options).withFaceLandmarks();

        if (result) {
          const displaySize = { width: vw, height: vh };
          const resizedResult = faceapi.resizeResults(result, displaySize);

          // If the video is CSS-mirrored (scaleX(-1)), we need to mirror the canvas
          // context so the filter aligns with the visually flipped face.
          if (mirrored) {
            ctx.save();
            ctx.translate(vw, 0);
            ctx.scale(-1, 1);
          }

          const bbox = getFaceBBox(resizedResult.landmarks, video);

          if (bbox) {
            const filter = FILTERS[filterType];
            if (filter && filter.apply) {
              filter.apply(ctx, video, resizedResult.landmarks, bbox);
            }
          }

          if (mirrored) {
            ctx.restore();
          }
        }
      } catch (error) {
        // Silently continue - detection fails on some frames
      }

      animationFrameRef.current = requestAnimationFrame(onFrame);
    };

    // Start detection loop once video has data
    const startDetection = () => {
      console.log('FaceFilter: starting detection loop, video size:', video.videoWidth, 'x', video.videoHeight);
      onFrame();
    };

    // Poll for video readiness — the stream may be assigned after mount
    const pollForVideo = () => {
      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
        startDetection();
      } else {
        // Listen for both loadeddata and loadedmetadata to catch the stream
        const onLoaded = () => {
          video.removeEventListener('loadeddata', onLoaded);
          video.removeEventListener('loadedmetadata', onLoaded);
          // Give the browser one frame to populate videoWidth/videoHeight
          requestAnimationFrame(() => startDetection());
        };
        video.addEventListener('loadeddata', onLoaded);
        video.addEventListener('loadedmetadata', onLoaded);

        // Also poll every 200ms in case the stream is assigned after we attach listeners
        const pollInterval = setInterval(() => {
          if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
            clearInterval(pollInterval);
            video.removeEventListener('loadeddata', onLoaded);
            video.removeEventListener('loadedmetadata', onLoaded);
            startDetection();
          }
        }, 200);

        // Store interval ref for cleanup
        canvas._pollInterval = pollInterval;
      }
    };

    pollForVideo();

    return () => {
      video.removeEventListener('loadeddata', () => {});
      video.removeEventListener('loadedmetadata', () => {});
      if (canvas._pollInterval) {
        clearInterval(canvas._pollInterval);
        canvas._pollInterval = null;
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [externalVideoRef, filterType, mirrored]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'relative',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 10,
      }}
    />
  );
};

export default FaceFilter;
