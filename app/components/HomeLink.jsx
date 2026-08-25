import Link from "next/link";

export default function HomeLink() {
  return (
    <Link
      href="/"
      className="fixed top-2 left-2 sm:top-3 sm:left-3 z-30 text-white/40 hover:text-white text-[10px] sm:text-xs font-mono tracking-widest uppercase px-2 py-1 rounded-full bg-black/30 hover:bg-black/50 backdrop-blur-sm transition"
    >
      ← megabrain
    </Link>
  );
}
