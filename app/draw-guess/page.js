import Game from "./game";
import HomeLink from "../components/HomeLink";

export const metadata = {
  title: "Draw & Guess",
  description: "One player draws, others race to guess. 2–4 players.",
};

export default function Page() {
  return (
    <>
      <HomeLink />
      <Game />
    </>
  );
}
