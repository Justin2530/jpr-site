export default function NoAccess() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="panel max-w-sm p-6 text-center">
        <p className="panel-title text-rose">Access not set up</p>
        <p className="mt-3 text-sm text-muted">This email is signed in but isn&apos;t on the JPR staff list. Ask Justin to invite you.</p>
        <form action="/auth/signout" method="post" className="mt-5">
          <button className="btn-quiet">Sign out</button>
        </form>
      </div>
    </main>
  );
}
