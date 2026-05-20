import type { Metadata } from "next";
import { StrategyVisualDemo } from "./StrategyVisualDemo";

export const metadata: Metadata = {
  title: "Strategy Visual Demo",
  description: "Hybrid easy and advanced strategy visualization demo",
};

export default function StrategyVisualDemoPage() {
  return <StrategyVisualDemo />;
}
