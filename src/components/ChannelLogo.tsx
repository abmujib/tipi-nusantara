import { useState } from 'react';

interface ChannelLogoProps {
  src?: string;
  name: string;
  size?: 'sm' | 'md' | 'lg';
}

function getInitials(name: string): string {
  const cleaned = name.replace(/\([^)]*\)/g, '').trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'TV';
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function ChannelLogo({ src, name, size = 'md' }: ChannelLogoProps) {
  const [failed, setFailed] = useState(false);

  const sizeClasses =
    size === 'sm'
      ? 'w-9 h-9 text-[11px]'
      : size === 'lg'
        ? 'w-12 h-12 text-sm'
        : 'w-10 h-10 text-xs';

  if (!src || failed) {
    return (
      <div
        className={`${sizeClasses} shrink-0 rounded-lg bg-[#1A2130] border border-slate-800/80 flex items-center justify-center font-display font-semibold tracking-tight text-slate-300 select-none`}
        aria-hidden="true"
      >
        {getInitials(name)}
      </div>
    );
  }

  return (
    <div
      className={`${sizeClasses} shrink-0 rounded-lg bg-[#161C28] border border-slate-800/80 p-1.5 flex items-center justify-center overflow-hidden`}
    >
      <img
        src={src}
        alt={`Logo ${name}`}
        referrerPolicy="no-referrer"
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="w-full h-full object-contain"
      />
    </div>
  );
}
