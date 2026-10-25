// Small stroke icons, drawn to match the HUD line weight.
type P = { className?: string };
const base = "h-[18px] w-[18px]";
const S = ({ className = base, children }: P & { children: React.ReactNode }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    {children}
  </svg>
);

export const HomeIcon = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="3" />
    <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" />
  </S>
);
export const ClientsIcon = (p: P) => (
  <S {...p}>
    <path d="M3 21V8l6-4v17M9 21h12V10l-6-3" />
    <path d="M13 13h4M13 17h4" />
  </S>
);
export const JobsIcon = (p: P) => (
  <S {...p}>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18" />
  </S>
);
export const CandidatesIcon = (p: P) => (
  <S {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5" />
  </S>
);
export const SearchIcon = (p: P) => (
  <S {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </S>
);
export const PlusIcon = (p: P) => (
  <S {...p}>
    <path d="M12 5v14M5 12h14" />
  </S>
);
export const PhoneIcon = (p: P) => (
  <S {...p}>
    <path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2" />
  </S>
);
export const MailIcon = (p: P) => (
  <S {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </S>
);
export const ShieldIcon = (p: P) => (
  <S {...p}>
    <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />
  </S>
);
export const ToolsIcon = (p: P) => (
  <S {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9h18M8 14h3M8 17h6M16 14h1" />
  </S>
);
export const PipelineIcon = (p: P) => (
  <S {...p}>
    <rect x="3" y="4" width="5" height="16" rx="1.5" />
    <rect x="10" y="4" width="5" height="11" rx="1.5" />
    <rect x="17" y="4" width="4" height="7" rx="1.5" />
  </S>
);
export const PlacementIcon = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="9" r="5.5" />
    <path d="m9.5 9 1.8 1.8L14.8 7.3M8.5 14l-1.5 7 5-2.5 5 2.5-1.5-7" />
  </S>
);
export const DealsIcon = (p: P) => (
  <S {...p}>
    <path d="M3 17l5-5 4 4 8-8" />
    <path d="M15 8h5v5" />
  </S>
);
export const ContactsIcon = (p: P) => (
  <S {...p}>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <circle cx="12" cy="10" r="3" />
    <path d="M7.5 17.5a4.5 4.5 0 0 1 9 0" />
  </S>
);
export const ReportsIcon = (p: P) => (
  <S {...p}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </S>
);
export const MenuIcon = (p: P) => (
  <S {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </S>
);
export const ChevronIcon = (p: P) => (
  <S {...p}>
    <path d="m6 9 6 6 6-6" />
  </S>
);
export const ChatIcon = (p: P) => (
  <S {...p}>
    <path d="M4 5h16v11H9l-5 4z" />
    <path d="M8 9.5h8M8 12.5h5" />
  </S>
);
export const BellIcon = (p: P) => (
  <S {...p}>
    <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" />
    <path d="M10 20.5a2 2 0 0 0 4 0" />
  </S>
);
export const SettingsIcon = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v3M12 18.5v3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M2.5 12h3M18.5 12h3M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1" />
  </S>
);
