"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthLayout } from "@/components/AuthLayout";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";
import { Icons } from "@/components/Icons";
import { getApiUrl } from "@/utils/config";
import { fetchClient, isAbortError } from "@/utils/fetchClient";

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setSuccessMsg(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters long");
      setIsLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      setIsLoading(false);
      return;
    }

    try {
      // Registration is NOT auto-retried — duplicate writes would create double users.
      const res = await fetchClient(`${getApiUrl()}/api/auth/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "true",
        },
        body: JSON.stringify({ username, password }),
        retries: 0,
      });

      let data: any = null;
      try {
        data = await res.json();
      } catch {
        /* empty body */
      }

      if (!res.ok) {
        const msg = data?.detail?.message || data?.message || "Registration failed";
        throw new Error(msg);
      }

      setSuccessMsg("Account created successfully! Redirecting to login...");

      setTimeout(() => {
        router.push("/login");
      }, 1500);

    } catch (err: any) {
      const aborted = isAbortError(err);
      if (!aborted) console.error("Registration failed:", err);
      setError(
        aborted
          ? "Server is taking too long to respond. Please try again."
          : err?.message || "An unexpected error occurred"
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Create Account"
      subtitle="Join ScanDer today"
      footerText="Already have an account?"
      footerLink="/login"
      footerLinkText="Sign in"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="p-3 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-500/20 rounded-xl text-sm font-medium flex items-center justify-center gap-2">
            {error}
          </div>
        )}

        {successMsg && (
          <div className="p-3 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20 rounded-xl text-sm font-medium flex items-center justify-center gap-2">
            <Icons.CheckCircle />
            {successMsg}
          </div>
        )}

        <Input
          label="Username"
          id="username"
          name="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Choose a username"
          icon={<Icons.User />}
          required
          autoComplete="username"
        />

        <Input
          label="Password"
          id="password"
          name="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Min. 8 characters"
          icon={<Icons.Lock />}
          isPassword
          required
          autoComplete="new-password"
        />

        <Input
          label="Confirm Password"
          id="confirmPassword"
          name="confirmPassword"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Repeat your password"
          icon={<Icons.Lock />}
          isPassword
          required
          autoComplete="new-password"
        />

        <div className="pt-4">
          <Button type="submit" isLoading={isLoading} loadingText="Creating account..." disabled={successMsg !== null}>
            Sign Up
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
