import type { Metadata } from "next";
import { IntakeClient } from "./IntakeClient";

export const metadata: Metadata = { title: "Family intake, sample" };

export default function IntakePage() {
  return <IntakeClient />;
}
