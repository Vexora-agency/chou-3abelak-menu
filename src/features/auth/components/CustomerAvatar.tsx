import { useEffect, useState } from 'react';

interface CustomerAvatarProps {
  name: string;
  image?: string | null;
  className?: string;
  textClassName?: string;
}

/** Gold initial fallback, image when available (Google avatar later). */
export function CustomerAvatar({
  name,
  image,
  className = 'w-8 h-8 rounded-full',
  textClassName = 'text-sm',
}: CustomerAvatarProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [image]);

  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  if (image && !failed) {
    return (
      <img
        src={image}
        alt=""
        aria-hidden="true"
        draggable={false}
        onError={() => setFailed(true)}
        className={`${className} object-cover bg-neutral-800`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`${className} bg-[var(--primary)] text-[#0A0A0A] inline-flex items-center justify-center font-black ${textClassName}`}
    >
      {initial}
    </span>
  );
}
