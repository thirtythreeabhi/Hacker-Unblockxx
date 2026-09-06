import { Suspense } from "react";
import BrowserApp from "../components/BrowserApp";

export default function HomePage() {
  return (
    <Suspense fallback={<div className="page-loading">Loading HackerBlocks Browser…</div>}>
      <BrowserApp />
    </Suspense>
  );
}
