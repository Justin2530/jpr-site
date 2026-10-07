"use client";

import { useActionState } from "react";
import { setMyPassword } from "./actions";

export function PasswordForm() {
  const [state, action, pending] = useActionState(setMyPassword, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input name="password" type="password" autoComplete="new-password" required minLength={8} className="field sm:w-56" placeholder="New password" aria-label="New password" />
      <input name="confirm" type="password" autoComplete="new-password" required minLength={8} className="field sm:w-56" placeholder="Type it again" aria-label="Confirm password" />
      <button className="btn" disabled={pending}>
        {pending ? "Saving…" : "Save password"}
      </button>
      {state && <p className={`w-full text-sm ${state.ok ? "text-mint" : "text-rose"}`}>{state.message}</p>}
    </form>
  );
}
