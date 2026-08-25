import Game from "./game";
import HomeLink from "../components/HomeLink";

export const metadata = {
  title: "Perfect Shape",
  description: "Draw a circle, square, or rectangle. See how close to perfect you got.",
};

export default function Page() {
  return (
    <>
      <HomeLink />
      <Game />
    </>
  );
}
