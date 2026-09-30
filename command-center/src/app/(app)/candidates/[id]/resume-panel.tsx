import { Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { shortDate } from "@/lib/format";
import { uploadResume } from "../actions";

export type ShownResume = {
  id: string;
  file_name: string;
  created_at: string;
  mime_type: string | null;
  text_content: string | null;
  viewUrl?: string;
  downloadUrl?: string;
};

// Latest resume shown right on the page; older versions listed underneath.
export function ResumePanel({ candidateId, resumes }: { candidateId: string; resumes: ShownResume[] }) {
  const [latest, ...older] = resumes;
  const isPdf = latest && (latest.mime_type === "application/pdf" || latest.file_name.toLowerCase().endsWith(".pdf"));
  return (
    <Panel
      title="Resume"
      action={
        latest?.downloadUrl && (
          <a href={latest.downloadUrl} className="link text-xs text-cyan">
            Download
          </a>
        )
      }
    >
      {!latest ? (
        <p className="mb-3 text-sm text-faint">No resume on file.</p>
      ) : latest.text_content ? (
        <pre className="mb-3 max-h-[36rem] overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-void/60 p-4 font-sans text-[13px] leading-relaxed text-ink/90">
          {latest.text_content}
        </pre>
      ) : isPdf && latest.viewUrl ? (
        <iframe src={latest.viewUrl} title={latest.file_name} className="mb-3 h-[36rem] w-full rounded-lg border border-line bg-white" />
      ) : (
        <p className="mb-3 text-sm text-muted">
          {latest.file_name} can&apos;t be previewed here.{" "}
          {latest.downloadUrl && (
            <a href={latest.downloadUrl} className="link text-cyan">
              Download it
            </a>
          )}
        </p>
      )}
      {latest && (
        <p className="mb-3 font-mono text-[11px] text-faint">
          {latest.file_name} · {shortDate(latest.created_at)}
        </p>
      )}
      {older.length > 0 && (
        <details className="mb-3">
          <summary className="cursor-pointer text-sm text-muted">Earlier versions ({older.length})</summary>
          <ul className="mt-2 space-y-1.5">
            {older.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                {r.downloadUrl ? (
                  <a href={r.downloadUrl} className="link truncate">
                    {r.file_name}
                  </a>
                ) : (
                  <span className="truncate">{r.file_name}</span>
                )}
                <span className="shrink-0 font-mono text-[11px] text-faint">{shortDate(r.created_at)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <form action={uploadResume} className="flex flex-wrap gap-2">
        <input type="hidden" name="candidate_id" value={candidateId} />
        <input
          name="resume"
          type="file"
          required
          accept=".pdf,.doc,.docx,.rtf,.txt"
          aria-label="Resume file"
          className="field min-w-0 flex-1 file:mr-3 file:rounded file:border-0 file:bg-cyan-soft file:px-2 file:py-1 file:text-cyan"
        />
        <SubmitButton className="btn-quiet" pendingText="Uploading…">
          Upload
        </SubmitButton>
      </form>
    </Panel>
  );
}
