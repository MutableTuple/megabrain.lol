import Game from "./game";
import HomeLink from "../components/HomeLink";

export const metadata = {
  title: "RPS Duel",
  description: "Rock, paper, scissors — best of 5. Bot or friend.",
};

export default function Page() {
  return (
    <>
      <HomeLink />
      <Game />
    </>
  );
}
