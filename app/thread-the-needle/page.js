import Game from "./game";
import HomeLink from "../components/HomeLink";

export const metadata = {
  title: "Thread the Needle",
  description: "Steady your hand and thread the impossible needle.",
};

export default function Page() {
  return (
    <>
      <HomeLink />
      <Game />
    </>
  );
}
