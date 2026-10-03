"use client";

import { useFormStatus } from "react-dom";

// A submit button that asks "are you sure?" first, for things that can't be undone.
export function ConfirmSubmit({ children, question, className = "btn-quiet hover:text-rose" }: { children: React.ReactNode; question: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={className}
      onClick={(e) => {
        if (!window.confirm(question)) e.preventDefault();
      }}
    >
      {pending ? "Working…" : children}
    </button>
  );
}
