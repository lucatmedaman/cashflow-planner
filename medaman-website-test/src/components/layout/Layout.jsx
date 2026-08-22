import { Outlet } from "react-router-dom";
import Header from "./Header";
import Footer from "./Footer";
import ScrollNaarBoven from "./ScrollNaarBoven";

export default function Layout() {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#inhoud"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded focus:bg-primair focus:px-4 focus:py-2 focus:text-white focus:no-underline"
      >
        Naar de inhoud
      </a>
      <ScrollNaarBoven />
      <Header />
      <main id="inhoud" className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
