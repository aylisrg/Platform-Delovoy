import Link from "next/link";

const modules = [
  {
    title: "Беседки",
    description: "Бронирование беседок на территории парка",
    href: "/gazebos",
  },
  {
    title: "PlayStation Park",
    description: "Забронируйте стол с PlayStation",
    href: "/ps-park",
  },
  {
    title: "Кафе",
    description: "Меню и заказ еды с доставкой в офис",
    href: "/cafe",
  },
  {
    title: "Парковка",
    description: "Информация о парковке и правила",
    href: "/parking",
  },
  {
    title: "Аренда офисов",
    description: "Каталог офисов, цены и условия аренды",
    href: "/rental",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="bg-white border-b border-zinc-200">
        <div className="max-w-4xl mx-auto px-4 py-12 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-zinc-900">
            Деловой Парк
          </h1>
          <p className="mt-4 text-lg text-zinc-600">
            Платформа управления бизнес-парком
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            Селятино, Московская область
          </p>
          <div className="mt-6 flex justify-center gap-4">
            <Link
              href="/dashboard"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              Личный кабинет
            </Link>
            <Link
              href="/admin/dashboard"
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
            >
              Админ-панель
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-12">
        <h2 className="text-xl font-semibold text-zinc-900 mb-6">Сервисы</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {modules.map((mod) => (
            <Link
              key={mod.href}
              href={mod.href}
              className="rounded-xl border border-zinc-200 bg-white p-6 hover:border-blue-300 hover:shadow-sm transition-all"
            >
              <h3 className="text-lg font-semibold text-zinc-900">{mod.title}</h3>
              <p className="mt-1 text-sm text-zinc-500">{mod.description}</p>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
