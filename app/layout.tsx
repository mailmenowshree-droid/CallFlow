import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "CallFlow | Support Operations", description: "Call assignment, scheduling, attendance and reporting." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
