"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "../lib/supabase/client";

export default function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const destination = searchParams.get("next") || "/";
  const isSignup = mode === "signup";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);

    const supabase = createClient();
    const result = isSignup
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });

    if (result.error) {
      setError(result.error.message);
    } else if (isSignup && !result.data.session) {
      setMessage("Account created. Disable Confirm email in Supabase Auth to sign in immediately.");
    } else {
      router.replace(destination);
      router.refresh();
    }
    setSubmitting(false);
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <Link className="auth-brand" href="/">HB <span>HackerBlocks</span></Link>
        <p className="eyebrow">{isSignup ? "CREATE ACCOUNT" : "WELCOME BACK"}</p>
        <h1>{isSignup ? "Save your progress." : "Continue learning."}</h1>
        <p className="auth-subtitle">{isSignup ? "Bookmark questions and track what you have completed." : "Log in to see your bookmarks and completed problems."}</p>
        <form className="auth-form" onSubmit={submit}>
          <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
          <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={isSignup ? "new-password" : "current-password"} minLength={6} required /></label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          {message && <p className="auth-message" role="status">{message}</p>}
          <button className="auth-submit" type="submit" disabled={submitting}>{submitting ? "Working…" : isSignup ? "Create account" : "Log in"}</button>
        </form>
        <p className="auth-switch">{isSignup ? "Already have an account?" : "Need an account?"} <Link href={isSignup ? `/login?next=${encodeURIComponent(destination)}` : `/signup?next=${encodeURIComponent(destination)}`}>{isSignup ? "Log in" : "Sign up"}</Link></p>
        <Link className="auth-back" href="/">← Back to browser</Link>
      </section>
    </main>
  );
}
