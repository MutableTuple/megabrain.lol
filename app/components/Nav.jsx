import Link from "next/link";
import { GAMES } from "../games";

export default function Nav() {
  const ready = GAMES.filter((g) => g.ready);
  return (
    <nav className="w-full sticky top-0 z-40 backdrop-blur-md bg-black/40 border-b border-white/5">
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-4 px-4 sm:px-8 h-14">
        <Link
          href="/"
          className="text-white text-base sm:text-lg font-semibold tracking-tight"
        >
          megabrain<span className="text-white/40">.lol</span>
        </Link>
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar text-xs sm:text-sm font-mono">
          {ready.map((g) => (
            <Link
              key={g.slug}
              href={`/${g.slug}`}
              className="text-white/60 hover:text-white transition px-2 sm:px-3 py-1 rounded-full hover:bg-white/5 whitespace-nowrap"
            >
              {g.title.toLowerCase()}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
