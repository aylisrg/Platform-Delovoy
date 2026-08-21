import Link from "next/link";

/**
 * Ссылки на юридические документы и реквизиты Исполнителя.
 *
 * Реквизиты ИП в футере — требование ст. 9 Закона РФ «О защите прав
 * потребителей» (исполнитель обязан довести до потребителя фирменное
 * наименование и сведения о госрегистрации), а не косметика. Строка обязана
 * быть на всех страницах сайта, поэтому она вынесена в один компонент —
 * футеров на сайте несколько.
 */
export function LegalFooterLinks({ variant = "light" }: { variant?: "light" | "dark" }) {
  const text = variant === "dark" ? "text-zinc-500" : "text-[#86868b]";
  const link =
    variant === "dark"
      ? "text-zinc-400 hover:text-zinc-200 underline underline-offset-2 transition-colors"
      : "text-[#5a5a5f] hover:text-[#1d1d1f] underline underline-offset-2 transition-colors";

  return (
    <p className={`text-xs font-[family-name:var(--font-inter)] leading-relaxed ${text}`}>
      <Link href="/oferta" className={link}>
        Публичная оферта
      </Link>
      <span className="mx-2">·</span>
      <Link href="/privacy" className={link}>
        Политика обработки персональных данных
      </Link>
      <span className="mx-2">·</span>
      <span className="whitespace-nowrap">ИП Павленко Л. П., ОГРНИП 305770002665641</span>
    </p>
  );
}
