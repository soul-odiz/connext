import React, { useState } from 'react';

/**
 * Avatar that shows an image, or gracefully falls back to a letter/placeholder
 * tile if the image is missing or fails to load. This prevents the ugly
 * "broken image" icon when a partner's profile picture can't be fetched.
 *
 * Props:
 *  - src           : image URL (optional)
 *  - alt           : alt text
 *  - placeholder   : text/JSX shown when no image or on load error
 *  - imgClass      : className for the <img> element
 *  - fallbackClass : className for the container used when falling back
 */
const Avatar = ({ src, alt, placeholder, imgClass, fallbackClass }) => {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return <div className={fallbackClass || 'avatar-placeholder'}>{placeholder || '?'}</div>;
  }

  return (
    <img
      src={src}
      alt={alt}
      className={imgClass}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
};

export default Avatar;