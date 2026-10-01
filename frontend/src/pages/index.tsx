import { ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/authContext";
import LandingPage from "@/components/LandingPage";
import Dashboard from "@/components/Dashboard";

function SplashScreen() {
  return (
    <div className="splash-screen">
      <div className="brand-mark">
        <ShieldCheck size={22} />
      </div>
    </div>
  );
}

export default function HomePage() {
  const { user, loading } = useAuth();

  if (loading) return <SplashScreen />;
  if (!user) return <LandingPage />;
  return <Dashboard />;
}
