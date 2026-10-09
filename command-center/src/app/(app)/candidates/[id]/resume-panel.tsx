import { Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { shortDate } from "@/lib/format";
import { uploadResume } from "../actions";
import { JprButton } from "./jpr-button";

export type ShownResume = {
  id: string;
  file_name: string;
  created_at: string;
  mime_type: string | null;
  text_content: string | null;
  branded_from?: string | null;
  brand_check?: string | null;
  viewUrl?: string;
  downloadUrl?: string;
};

// The candidate's files, newest first: resumes open in a new tab or download; nothing is dumped as text.
// A JPR version shows its word-for-word check; an original resume without one offers to make it.
export function ResumePanel({ candidateId, resumes }: { candidateId: string; resumes: ShownResume[] }) {
  return (
    <Panel title={`Files · ${resumes.length}`}>
      {resumes.length === 0 ? (
        <p className="mb-3 text-sm text-faint">No files yet.</p>
      ) : (
        <ul className="mb-4 divide-y divide-line">
          {resumes.map((r, i) => {
            const ext = r.file_name.split(".").pop()?.toUpperCase().slice(0, 4) ?? "FILE";
            return (
              <li key={r.id} className="flex items-center gap-3 py-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-cyan/30 bg-cyan-soft font-mono text-[10px] text-cyan">
                  {ext}
                </span>
                <div className="min-w-0 flex-1">
                  {r.viewUrl ? (
                    <a href={r.viewUrl} target="_blank" rel="noreferrer" className="link block truncate text-sm">
                      {r.file_name}
                    </a>
                  ) : (
                    <p className="truncate text-sm">{r.file_name}</p>
                  )}
                  <p className="font-mono text-[11px] text-faint">
                    {r.branded_from ? "JPR version · " : i === 0 ? "Resume · " : ""}
                    {shortDate(r.created_at)}
                  </p>
                  {r.brand_check && (
                    <p className={`text-xs ${r.brand_check.startsWith("Checked") ? "text-mint" : "text-amber"}`}>{r.brand_check}</p>
                  )}
                  {!r.branded_from && /\.(pdf|docx?)$/i.test(r.file_name) && !resumes.some((x) => x.branded_from === r.id) && (
                    <JprButton resumeId={r.id} candidateId={candidateId} />
                  )}
                  {r.branded_from && <JprButton resumeId={r.branded_from} candidateId={candidateId} redoOf={r.id} />}
                  {!r.viewUrl && r.text_content && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-cyan">View text</summary>
                      <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-void/60 p-3 font-sans text-[12px] leading-relaxed text-ink/90">
                        {r.text_content}
                      </pre>
                    </details>
                  )}
                </div>
                {r.viewUrl && (
                  <a href={r.viewUrl} target="_blank" rel="noreferrer" className="btn-quiet shrink-0 text-xs">
                    Open
                  </a>
                )}
                {r.downloadUrl && (
                  <a href={r.downloadUrl} className="btn-quiet shrink-0 text-xs">
                    Download
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <form action={uploadResume} className="flex flex-wrap gap-2">
        <input type="hidden" name="candidate_id" value={candidateId} />
        <input
          name="resume"
          type="file"
          required
          accept=".pdf,.doc,.docx,.rtf,.txt"
          aria-label="File to add"
          className="field min-w-0 flex-1 file:mr-3 file:rounded file:border-0 file:bg-cyan-soft file:px-2 file:py-1 file:text-cyan"
        />
        <SubmitButton className="btn-quiet" pendingText="Uploading…">
          Add file
        </SubmitButton>
      </form>
    </Panel>
  );
}
