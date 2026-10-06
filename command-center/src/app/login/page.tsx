import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · JPR Command Center" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-cyan/40 shadow-[0_0_40px_-8px_rgb(var(--glow)/0.6)]">
            <span className="readout text-lg text-cyan">JPR</span>
          </div>
          <p className="panel-title text-cyan/80">Command Center</p>
          <h1 className="mt-2 text-xl font-semibold">Sign in</h1>
        </div>
        <div className="panel p-6">
          <LoginForm initialError={error ? "That sign-in link didn't work. Send a new one." : undefined} />
        </div>
        <p className="mt-6 text-center font-mono text-[10.5px] uppercase tracking-[0.2em] text-faint">Private · staff only</p>
      </div>
    </main>
  );
}
