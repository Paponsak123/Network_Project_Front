import { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  isLoading?: boolean;
  loadingText?: string;
  children: ReactNode;
}

export function Button({ isLoading, loadingText, children, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      disabled={isLoading || props.disabled}
      className={`w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-[#003d9b] to-[#0052cc] hover:from-[#0040a2] hover:to-[#0058d6] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#003d9b] shadow-lg shadow-[#003d9b]/20 hover:shadow-xl hover:shadow-[#003d9b]/30 transition-all duration-200 tracking-[0.01em] disabled:opacity-70 disabled:cursor-not-allowed active:scale-[0.98] ${
        props.className || ""
      }`}
    >
      {isLoading ? (
        <div className="flex items-center gap-2">
          <svg
            className="animate-spin h-4 w-4 text-white"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span>{loadingText || "Loading..."}</span>
        </div>
      ) : (
        children
      )}
    </button>
  );
}
