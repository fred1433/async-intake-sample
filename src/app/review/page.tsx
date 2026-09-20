import type { Metadata } from "next";
import { ReviewClient } from "./ReviewClient";

export const metadata: Metadata = { title: "Intake review, sample" };

export default function ReviewPage() {
  return <ReviewClient />;
}
