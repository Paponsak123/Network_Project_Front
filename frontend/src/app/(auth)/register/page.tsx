"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthLayout } from "@/components/AuthLayout";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";
import { Icons } from "@/components/Icons";

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
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "true"
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.message || "Registration failed");

      setSuccessMsg("Account created successfully! Redirecting to login...");

      setTimeout(() => {
        router.push("/login");
      }, 1500);

    } catch (err: any) {
      console.error("Registration failed:", err);
      setError(err.message || "An unexpected error occurred");
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
          <div className="p-3 bg-red-50 text-red-600 border border-red-200 rounded-lg text-sm text-center">
            {error}
          </div>
        )}

        {successMsg && (
          <div className="p-3 bg-green-50 text-green-700 border border-green-200 rounded-lg text-sm text-center font-medium flex items-center justify-center gap-2">
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
