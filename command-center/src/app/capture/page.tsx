import { requireStaff } from "@/lib/staff";
import { CaptureForm } from "./capture-form";

export const metadata = { title: "Send to JPR" };

// The small window the "Send to JPR" bookmark opens over an Indeed profile.
export default async function CapturePage() {
  const { supabase } = await requireStaff();
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, title, companies(name, short_name)")
    .eq("status", "open")
    .order("title");
  return (
    <main className="mx-auto max-w-lg px-4 py-5">
      <p className="panel-title mb-3 text-cyan/80">Send to JPR</p>
      <CaptureForm
        jobs={(jobs ?? []).map((j) => ({ id: j.id, label: `${j.title} · ${j.companies?.short_name || j.companies?.name || ""}` }))}
      />
    </main>
  );
}
