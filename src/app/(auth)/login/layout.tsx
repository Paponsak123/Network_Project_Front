import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In - Corporate Portal",
  description: "Sign in to your Corporate Portal account",
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="login-layout min-h-screen flex flex-col">
      {children}
    </div>
  );
}
