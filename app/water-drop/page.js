import Game from "./game";
import HomeLink from "../components/HomeLink";

export const metadata = {
  title: "Water Drop",
  description: "Fill the glass without spilling. Solo or against bots.",
};

export default function Page() {
  return (
    <>
      <HomeLink />
      <Game />
    </>
  );
}
