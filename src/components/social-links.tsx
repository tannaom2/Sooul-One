/** Icon links to the social profiles set in Business details and on each brand. */

const ICONS: Record<string, React.ReactNode> = {
  instagramUrl: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.8" fill="currentColor" />
    </>
  ),
  facebookUrl: <path d="M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8z" />,
  xUrl: <path d="M4 4l16 16M20 4L4 20" />,
  youtubeUrl: (
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
      <path d="M10 9.5v5l4.5-2.5z" fill="currentColor" />
    </>
  ),
};

const NAMES: Record<string, string> = { instagramUrl: "Instagram", facebookUrl: "Facebook", xUrl: "X", youtubeUrl: "YouTube" };

/** Icon links to whichever profiles are set; nothing when none are. */
export function SocialLinks({ owner, links }: { owner: string; links: Partial<Record<"instagramUrl" | "facebookUrl" | "xUrl" | "youtubeUrl", string | null>> }) {
  const set = (Object.keys(NAMES) as (keyof typeof links)[]).filter((k) => links[k]);
  if (set.length === 0) return null;
  return (
    <ul className="flex gap-1">
      {set.map((k) => (
        <li key={k}>
          <a href={links[k]!} target="_blank" rel="noopener noreferrer me" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-paper" aria-label={`${owner} on ${NAMES[k]}`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {ICONS[k]}
            </svg>
          </a>
        </li>
      ))}
    </ul>
  );
}
