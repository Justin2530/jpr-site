// The menu, shared by the sidebar (a client component) and the phone Menu page (a server page).
// It lives outside nav.tsx because a server page can't read plain data out of a "use client" file.
import {
  BoardIcon,
  CalendarIcon,
  CandidatesIcon,
  ChatIcon,
  ClientsIcon,
  ContactsIcon,
  DealsIcon,
  HomeIcon,
  JobsIcon,
  MailIcon,
  SettingsIcon,
  SparkIcon,
  TargetIcon,
  PipelineIcon,
  PlacementIcon,
  ReportsIcon,
  ToolsIcon,
} from "@/components/icons";

type Item = { href: string; label: string; Icon: (p: { className?: string }) => React.ReactElement; ownerOnly?: boolean; external?: boolean; notInSidebar?: boolean };

export const SECTIONS: { title: string | null; items: Item[] }[] = [
  {
    title: null,
    items: [
      { href: "/", label: "What needs me", Icon: HomeIcon },
      { href: "/dashboard", label: "Dashboard", Icon: BoardIcon },
      { href: "/calendar", label: "Calendar", Icon: CalendarIcon },
      { href: "/messages", label: "Messages", Icon: ChatIcon },
    ],
  },
  {
    title: "Recruiting",
    items: [
      { href: "/pipeline", label: "Pipeline", Icon: PipelineIcon },
      { href: "/jobs", label: "Jobs", Icon: JobsIcon },
      { href: "/candidates", label: "Candidates", Icon: CandidatesIcon },
      { href: "/placements", label: "Placements", Icon: PlacementIcon },
    ],
  },
  {
    title: "Sales",
    items: [
      // Employers who reached out or answered outreach (Justin 2026-10-29).
      { href: "/inbound", label: "Leads", Icon: MailIcon },
      { href: "/deals", label: "Deals", Icon: DealsIcon },
      { href: "/companies", label: "Companies", Icon: ClientsIcon },
      { href: "/contacts", label: "Contacts", Icon: ContactsIcon },
      // The sidebar shows it as its own button below the menu (Justin 2026-10-24); the phone menu lists it here.
      { href: "/leads", label: "Lead Engine", Icon: TargetIcon, ownerOnly: true, notInSidebar: true },
    ],
  },
  {
    title: "Business",
    items: [
      { href: "/reports", label: "Reports", Icon: ReportsIcon, ownerOnly: true },
      { href: "/tools", label: "Tools & costs", Icon: ToolsIcon, ownerOnly: true },
      { href: "/settings", label: "Settings", Icon: SettingsIcon },
    ],
  },
  {
    // Separate systems, linked only by a button: nothing is shared between them.
    title: "Other systems",
    items: [
      { href: "https://jpr-ai.vercel.app", label: "AI Command Center", Icon: SparkIcon, ownerOnly: true, external: true },
      { href: "https://jpr-job-board.vercel.app", label: "Job Board Command Center", Icon: JobsIcon, ownerOnly: true, external: true },
    ],
  },
];
