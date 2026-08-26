import Game from "./game";
import HomeLink from "../components/HomeLink";

export const metadata = {
  title: "Odd One Out",
  description: "Grid of dots. One is different. Spot it faster than your opponent.",
};

export default function Page() {
  return (
    <>
      <HomeLink />
      <Game />
    </>
  );
}
