/**
 * Face Filters Registry
 * =====================
 * Add new filters here! Each filter is a function that receives:
 *   - ctx: CanvasRenderingContext2D - the canvas to draw on
 *   - video: HTMLVideoElement - the local video element
 *   - landmarks: faceapi.FaceLandmarks68 - detected face landmarks
 *   - bbox: { x, y, width, height } - face bounding box (padded)
 * 
 * To add a new filter:
 *   1. Add a new entry to the FILTERS object below
 *   2. The key is the filter ID, value has: name, icon, description, apply function
 */

// Helper: get padded face bounding box from landmarks
export function getFaceBBox(landmarks, video) {
  const jawOutline = landmarks.getJawOutline();
  const leftEye = landmarks.getLeftEye();
  const rightEye = landmarks.getRightEye();
  const nose = landmarks.getNose();
  const mouth = landmarks.getMouth();

  const allPoints = [...jawOutline, ...leftEye, ...rightEye, ...nose, ...mouth];
  if (allPoints.length < 3) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of allPoints) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }

  const paddingX = (maxX - minX) * 0.25;
  const paddingY = (maxY - minY) * 0.25;
  const vw = video.videoWidth || video.width || 640;
  const vh = video.videoHeight || video.height || 480;

  return {
    x: Math.max(0, minX - paddingX),
    y: Math.max(0, minY - paddingY),
    width: Math.min(vw - Math.max(0, minX - paddingX), maxX - minX + paddingX * 2),
    height: Math.min(vh - Math.max(0, minY - paddingY), maxY - minY + paddingY * 2),
  };
}

