"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  pendingText = "Saving…",
  className = "btn",
  name,
  value,
  disabled = false,
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
  name?: string;
  value?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled} className={disabled ? `${className} cursor-not-allowed opacity-40` : className} name={name} value={value}>
      {pending ? pendingText : children}
    </button>
  );
}
