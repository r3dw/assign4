import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Current Apple OS Versions",
  description: "The latest released and beta versions of Apple's operating systems.",
};

// Apply the saved theme and text size before first paint to avoid a flash.
const PRE_PAINT = `(function () {
  try {
    var theme = localStorage.getItem("theme");
    if (!theme) {
      theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.dataset.theme = theme;
    var size = localStorage.getItem("textSize");
    if (size) document.documentElement.dataset.size = size;
  } catch (e) { /* storage unavailable: keep defaults */ }
})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The script above changes data-theme and data-size before React hydrates.
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PRE_PAINT }} />
      </head>
      <body>
        <ClerkProvider>{children}</ClerkProvider>
      </body>
    </html>
  );
}
