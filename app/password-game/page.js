import Game from "./game";
import HomeLink from "../components/HomeLink";

export const metadata = {
  title: "Password Game",
  description: "Increasingly absurd rules for one password. Can you satisfy them all?",
};

export default function Page() {
  return (
    <>
      <HomeLink />
      <Game />
    </>
  );
}
