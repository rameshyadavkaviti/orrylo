import { redirect } from "next/navigation";
import type { Metadata } from "next";

/** Routes visitors to the existing, independently hosted token-creation service.
 * Its authentication cookies and signer trust boundary remain on its own origin.
 */
export const metadata: Metadata = {
  title: "Create Token",
  description: "Open ORRYLO Token Studio to configure a Stellar Classic Asset with Albedo or LOBSTR."
};

export default function CreateTokenRoute() {
  redirect("https://orrylo-production.up.railway.app/create-token");
}
