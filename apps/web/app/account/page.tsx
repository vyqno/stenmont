import { pageMetadata } from "../../lib/seo";
import AccountClient from "./AccountClient";


export const metadata = pageMetadata("/account");

export default function AccountPage() {
  return <AccountClient />;
}
