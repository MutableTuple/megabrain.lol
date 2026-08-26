import Game from "./game";
import HomeLink from "../components/HomeLink";

export const metadata = {
  title: "Higher or Lower",
  description: "Which one gets more Google searches? Keep the streak alive.",
};

export default function Page() {
  return (
    <>
      <HomeLink />
      <Game />
    </>
  );
}
