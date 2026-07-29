import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastContainer } from "@/components/ui/custom-toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import { SettingsProvider } from "@/contexts/settings-context";
import Home from "@/pages/home";
import Upload from "@/pages/upload";
import Saved from "@/pages/saved";
import ProductRequest from "@/pages/product-request";
import LoginPage, { isLoggedIn, SESSION_KEY } from "@/pages/login";
import RegisterPage from "@/pages/register";
import ARViewer from "@/pages/ar-viewer";
import { useLocation, Router as WouterRouter } from "wouter";

const queryClient = new QueryClient();

// Keep all pages mounted — hide inactive with CSS
// This prevents Home from unmounting during generation
const validPages = ["/", "/history", "/saved", "/upload", "/request"];

function Pages() {
  const [location] = useLocation();
  const isValid = validPages.includes(location);

  return (
    <>
      <div style={{ display: location === "/" ? "block" : "none", height: "100%" }}>
        <Home />
      </div>
      <div style={{ display: (location === "/saved" || location === "/history") ? "block" : "none", height: "100%" }}>
        <Saved />
      </div>
      <div style={{ display: location === "/upload" ? "block" : "none", height: "100%" }}>
        <Upload />
      </div>
      <div style={{ display: location === "/request" ? "block" : "none", height: "100%" }}>
        <ProductRequest />
      </div>
      {!isValid && (
        <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px" }}>
          <div style={{ fontSize: "48px", opacity: 0.3 }}>404</div>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "20px", fontWeight: 700 }}>Page not found</div>
          <a href="/" style={{ color: "var(--cyan-text)", fontSize: "14px" }}>Go to Generate</a>
        </div>
      )}
    </>
  );
}

function App() {
  // Auth guard — check localStorage; re-check on storage events (multi-tab logout)
  const [authed, setAuthed] = useState(isLoggedIn);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SESSION_KEY) setAuthed(e.newValue === "1");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Public routes — no auth required
  const isAR       = window.location.pathname === "/ar";
  const isRegister = window.location.pathname === "/register";

  return (
    <SettingsProvider>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ToastContainer />
        {isAR ? (
          /* No auth required — standalone page for mobile AR */
          <ARViewer />
        ) : isRegister && !authed ? (
          /* Public registration page — redirect home if already logged in */
          <RegisterPage />
        ) : !authed ? (
          /* Login page is full-screen — no Layout/sidebar */
          <LoginPage />
        ) : (
          <WouterRouter>
            <Layout>
              <Pages />
            </Layout>
          </WouterRouter>
        )}
      </TooltipProvider>
    </QueryClientProvider>
    </SettingsProvider>
  );
}

export default App;
