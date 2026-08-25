import Game from "./game";
import HomeLink from "../components/HomeLink";

export const metadata = {
  title: "Reaction Time",
  description: "Wait for green. Click as fast as you can. Best of 5 average.",
};

export default function Page() {
  return (
    <>
      <HomeLink />
      <Game />
    </>
  );
}
