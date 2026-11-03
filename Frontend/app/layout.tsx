import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Interview Proctor",
  description:
    "AI-assisted browser-based interview proctoring — detects violations in real time and lets the server decide on warnings and terminations.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
