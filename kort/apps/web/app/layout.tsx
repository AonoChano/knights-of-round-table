import "./styles/01-base.css";
import "./styles/02-toolbar.css";
import "./styles/03-models-attachments.css";
import "./styles/04-voice-thinking.css";
import "./styles/05-thinking-discussion.css";
import "./styles/06-agent-code.css";
import "./styles/07-citations-cards.css";
import "./styles/08-settings.css";
import "./styles/09-responsive.css";
import "./styles/10-scrollbars.css";
import "./styles/11-memory.css";
import "./styles/12-search.css";
import "./discussion.css";
import "./models.css";
import type { Metadata } from "next";
import { ReactNode } from "react";

export const metadata: Metadata = {
  title: "KORT",
  description: "Knights of the Round Table",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
