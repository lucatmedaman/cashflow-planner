import { Route, Routes } from "react-router-dom";
import Layout from "./components/layout/Layout";
import Home from "./pages/Home";
import Diensten from "./pages/Diensten";
import OverOns from "./pages/OverOns";
import Contact from "./pages/Contact";
import NietGevonden from "./pages/NietGevonden";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="diensten" element={<Diensten />} />
        <Route path="over-ons" element={<OverOns />} />
        <Route path="contact" element={<Contact />} />
        <Route path="*" element={<NietGevonden />} />
      </Route>
    </Routes>
  );
}
