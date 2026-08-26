import Game from "./game";
import HomeLink from "../components/HomeLink";

export const metadata = {
  title: "Fruit Merge",
  description: "Drop fruit. Same fruit merges into the next tier. Don't overflow.",
};

export default function Page() {
  return (
    <>
      <HomeLink />
      <Game />
    </>
  );
}
