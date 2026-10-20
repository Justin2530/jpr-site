"use client";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="panel mx-auto max-w-lg p-6">
      <p className="panel-title text-rose">Something went wrong</p>
      <p className="mt-3 text-sm text-muted">{error.message || "The action didn't complete."}</p>
      <button onClick={reset} className="btn-quiet mt-5">
        Try again
      </button>
    </div>
  );
}
