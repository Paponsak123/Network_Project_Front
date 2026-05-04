import Image from "next/image";

export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center p-8 text-center min-h-[50vh]">
      <h1 className="text-4xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-500">
        Welcome to Network Monitor
      </h1>
      <p className="text-lg text-slate-600 dark:text-zinc-400 max-w-xl">
        Navigate using the top bar to view your devices, scan history, and configure your profile.
      </p>
    </div>
  );
}
