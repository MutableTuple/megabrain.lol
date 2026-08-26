import Game from "./game";
import HomeLink from "../components/HomeLink";

export const metadata = {
  title: "Trivia Rumble",
  description: "2–4 player trivia race. Fastest correct answer wins the round.",
};

export default function Page() {
  return (
    <>
      <HomeLink />
      <Game />
    </>
  );
}
