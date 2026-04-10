import { Navbar } from "@landing/components/navbar";
import { HeroSectionWithVideo } from "@landing/components/hero-section-with-video";
import { OfficesSection } from "@landing/components/offices-section";
import { ServicesSection } from "@landing/components/services-section";
import { AdvantagesSection } from "@landing/components/advantages-section";
import { ReviewsSection } from "@landing/components/reviews-section";
import { ContactsSection } from "@landing/components/contacts-section";
import { Footer } from "@landing/components/footer";

export default function Home() {
  return (
    <div className="bg-white min-h-screen">
      <Navbar />
      <HeroSectionWithVideo />
      <OfficesSection />
      <ServicesSection />
      <AdvantagesSection />
      <ReviewsSection />
      <ContactsSection />
      <Footer />
    </div>
  );
}
