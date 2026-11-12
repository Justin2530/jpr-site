import { requireStaff } from "@/lib/staff";
import { Empty, PageHeader } from "@/components/ui";
import { JarvisChat } from "./chat";
import { jarvisState } from "./actions";

export const metadata = { title: "Jarvis · JPR" };
export const maxDuration = 120;

// Jarvis, Justin's chief of staff, right inside the Command Center: type or talk, same brain and memory as
// texting or calling the main line from his cell.
export default async function JarvisPage() {
  const { staff } = await requireStaff();
  if (staff.role !== "owner")
    return (
      <>
        <PageHeader title="Jarvis" />
        <Empty>Only the owner can talk to Jarvis.</Empty>
      </>
    );
  const state = await jarvisState().catch(() => ({ lines: [], pending: null }));
  return (
    <>
      <PageHeader
        kicker="Chief of staff"
        title="Jarvis"
        sub="Ask anything about the business or tell him what to do. He asks you to confirm before he acts. Same Jarvis as texting or calling (814) 845-4341 from your cell."
      />
      <JarvisChat initial={state.lines} initialPending={state.pending} />
    </>
  );
}
