import { useEffect, useRef } from "react";
import Script from "next/script";
import { useAuth } from "@/lib/authContext";
import { useToast } from "@/lib/toast";

// Google Identity Services attaches itself to window at runtime -- no
// npm package needed for the button itself, just this one script tag.
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: { client_id: string; callback: (response: { credential: string }) => void }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, string | number>) => void;
        };
      };
    };
  }
}

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

export default function GoogleSignInButton() {
  const { loginWithGoogle } = useAuth();
  const toast = useToast();
  const containerRef = useRef<HTMLDivElement>(null);

  function renderButton() {
    if (!GOOGLE_CLIENT_ID || !window.google || !containerRef.current) return;
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: async (response) => {
        try {
          await loginWithGoogle(response.credential);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Google sign-in failed.");
        }
      },
    });
    // Idempotent: clears any previously rendered button before drawing a
    // fresh one, so remounting (e.g. navigating login <-> signup) never
    // stacks up duplicate buttons in the same container.
    containerRef.current.innerHTML = "";
    window.google.accounts.id.renderButton(containerRef.current, {
      theme: "filled_black",
      size: "large",
      shape: "rectangular",
      text: "continue_with",
      width: 320,
    });
  }

  useEffect(() => {
    // The GIS script may already be loaded from a previous page (Next's
    // Script component dedupes by src and won't fire onLoad again) --
    // render immediately if so, rather than waiting for an onLoad that
    // will never come a second time.
    if (window.google?.accounts?.id) renderButton();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!GOOGLE_CLIENT_ID) return null;

  return (
    <>
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={renderButton} />
      <div className="google-btn-wrap">
        <div className="auth-divider">
          <span>or</span>
        </div>
        <div ref={containerRef} className="google-btn-target" />
      </div>
    </>
  );
}
