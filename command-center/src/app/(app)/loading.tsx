export default function Loading() {
  return (
    <div className="flex items-center gap-3 py-10 font-mono text-xs uppercase tracking-[0.2em] text-cyan/70">
      <span className="h-2 w-2 animate-ping rounded-full bg-cyan" />
      Loading
    </div>
  );
}
