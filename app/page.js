import Link from "next/link";
import { GAMES } from "./games";
import Nav from "./components/Nav";
import Footer from "./components/Footer";

const ACCENTS = {
  precision: "#4cc9f0",
  race: "#c77dff",
  drawing: "#ffd166",
  reflex: "#06d6a0",
  timing: "#ef476f",
  skill: "#f4a261",
  trivia: "#a8dadc",
  physics: "#f9c74f",
  puzzle: "#b5179e",
};

export default function Home() {
  const ready = GAMES.filter((g) => g.ready);
  const soon = GAMES.filter((g) => !g.ready);
  return (
    <div className="min-h-screen bg-black text-white font-mono flex-1 w-full flex flex-col">
      <Nav />

      {/* Hero */}
      <section className="px-6 sm:px-10 pt-16 sm:pt-24 pb-12 max-w-5xl mx-auto w-full">
        <div className="text-white/40 uppercase tracking-[0.3em] text-[10px] mb-4">megabrain.lol</div>
        <h1 className="text-5xl sm:text-7xl font-semibold tracking-tighter leading-[1.02] mb-5">
          tiny games. <span className="text-white/40">one screen.</span>
          <br />
          no signup.
        </h1>
        <p className="text-white/60 max-w-lg text-base sm:text-lg leading-relaxed">
          A collection of one-shot browser games — draw a perfect circle, race a
          bot at mental math, thread an impossible needle. Pick one and start.
        </p>
      </section>

      {/* Ready grid */}
      <section className="px-6 sm:px-10 max-w-5xl mx-auto w-full">
        <SectionHeader eyebrow="playable" title="pick your poison" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {ready.map((g) => (
            <GameCard key={g.slug} game={g} />
          ))}
        </div>
      </section>

      {/* Coming soon */}
      {soon.length > 0 && (
        <section className="px-6 sm:px-10 max-w-5xl mx-auto w-full mt-16">
          <SectionHeader eyebrow="cooking" title="on the way" />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {soon.map((g) => (
              <SoonCard key={g.slug} game={g} />
            ))}
          </div>
        </section>
      )}

      <div className="flex-1" />
      <Footer />
    </div>
  );
}

function SectionHeader({ eyebrow, title }) {
  return (
    <div className="mb-5">
      <div className="text-white/40 uppercase tracking-widest text-[10px] mb-1">{eyebrow}</div>
      <h2 className="text-xl sm:text-2xl font-semibold tracking-tight">{title}</h2>
    </div>
  );
}

function GameCard({ game }) {
  const accent = ACCENTS[game.tag] || "#ffffff";
  return (
    <Link
      href={`/${game.slug}`}
      className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.05] p-5 flex flex-col gap-3 transition"
    >
      <div
        className="absolute -top-16 -right-16 w-40 h-40 rounded-full opacity-15 group-hover:opacity-25 blur-2xl transition"
        style={{ background: accent }}
      />
      <div className="flex items-start justify-between relative">
        <div className="text-3xl">{game.emoji}</div>
        <div
          className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full"
          style={{ color: accent, background: accent + "18" }}
        >
          {game.tag}
        </div>
      </div>
      <div className="text-lg font-semibold tracking-tight relative">{game.title}</div>
      <p className="text-white/50 text-sm leading-relaxed relative">{game.blurb}</p>
      <div className="mt-auto text-white/60 text-xs relative flex items-center gap-1 group-hover:text-white transition">
        play <span className="group-hover:translate-x-0.5 transition-transform">→</span>
      </div>
    </Link>
  );
}

function SoonCard({ game }) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 flex flex-col gap-2 text-white/40">
      <div className="text-xl">{game.emoji}</div>
      <div className="text-sm font-medium tracking-tight text-white/70">{game.title}</div>
      <div className="text-[10px] uppercase tracking-widest">{game.tag}</div>
    </div>
  );
}
