import Game from "./game";
import HomeLink from "../components/HomeLink";

export const metadata = {
  title: "Aim Trainer",
  description: "Pop 30 targets as fast as you can. Miss = penalty. Aimlab in your browser.",
};

export default function Page() {
  return (
    <>
      <HomeLink />
      <Game />
    </>
  );
}
