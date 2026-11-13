interface CustomerAvatarProps {
  name: string;
  className?: string;
  textClassName?: string;
}

/**
 * Gold initial avatar for every customer account.
 *
 * Google profile photos are intentionally ignored: the product uses one
 * consistent letter avatar (the same as email/password accounts), so no
 * external image is requested or rendered here.
 */
export function CustomerAvatar({
  name,
  className = 'w-8 h-8 rounded-full',
  textClassName = 'text-sm',
}: CustomerAvatarProps) {
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      aria-hidden="true"
      className={`${className} bg-[var(--primary)] text-[#0A0A0A] inline-flex items-center justify-center font-black ${textClassName}`}
    >
      {initial}
    </span>
  );
}
