"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthLayout } from "@/components/AuthLayout";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";
import { Icons } from "@/components/Icons";
import { getApiUrl } from "@/utils/config";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`${getApiUrl()}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "true"
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.message || "Invalid credentials");

      if (data.token) {
        localStorage.setItem("token", data.token);
        router.push("/");
      } else {
        throw new Error("No token received from server");
      }
    } catch (err: any) {
      console.error("Login failed:", err);
      setError(err.message || "An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Sign In"
      subtitle="Welcome to ScanDer"
      footerText="Don't have an account?"
      footerLink="/register"
      footerLinkText="Sign up"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="p-3 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-500/20 rounded-xl text-sm font-medium flex items-center justify-center gap-2">
            {error}
          </div>
        )}

        <Input
          label="Username"
          id="username"
          name="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Enter your username"
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
          placeholder="••••••••"
          icon={<Icons.Lock />}
          isPassword
          required
          autoComplete="current-password"
        />

        <div className="flex items-center justify-between pt-1">
          <label htmlFor="remember-me" className="flex items-center cursor-pointer group/check">
            <input
              id="remember-me"
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700 text-indigo-600 focus:ring-indigo-500 bg-zinc-50 dark:bg-zinc-800 transition-colors cursor-pointer"
            />
            <span className="ml-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 group-hover/check:text-zinc-900 dark:group-hover/check:text-zinc-200 transition-colors select-none">
              Remember me
            </span>
          </label>
          <a href="#" className="text-sm font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors">
            Forgot password?
          </a>
        </div>

        <div className="pt-2">
          <Button type="submit" isLoading={isLoading} loadingText="Signing in...">
            Sign In
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
