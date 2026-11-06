import { pageMetadata } from "../../lib/seo";
import LoginClient from "./LoginClient";


export const metadata = pageMetadata("/login");

export default function Page() {
  return <LoginClient />;
}
