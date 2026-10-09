// The menu, shared by the sidebar (a client component) and the phone Menu page (a server page).
// It lives outside nav.tsx because a server page can't read plain data out of a "use client" file.
import {
  CandidatesIcon,
  ChatIcon,
  ClientsIcon,
  ContactsIcon,
  DealsIcon,
  HomeIcon,
  JobsIcon,
  SettingsIcon,
  PipelineIcon,
  PlacementIcon,
  ReportsIcon,
  ToolsIcon,
} from "@/components/icons";

type Item = { href: string; label: string; Icon: (p: { className?: string }) => React.ReactElement; ownerOnly?: boolean };

export const SECTIONS: { title: string | null; items: Item[] }[] = [
  {
    title: null,
    items: [
      { href: "/", label: "What needs me", Icon: HomeIcon },
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
      { href: "/deals", label: "Deals", Icon: DealsIcon },
      { href: "/companies", label: "Companies", Icon: ClientsIcon },
      { href: "/contacts", label: "Contacts", Icon: ContactsIcon },
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
];