// Helper: draw jawline contour
export function drawJawContour(ctx, landmarks, style) {
  const jaw = landmarks.getJawOutline();
  if (jaw.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(jaw[0].x, jaw[0].y);
  for (let i = 1; i < jaw.length; i++) {
    ctx.lineTo(jaw[i].x, jaw[i].y);
  }
  ctx.closePath();
  if (style) {
    ctx.strokeStyle = style.strokeStyle || 'rgba(255,255,255,0.3)';
    ctx.lineWidth = style.lineWidth || 2;
    ctx.stroke();
  }
}

// ========== FILTER DEFINITIONS ==========

export const FILTERS = {
  pixelate: {
    id: 'pixelate',
    name: 'Pixelate',
    icon: '🧊',
    description: 'Pixelates the face area',
    apply: (ctx, video, landmarks, bbox) => {
      const pixelSize = Math.max(6, Math.floor(Math.min(bbox.width, bbox.height) / 15));
      const smallW = Math.max(1, Math.floor(bbox.width / pixelSize));
      const smallH = Math.max(1, Math.floor(bbox.height / pixelSize));

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = smallW;
      tempCanvas.height = smallH;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.drawImage(video, bbox.x, bbox.y, bbox.width, bbox.height, 0, 0, smallW, smallH);

      ctx.drawImage(tempCanvas, 0, 0, smallW, smallH, bbox.x, bbox.y, bbox.width, bbox.height);
      drawJawContour(ctx, landmarks, { strokeStyle: 'rgba(255,255,255,0.2)', lineWidth: 2 });
    },
  },

  blur: {
    id: 'blur',
    name: 'Gaussian Blur',
    icon: '🌫️',
    description: 'Applies a smooth blur over the face',
    apply: (ctx, video, landmarks, bbox) => {
      // Multi-step box blur for a smooth effect
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = bbox.width;
      tempCanvas.height = bbox.height;
      const tempCtx = tempCanvas.getContext('2d');

      // Draw the face region
      tempCtx.drawImage(video, bbox.x, bbox.y, bbox.width, bbox.height, 0, 0, bbox.width, bbox.height);

      // Apply multiple passes of box blur by scaling down and up
      const blurLevel = 3;
      const smallW = Math.max(2, Math.floor(bbox.width / (blurLevel * 4)));
      const smallH = Math.max(2, Math.floor(bbox.height / (blurLevel * 4)));

      const blurCanvas = document.createElement('canvas');
      blurCanvas.width = smallW;
      blurCanvas.height = smallH;
      const blurCtx = blurCanvas.getContext('2d');

      // Scale down (blurs)
      blurCtx.drawImage(tempCanvas, 0, 0, bbox.width, bbox.height, 0, 0, smallW, smallH);
      // Scale back up (smooth)
      ctx.drawImage(blurCanvas, 0, 0, smallW, smallH, bbox.x, bbox.y, bbox.width, bbox.height);

      drawJawContour(ctx, landmarks, { strokeStyle: 'rgba(255,255,255,0.2)', lineWidth: 2 });
    },
  },

  sunglasses: {
    id: 'sunglasses',
    name: 'Sunglasses',
    icon: '🕶️',
    description: 'Draws sunglasses over the eyes',
    apply: (ctx, video, landmarks, bbox) => {
      const leftEye = landmarks.getLeftEye();
      const rightEye = landmarks.getRightEye();

      if (leftEye.length < 4 || rightEye.length < 4) return;

      // Calculate eye centers
      const leftEyeCenter = {
        x: leftEye.reduce((s, p) => s + p.x, 0) / leftEye.length,
        y: leftEye.reduce((s, p) => s + p.y, 0) / leftEye.length,
      };
      const rightEyeCenter = {
        x: rightEye.reduce((s, p) => s + p.x, 0) / rightEye.length,
        y: rightEye.reduce((s, p) => s + p.y, 0) / rightEye.length,
      };

      // Eye dimensions
      const leftEyeWidth = Math.max(...leftEye.map(p => p.x)) - Math.min(...leftEye.map(p => p.x));
      const rightEyeWidth = Math.max(...rightEye.map(p => p.x)) - Math.min(...rightEye.map(p => p.x));
      const eyeHeight = Math.max(
        Math.max(...leftEye.map(p => p.y)) - Math.min(...leftEye.map(p => p.y)),
        Math.max(...rightEye.map(p => p.y)) - Math.min(...rightEye.map(p => p.y))
      );

      const lensWidth = Math.max(leftEyeWidth, rightEyeWidth) * 3;
      const lensHeight = eyeHeight * 3.5;

      // Draw left lens
      ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(leftEyeCenter.x, leftEyeCenter.y, lensWidth / 2, lensHeight / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Draw right lens
      ctx.beginPath();
      ctx.ellipse(rightEyeCenter.x, rightEyeCenter.y, lensWidth / 2, lensHeight / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Draw bridge connecting them
      const bridgeY = (leftEyeCenter.y + rightEyeCenter.y) / 2;
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(leftEyeCenter.x + lensWidth / 2 - 5, bridgeY - lensHeight * 0.15);
      ctx.lineTo(rightEyeCenter.x - lensWidth / 2 + 5, bridgeY - lensHeight * 0.15);
      ctx.stroke();
      
      // Lens shine
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      ctx.ellipse(leftEyeCenter.x - lensWidth * 0.15, leftEyeCenter.y - lensHeight * 0.15, lensWidth * 0.2, lensHeight * 0.15, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(rightEyeCenter.x - lensWidth * 0.15, rightEyeCenter.y - lensHeight * 0.15, lensWidth * 0.2, lensHeight * 0.15, -0.3, 0, Math.PI * 2);
      ctx.fill();
    },
  },

  clown: {
    id: 'clown',
    name: 'Clown',
    icon: '🤡',
    description: 'Red nose + clown makeup overlay',
    apply: (ctx, video, landmarks, bbox) => {
      const nose = landmarks.getNose();
      const mouth = landmarks.getMouth();

      if (nose.length < 3 || mouth.length < 2) return;

      // Red nose
      const noseCenter = {
        x: nose.reduce((s, p) => s + p.x, 0) / nose.length,
        y: nose.reduce((s, p) => s + p.y, 0) / nose.length,
      };
      const noseSize = (Math.max(...nose.map(p => p.x)) - Math.min(...nose.map(p => p.x))) * 1.2;

      ctx.fillStyle = '#ff0000';
      ctx.beginPath();
      ctx.ellipse(noseCenter.x, noseCenter.y, noseSize * 0.8, noseSize * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();

      // Nose highlight
      ctx.fillStyle = 'rgba(255,200,200,0.4)';
      ctx.beginPath();
      ctx.ellipse(noseCenter.x - noseSize * 0.15, noseCenter.y - noseSize * 0.15, noseSize * 0.25, noseSize * 0.2, -0.3, 0, Math.PI * 2);
      ctx.fill();

      // Clown smile (wide red smile)
      const mouthCenter = {
        x: mouth.reduce((s, p) => s + p.x, 0) / mouth.length,
        y: Math.min(...mouth.map(p => p.y)),
      };
      const mouthWidth = Math.max(...mouth.map(p => p.x)) - Math.min(...mouth.map(p => p.x));

      ctx.strokeStyle = '#cc0000';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(mouthCenter.x, mouthCenter.y + 5, mouthWidth * 0.6, 0.1, Math.PI - 0.1);
      ctx.stroke();

      // Thicken the smile
      ctx.strokeStyle = '#cc0000';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(mouthCenter.x, mouthCenter.y + 8, mouthWidth * 0.6, 0.1, Math.PI - 0.1);
      ctx.stroke();
    },
  },

  cat: {
    id: 'cat',
    name: 'Cat Ears',
    icon: '🐱',
    description: 'Adds cat ears and whiskers',
    apply: (ctx, video, landmarks, bbox) => {
      const leftEye = landmarks.getLeftEye();
      const rightEye = landmarks.getRightEye();
      const nose = landmarks.getNose();
      const jaw = landmarks.getJawOutline();

      if (leftEye.length < 4 || rightEye.length < 4 || jaw.length < 2) return;

      const leftEyeCenter = {
        x: leftEye.reduce((s, p) => s + p.x, 0) / leftEye.length,
        y: leftEye.reduce((s, p) => s + p.y, 0) / leftEye.length,
      };
      const rightEyeCenter = {
        x: rightEye.reduce((s, p) => s + p.x, 0) / rightEye.length,
        y: rightEye.reduce((s, p) => s + p.y, 0) / rightEye.length,
      };

      const eyeDist = rightEyeCenter.x - leftEyeCenter.x;
      const earHeight = eyeDist * 0.8;
      const earWidth = eyeDist * 0.4;
      const eyebrowY = leftEyeCenter.y - eyeDist * 0.5;

      // Left ear (triangle)
      const leftEarTipX = leftEyeCenter.x - earWidth * 0.5;
      const leftEarTipY = eyebrowY - earHeight;
      ctx.fillStyle = '#ff9933';
      ctx.strokeStyle = '#cc7722';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(leftEarTipX, leftEarTipY);
      ctx.lineTo(leftEyeCenter.x - earWidth, eyebrowY);
      ctx.lineTo(leftEyeCenter.x + earWidth * 0.3, eyebrowY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Left ear inner
      ctx.fillStyle = '#ffbb77';
      ctx.beginPath();
      ctx.moveTo(leftEarTipX + earWidth * 0.2, leftEarTipY + earHeight * 0.2);
      ctx.lineTo(leftEyeCenter.x - earWidth * 0.5, eyebrowY - earHeight * 0.1);
      ctx.lineTo(leftEyeCenter.x - earWidth * 0.1, eyebrowY - earHeight * 0.1);
      ctx.closePath();
      ctx.fill();

      // Right ear (triangle)
      const rightEarTipX = rightEyeCenter.x + earWidth * 0.5;
      const rightEarTipY = eyebrowY - earHeight;
      ctx.fillStyle = '#ff9933';
      ctx.beginPath();
      ctx.moveTo(rightEarTipX, rightEarTipY);
      ctx.lineTo(rightEyeCenter.x + earWidth, eyebrowY);
      ctx.lineTo(rightEyeCenter.x - earWidth * 0.3, eyebrowY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Right ear inner
      ctx.fillStyle = '#ffbb77';
      ctx.beginPath();
      ctx.moveTo(rightEarTipX - earWidth * 0.2, rightEarTipY + earHeight * 0.2);
      ctx.lineTo(rightEyeCenter.x + earWidth * 0.5, eyebrowY - earHeight * 0.1);
      ctx.lineTo(rightEyeCenter.x + earWidth * 0.1, eyebrowY - earHeight * 0.1);
      ctx.closePath();
      ctx.fill();

      // Whiskers
      if (nose.length > 0) {
        const noseTip = nose[nose.length - 1];
        const whiskerLength = eyeDist * 0.6;

        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1.5;

        // Left whiskers
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(noseTip.x, noseTip.y + i * 5);
          ctx.lineTo(noseTip.x - whiskerLength, noseTip.y + i * 8 - 5);
          ctx.stroke();
        }

        // Right whiskers
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(noseTip.x, noseTip.y + i * 5);
          ctx.lineTo(noseTip.x + whiskerLength, noseTip.y + i * 8 - 5);
          ctx.stroke();
        }
      }
    },
  },

  heart: {
    id: 'heart',
    name: 'Heart Eyes',
    icon: '❤️',
    description: 'Replaces eyes with hearts',
    apply: (ctx, video, landmarks, bbox) => {
      const leftEye = landmarks.getLeftEye();
      const rightEye = landmarks.getRightEye();

      if (leftEye.length < 4 || rightEye.length < 4) return;

      const drawHeart = (cx, cy, size) => {
        ctx.fillStyle = '#ff3366';
        ctx.beginPath();
        ctx.moveTo(cx, cy + size * 0.3);
        // Left lobe
        ctx.bezierCurveTo(cx - size * 0.6, cy - size * 0.4, cx - size * 0.3, cy - size * 0.9, cx, cy - size * 0.3);
        // Right lobe
        ctx.bezierCurveTo(cx + size * 0.3, cy - size * 0.9, cx + size * 0.6, cy - size * 0.4, cx, cy + size * 0.3);
        ctx.fill();

        // Shine
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.beginPath();
        ctx.ellipse(cx - size * 0.15, cy - size * 0.4, size * 0.12, size * 0.1, -0.4, 0, Math.PI * 2);
        ctx.fill();
      };

      const leftEyeCenter = {
        x: leftEye.reduce((s, p) => s + p.x, 0) / leftEye.length,
        y: leftEye.reduce((s, p) => s + p.y, 0) / leftEye.length,
      };
      const rightEyeCenter = {
        x: rightEye.reduce((s, p) => s + p.x, 0) / rightEye.length,
        y: rightEye.reduce((s, p) => s + p.y, 0) / rightEye.length,
      };

      const eyeSize = (Math.max(...leftEye.map(p => p.x)) - Math.min(...leftEye.map(p => p.x))) * 0.8;

      drawHeart(leftEyeCenter.x, leftEyeCenter.y, eyeSize * 2);
      drawHeart(rightEyeCenter.x, rightEyeCenter.y, eyeSize * 2);
    },
  },

  // ========== NEW FILTERS ==========

  rainbow: {
    id: 'rainbow',
    name: 'Rainbow',
    icon: '🌈',
    description: 'Draws a rainbow arc over the face',
    apply: (ctx, video, landmarks, bbox) => {
      const jaw = landmarks.getJawOutline();
      const leftEye = landmarks.getLeftEye();
      const rightEye = landmarks.getRightEye();
      if (jaw.length < 2 || leftEye.length < 2 || rightEye.length < 2) return;

      const leftEyeCenter = {
        x: leftEye.reduce((s, p) => s + p.x, 0) / leftEye.length,
        y: leftEye.reduce((s, p) => s + p.y, 0) / leftEye.length,
      };
      const rightEyeCenter = {
        x: rightEye.reduce((s, p) => s + p.x, 0) / rightEye.length,
        y: rightEye.reduce((s, p) => s + p.y, 0) / rightEye.length,
      };

      const cx = (leftEyeCenter.x + rightEyeCenter.x) / 2;
      const cy = leftEyeCenter.y;
      const eyeDist = rightEyeCenter.x - leftEyeCenter.x;
      const rainbowColors = ['#ff0000', '#ff7700', '#ffff00', '#00cc00', '#0000ff', '#8b00ff'];
      const baseRadius = eyeDist * 1.1;

      for (let i = 0; i < rainbowColors.length; i++) {
        const r = baseRadius + i * (eyeDist * 0.12);
        ctx.beginPath();
        ctx.arc(cx, cy + eyeDist * 0.3, r, Math.PI, 2 * Math.PI);
        ctx.strokeStyle = rainbowColors[i];
        ctx.lineWidth = eyeDist * 0.1;
        ctx.stroke();
      }
    },
  },

  dog: {
    id: 'dog',
    name: 'Dog',
    icon: '🐶',
    description: 'Floppy dog ears, nose and tongue',
    apply: (ctx, video, landmarks, bbox) => {
      const leftEye = landmarks.getLeftEye();
      const rightEye = landmarks.getRightEye();
      const nose = landmarks.getNose();
      const mouth = landmarks.getMouth();

      if (leftEye.length < 2 || rightEye.length < 2 || nose.length < 3) return;

      const leftEyeCenter = {
        x: leftEye.reduce((s, p) => s + p.x, 0) / leftEye.length,
        y: leftEye.reduce((s, p) => s + p.y, 0) / leftEye.length,
      };
      const rightEyeCenter = {
        x: rightEye.reduce((s, p) => s + p.x, 0) / rightEye.length,
        y: rightEye.reduce((s, p) => s + p.y, 0) / rightEye.length,
      };

      const eyeDist = rightEyeCenter.x - leftEyeCenter.x;
      const earW = eyeDist * 0.7;
      const earH = eyeDist * 1.1;
      const earTopY = leftEyeCenter.y - eyeDist * 0.5;

      // Left floppy ear
      ctx.fillStyle = '#8B4513';
      ctx.beginPath();
      ctx.ellipse(leftEyeCenter.x - eyeDist * 0.55, earTopY + earH * 0.4, earW * 0.45, earH * 0.55, -0.3, 0, Math.PI * 2);
      ctx.fill();

      // Right floppy ear
      ctx.beginPath();
      ctx.ellipse(rightEyeCenter.x + eyeDist * 0.55, earTopY + earH * 0.4, earW * 0.45, earH * 0.55, 0.3, 0, Math.PI * 2);
      ctx.fill();

      // Dog nose (big black oval)
      const noseTip = nose[nose.length - 1];
      const noseW = eyeDist * 0.35;
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.ellipse(noseTip.x, noseTip.y, noseW * 0.9, noseW * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();

      // Nose shine
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.ellipse(noseTip.x - noseW * 0.2, noseTip.y - noseW * 0.15, noseW * 0.2, noseW * 0.12, -0.3, 0, Math.PI * 2);
      ctx.fill();

      // Tongue
      if (mouth.length > 4) {
        const mouthBottom = mouth.reduce((max, p) => p.y > max.y ? p : max, mouth[0]);
        const tongueX = mouthBottom.x;
        const tongueY = mouthBottom.y + eyeDist * 0.1;
        const tongueW = eyeDist * 0.28;
        const tongueH = eyeDist * 0.38;

        ctx.fillStyle = '#ff6699';
        ctx.beginPath();
        ctx.ellipse(tongueX, tongueY + tongueH * 0.4, tongueW, tongueH * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();

        // Tongue center line
        ctx.strokeStyle = '#cc3366';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(tongueX, tongueY);
        ctx.lineTo(tongueX, tongueY + tongueH * 0.9);
        ctx.stroke();
      }
    },
  },

  alien: {
    id: 'alien',
    name: 'Alien',
    icon: '👽',
    description: 'Green alien skin with big eyes',
    apply: (ctx, video, landmarks, bbox) => {
      const leftEye = landmarks.getLeftEye();
      const rightEye = landmarks.getRightEye();
      const jaw = landmarks.getJawOutline();
      const mouth = landmarks.getMouth();

      if (leftEye.length < 4 || rightEye.length < 4 || jaw.length < 5) return;

      // Green face overlay
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = '#33ff66';
      ctx.beginPath();
      ctx.moveTo(jaw[0].x, jaw[0].y);
      for (let i = 1; i < jaw.length; i++) ctx.lineTo(jaw[i].x, jaw[i].y);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      const leftEyeCenter = {
        x: leftEye.reduce((s, p) => s + p.x, 0) / leftEye.length,
        y: leftEye.reduce((s, p) => s + p.y, 0) / leftEye.length,
      };
      const rightEyeCenter = {
        x: rightEye.reduce((s, p) => s + p.x, 0) / rightEye.length,
        y: rightEye.reduce((s, p) => s + p.y, 0) / rightEye.length,
      };
      const eyeDist = rightEyeCenter.x - leftEyeCenter.x;
      const eyeR = eyeDist * 0.38;

      // Big black alien eyes
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(leftEyeCenter.x, leftEyeCenter.y, eyeR, eyeR * 0.7, -0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(rightEyeCenter.x, rightEyeCenter.y, eyeR, eyeR * 0.7, 0.2, 0, Math.PI * 2);
      ctx.fill();

      // Eye shine
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.ellipse(leftEyeCenter.x - eyeR * 0.25, leftEyeCenter.y - eyeR * 0.2, eyeR * 0.18, eyeR * 0.12, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(rightEyeCenter.x - eyeR * 0.25, rightEyeCenter.y - eyeR * 0.2, eyeR * 0.18, eyeR * 0.12, -0.3, 0, Math.PI * 2);
      ctx.fill();

      // Thin alien mouth
      if (mouth.length > 4) {
        const mouthLeft = mouth.reduce((min, p) => p.x < min.x ? p : min, mouth[0]);
        const mouthRight = mouth.reduce((max, p) => p.x > max.x ? p : max, mouth[0]);
        const mouthMidY = (mouthLeft.y + mouthRight.y) / 2;
        ctx.strokeStyle = '#006622';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(mouthLeft.x, mouthMidY);
        ctx.quadraticCurveTo((mouthLeft.x + mouthRight.x) / 2, mouthMidY + eyeDist * 0.08, mouthRight.x, mouthMidY);
        ctx.stroke();
      }
    },
  },

  fire: {
    id: 'fire',
    name: 'Fire',
    icon: '🔥',
    description: 'Flames rising from the top of the head',
    apply: (ctx, video, landmarks, bbox) => {
      const leftEye = landmarks.getLeftEye();
      const rightEye = landmarks.getRightEye();
      if (leftEye.length < 2 || rightEye.length < 2) return;

      const leftEyeCenter = {
        x: leftEye.reduce((s, p) => s + p.x, 0) / leftEye.length,
        y: leftEye.reduce((s, p) => s + p.y, 0) / leftEye.length,
      };
      const rightEyeCenter = {
        x: rightEye.reduce((s, p) => s + p.x, 0) / rightEye.length,
        y: rightEye.reduce((s, p) => s + p.y, 0) / rightEye.length,
      };

      const eyeDist = rightEyeCenter.x - leftEyeCenter.x;
      const cx = (leftEyeCenter.x + rightEyeCenter.x) / 2;
      const topY = leftEyeCenter.y - eyeDist * 0.8;
      const flameCount = 5;
      const flameSpread = eyeDist * 1.2;

      const now = Date.now();

      for (let i = 0; i < flameCount; i++) {
        const t = (i / (flameCount - 1)) - 0.5; // -0.5 to 0.5
        const fx = cx + t * flameSpread;
        const flameH = eyeDist * (0.7 + 0.4 * Math.abs(Math.sin(now / 300 + i)));
        const flameW = eyeDist * 0.22;

        const grad = ctx.createRadialGradient(fx, topY, 0, fx, topY + flameH * 0.5, flameH);
        grad.addColorStop(0, 'rgba(255, 255, 100, 0.95)');
        grad.addColorStop(0.3, 'rgba(255, 140, 0, 0.85)');
        grad.addColorStop(0.7, 'rgba(255, 30, 0, 0.6)');
        grad.addColorStop(1, 'rgba(200, 0, 0, 0)');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(fx, topY + flameH);
        ctx.bezierCurveTo(
          fx - flameW, topY + flameH * 0.6,
          fx - flameW * 0.5, topY + flameH * 0.2,
          fx, topY
        );
        ctx.bezierCurveTo(
          fx + flameW * 0.5, topY + flameH * 0.2,
          fx + flameW, topY + flameH * 0.6,
          fx, topY + flameH
        );
        ctx.fill();
      }
    },
  },

  neon: {
    id: 'neon',
    name: 'Neon Glow',
    icon: '💜',
    description: 'Neon glowing outline around the face',
    apply: (ctx, video, landmarks, bbox) => {
      const jaw = landmarks.getJawOutline();
      const leftEye = landmarks.getLeftEye();
      const rightEye = landmarks.getRightEye();
      const nose = landmarks.getNose();
      const mouth = landmarks.getMouth();

      if (jaw.length < 5) return;

      const drawGlowPath = (points, color, lineW, blur) => {
        if (points.length < 2) return;
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = blur;
        ctx.strokeStyle = color;
        ctx.lineWidth = lineW;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
        ctx.stroke();
        ctx.restore();
      };

      // Jaw outline - cyan
      drawGlowPath(jaw, '#00ffff', 3, 18);
      // Left eye - magenta
      drawGlowPath([...leftEye, leftEye[0]], '#ff00ff', 2, 14);
      // Right eye - magenta
      drawGlowPath([...rightEye, rightEye[0]], '#ff00ff', 2, 14);
      // Nose - yellow
      drawGlowPath(nose, '#ffff00', 2, 12);
      // Mouth - pink
      drawGlowPath(mouth, '#ff66cc', 2, 14);
    },
  },

  mosaic: {
    id: 'mosaic',
    name: 'Mosaic',
    icon: '🎨',
    description: 'Colorful mosaic tile effect on the face',
    apply: (ctx, video, landmarks, bbox) => {
      const tileSize = Math.max(8, Math.floor(Math.min(bbox.width, bbox.height) / 10));

      // Sample the video at tile positions and draw colored squares
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = bbox.width;
      tempCanvas.height = bbox.height;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.drawImage(video, bbox.x, bbox.y, bbox.width, bbox.height, 0, 0, bbox.width, bbox.height);

      const imageData = tempCtx.getImageData(0, 0, bbox.width, bbox.height);
      const data = imageData.data;

      for (let ty = 0; ty < bbox.height; ty += tileSize) {
        for (let tx = 0; tx < bbox.width; tx += tileSize) {
          // Sample center pixel of tile
          const px = Math.min(tx + Math.floor(tileSize / 2), bbox.width - 1);
          const py = Math.min(ty + Math.floor(tileSize / 2), bbox.height - 1);
          const idx = (py * bbox.width + px) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];

          // Draw tile with slight color boost for mosaic effect
          ctx.fillStyle = `rgb(${Math.min(255, r + 20)},${Math.min(255, g + 20)},${Math.min(255, b + 20)})`;
          ctx.fillRect(bbox.x + tx, bbox.y + ty, tileSize - 1, tileSize - 1);

          // Tile border
          ctx.strokeStyle = 'rgba(0,0,0,0.3)';
          ctx.lineWidth = 1;
          ctx.strokeRect(bbox.x + tx, bbox.y + ty, tileSize - 1, tileSize - 1);
        }
      }

      drawJawContour(ctx, landmarks, { strokeStyle: 'rgba(255,255,255,0.3)', lineWidth: 2 });
    },
  },
};

export const FILTER_IDS = Object.keys(FILTERS);
export const DEFAULT_FILTER = 'dog';

export default FILTERS;
