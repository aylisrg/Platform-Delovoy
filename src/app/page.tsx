import { Navbar } from "@/components/public/landing/navbar";
import { HeroSectionWithVideo } from "@/components/public/landing/hero-section-with-video";
import { OfficesSection } from "@/components/public/landing/offices-section";
import { ServicesSection } from "@/components/public/landing/services-section";
import { AdvantagesSection } from "@/components/public/landing/advantages-section";
import { ReviewsSection } from "@/components/public/landing/reviews-section";
import { ContactsSection } from "@/components/public/landing/contacts-section";
import { Footer } from "@/components/public/landing/footer";

export default function Home() {
  return (
    <div className="bg-black min-h-screen">
      <Navbar />
      <HeroSection />
      <OfficesSection />
      <ServicesSection />
      <AdvantagesSection />
      <ContactsSection />
      <Footer />
    </div>
  );
}
