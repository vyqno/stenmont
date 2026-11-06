import { pageMetadata } from "../../lib/seo";
import SignupClient from "./SignupClient";


export const metadata = pageMetadata("/signup");

export default function Page() {
  return <SignupClient />;
}
