import Link from "next/link";
import { forbidden } from "next/navigation";
import QRCode from "qrcode";
import { AdminHeader } from "@/components/admin/header";
import { auth } from "@/lib/auth";
import { hasAdminSectionAccess } from "@/lib/permissions";
import { PrintButton } from "@/components/admin/cafe/print-button";

export const dynamic = "force-dynamic";

/**
 * Печатный QR-код для кассы: ведёт на публичное меню /cafe. Клиент сканирует,
 * собирает корзину и оплачивает онлайн (СБП/карта). Кнопка печати — @media
 * print прячет всё, кроме карточки.
 */
export default async function CafeQrPage() {
  const session = await auth();
  if (!session?.user?.id) forbidden();
  const ok = await hasAdminSectionAccess(session.user.id, "cafe");
  if (!ok) forbidden();

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://delovoy-park.ru";
  const cafeUrl = `${baseUrl}/cafe`;
  const svg = await QRCode.toString(cafeUrl, {
    type: "svg",
    margin: 1,
    width: 512,
    errorCorrectionLevel: "M",
    color: { dark: "#18181b", light: "#ffffff" },
  });

  return (
    <>
      <div className="print:hidden">
        <AdminHeader title="Кафе — QR для кассы" />
      </div>
      <div className="p-8 print:p-0">
        <div className="print:hidden mb-6 flex items-center gap-4">
          <PrintButton />
          <p className="text-sm text-zinc-500">
            Распечатайте карточку и поставьте у кассы. QR ведёт на {cafeUrl}
          </p>
        </div>

        {/* Печатная карточка (примерно A5 в портрете) */}
        <div className="mx-auto w-full max-w-sm rounded-2xl border-2 border-zinc-900 bg-white p-8 text-center print:max-w-none print:rounded-none print:border-0">
          <p className="text-2xl font-bold text-zinc-900">Кафе Деловой</p>
          <p className="mt-1 text-sm text-zinc-500">
            Меню и оплата онлайн — без очереди на кассе
          </p>
          <div
            className="mx-auto mt-6 w-full max-w-[280px] print:max-w-[360px] [&_svg]:h-auto [&_svg]:w-full"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <ol className="mx-auto mt-6 max-w-[280px] space-y-1 text-left text-sm text-zinc-600">
            <li>1. Наведите камеру телефона на QR</li>
            <li>2. Соберите корзину</li>
            <li>3. Оплатите — СБП или карта</li>
            <li>4. Покажите экран «Оплачено» бариста</li>
          </ol>
        </div>

        <div className="print:hidden mt-6">
          <Link href="/admin/cafe" className="text-sm text-blue-600 hover:underline">
            ← Назад к управлению кафе
          </Link>
        </div>
      </div>
    </>
  );
}
