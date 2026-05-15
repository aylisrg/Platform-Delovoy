import { AdminHeader } from "@/components/admin/header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { forbidden, notFound } from "next/navigation";
import { hasAdminSectionAccess } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { EmailTemplateEditor } from "@/components/admin/rental/email-template-editor";
import { ALLOWED_VARIABLES } from "@/modules/rental/template-engine";

export const dynamic = "force-dynamic";

export default async function NedelovoyEmailTemplatePage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) forbidden();
  const ok = await hasAdminSectionAccess(session.user.id, "nedelovoy");
  if (!ok) forbidden();

  const { key } = await params;
  const decodedKey = decodeURIComponent(key);
  const tpl = await prisma.emailTemplate.findUnique({
    where: { parkSlug_key: { parkSlug: "nedelovoy", key: decodedKey } },
  });
  if (!tpl) notFound();

  return (
    <>
      <AdminHeader title={`Шаблон: ${tpl.name}`} />
      <div className="p-6 lg:p-8 max-w-6xl">
        <Card>
          <CardHeader>
            <p className="text-sm text-zinc-500">
              Ключ: <span className="font-mono">{tpl.key}</span>
              {tpl.isSystem && <span className="ml-2 text-blue-600">· системный</span>}
            </p>
          </CardHeader>
          <CardContent>
            <EmailTemplateEditor
              initial={{
                key: tpl.key,
                name: tpl.name,
                subject: tpl.subject,
                bodyHtml: tpl.bodyHtml,
                bodyText: tpl.bodyText ?? "",
                isActive: tpl.isActive,
                isSystem: tpl.isSystem,
              }}
              allowedVariables={[...ALLOWED_VARIABLES]}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
