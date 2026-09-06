import { Suspense } from "react";
import BrowserApp from "../components/BrowserApp";
import { ProgressProvider } from "../lib/progress";

export default function HomePage() {
  return (
    <Suspense fallback={<div className="page-loading">Loading HackerBlocks Browser…</div>}>
      <ProgressProvider><BrowserApp /></ProgressProvider>
    </Suspense>
  );
}
