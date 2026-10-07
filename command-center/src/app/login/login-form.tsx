"use client";

import { useActionState, useState } from "react";
import { signIn, type LoginState } from "./actions";

export function LoginForm({ initialError }: { initialError?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, { error: initialError });
  const [password, setPassword] = useState("");

  if (state.sent) {
    return (
      <div className="space-y-2 text-center">
        <p className="readout text-lg text-cyan">Link sent</p>
        <p className="text-sm text-muted">
          Check <span className="text-ink">{state.sent}</span> and open the sign-in link in this same browser.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="email" className="label">
          Email
        </label>
        <input id="email" name="email" type="email" autoComplete="email" required className="field" placeholder="you@jpeacerecruiting.com" />
      </div>
      <div>
        <label htmlFor="password" className="label">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          className="field"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Leave blank to get a sign-in link"
        />
      </div>
      {state.error && <p className="text-sm text-rose">{state.error}</p>}
      <button type="submit" disabled={pending} className="btn w-full py-2.5">
        {pending ? (password ? "Signing in…" : "Sending…") : password ? "Sign in" : "Send sign-in link"}
      </button>
    </form>
  );
}
