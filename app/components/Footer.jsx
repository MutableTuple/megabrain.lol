import Link from "next/link";
import { GAMES } from "../games";

export default function Footer() {
  const ready = GAMES.filter((g) => g.ready);
  const soon = GAMES.filter((g) => !g.ready);
  return (
    <footer className="w-full border-t border-white/5 mt-24 py-12 px-6 sm:px-10 bg-black text-white/60 font-mono text-sm">
      <div className="max-w-5xl mx-auto flex flex-col gap-10">
        <div className="flex flex-col sm:flex-row sm:justify-between gap-8">
          <div>
            <Link href="/" className="text-white text-lg font-semibold tracking-tight">
              megabrain.lol
            </Link>
            <div className="text-white/40 text-xs mt-1">tiny games. one screen. no signup.</div>
          </div>
          <div className="flex gap-10 flex-wrap">
            <div>
              <div className="text-white/40 uppercase text-[10px] tracking-widest mb-3">play</div>
              <ul className="space-y-2">
                {ready.map((g) => (
                  <li key={g.slug}>
                    <Link href={`/${g.slug}`} className="hover:text-white transition">
                      {g.title.toLowerCase()}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-white/40 uppercase text-[10px] tracking-widest mb-3">soon</div>
              <ul className="space-y-2">
                {soon.map((g) => (
                  <li key={g.slug} className="text-white/30">
                    {g.title.toLowerCase()}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        <div className="text-white/30 text-xs">© {new Date().getFullYear()} megabrain.lol</div>
      </div>
    </footer>
  );
}
