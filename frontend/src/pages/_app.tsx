import type { AppProps } from "next/app";
import { ToastProvider } from "@/lib/toast";
import { AuthProvider } from "@/lib/authContext";
import "@/styles/globals.css";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <ToastProvider>
      <AuthProvider>
        <Component {...pageProps} />
      </AuthProvider>
    </ToastProvider>
  );
}
