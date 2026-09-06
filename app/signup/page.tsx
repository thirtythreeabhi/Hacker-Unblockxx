import { Suspense } from "react";
import AuthForm from "../../components/AuthForm";

export default function SignupPage() {
  return <Suspense fallback={<div className="page-loading">Loading…</div>}><AuthForm mode="signup" /></Suspense>;
}
