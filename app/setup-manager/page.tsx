"use client";

import { FormEvent, useState } from "react";

export default function SetupManagerPage() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (password.length < 14) {
      setMessage("Use a password with at least 14 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setMessage("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/bootstrap", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          email: "sreekanth.mathangi@movate.com",
          name: "Sreekanth Mathangi",
          password,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not create Manager account.");
      setMessage("Manager account created. Remove CALLFLOW_BOOTSTRAP_TOKEN and BOOTSTRAP_MANAGER_EMAIL from Vercel Preview environment variables, redeploy the preview, then sign in with your email and the password you just created.");
      setToken("");
      setPassword("");
      setConfirmPassword("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create Manager account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-12 text-slate-900">
      <section className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">CallFlow · Initial setup</p>
        <h1 className="mt-2 text-2xl font-semibold">Create Manager account</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          One-time setup for sreekanth.mathangi@movate.com. Create a strong password and keep it private.
        </p>
        <form className="mt-6 space-y-4" onSubmit={submit}>
          <label className="block text-sm font-medium">
            Temporary setup token
            <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" type="password" autoComplete="off" required value={token} onChange={(event) => setToken(event.target.value)} />
          </label>
          <label className="block text-sm font-medium">
            New password (14+ characters)
            <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" type="password" autoComplete="new-password" minLength={14} required value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <label className="block text-sm font-medium">
            Confirm password
            <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" type="password" autoComplete="new-password" minLength={14} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
          </label>
          <button disabled={busy} className="w-full rounded-lg bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-50" type="submit">
            {busy ? "Creating account…" : "Create Manager account"}
          </button>
        </form>
        {message && <p role="status" className="mt-4 rounded-lg bg-slate-100 p-3 text-sm leading-6">{message}</p>}
      </section>
    </main>
  );
}
