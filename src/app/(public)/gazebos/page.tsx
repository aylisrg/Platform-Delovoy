import Link from "next/link";
import { listResources } from "@/modules/gazebos/service";
import { GazeboList } from "@/components/public/gazebos/gazebo-list";
import { BookingFlow } from "@/components/public/gazebos/booking-flow";

export const dynamic = "force-dynamic";

export default async function GazebosPage() {
  const resources = await listResources(true);

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="bg-white border-b border-zinc-200">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <nav className="mb-4">
            <Link href="/" className="text-sm text-blue-600 hover:underline">
              ← Главная
            </Link>
          </nav>
          <h1 className="text-3xl font-bold text-zinc-900">Беседки</h1>
          <p className="mt-2 text-zinc-600">
            Забронируйте беседку на территории бизнес-парка Деловой
          </p>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <section>
          <h2 className="text-xl font-semibold text-zinc-900 mb-4">Наши беседки</h2>
          <GazeboList resources={resources} />
        </section>

        <section className="mt-12">
          <BookingFlow />
        </section>
      </main>
    </div>
  );
}
