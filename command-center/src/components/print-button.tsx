"use client";

export function PrintButton({ children }: { children: React.ReactNode }) {
  return (
    <button type="button" className="btn-quiet print:hidden" onClick={() => window.print()}>
      {children}
    </button>
  );
}
