import Game from "./game";
import HomeLink from "../components/HomeLink";

export const metadata = {
  title: "Emojile",
  description: "A phrase in emoji. Five guesses. New puzzle daily.",
};

export default function Page() {
  return (
    <>
      <HomeLink />
      <Game />
    </>
  );
}
