import Game from "./game";
import HomeLink from "../components/HomeLink";

export const metadata = {
  title: "Chess",
  description: "Play chess against a bot or a friend. Free forever.",
};

export default function Page() {
  return (
    <>
      <HomeLink />
      <Game />
    </>
  );
}
