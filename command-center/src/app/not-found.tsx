import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="panel p-6 text-center">
        <p className="panel-title text-amber">Not found</p>
        <p className="mt-3 text-sm text-muted">That record doesn&apos;t exist or you don&apos;t have access to it.</p>
        <Link href="/" className="btn-quiet mt-5">
          Back to home
        </Link>
      </div>
    </main>
  );
}
