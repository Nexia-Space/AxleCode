import type { Metadata } from "next";

import { Shell } from "./shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Axle Analytics",
  description: "Operations dashboard for Axle.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}