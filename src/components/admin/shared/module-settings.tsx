"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Field = {
  key: string;
  label: string;
  type: "number";
  min?: number;
  max?: number;
};

type ModuleSettingsProps = {
  moduleSlug: string;
  fields: Field[];
};

export function ModuleSettings({ moduleSlug, fields }: ModuleSettingsProps) {
  const [config, setConfig] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadSettings() {
    try {
      const res = await fetch(`/api/${moduleSlug}/settings`);
      const json = await res.json();
      if (json.success) setConfig(json.data as Record<string, number>);
    } catch {
      setError("Не удалось загрузить настройки");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/${moduleSlug}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const json = await res.json();
      if (json.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        setError(json.error?.message ?? "Ошибка сохранения");
      }
    } catch {
      setError("Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="py-8 text-center text-sm text-zinc-400 animate-pulse">Загрузка настроек...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="font-semibold text-zinc-900">Настройки модуля</h2>
        <p className="text-xs text-zinc-400 mt-1">
          Изменения сохраняются в конфигурации модуля и логируются в аудит
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-4 max-w-md">
          {fields.map((field) => (
            <div key={field.key}>
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                {field.label}
              </label>
              <input
                type="number"
                value={config[field.key] ?? ""}
                min={field.min}
                max={field.max}
                onChange={(e) => setConfig({ ...config, [field.key]: parseInt(e.target.value, 10) })}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          ))}

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {saved && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-700">
              Настройки сохранены
            </div>
          )}

          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Сохранение..." : "Сохранить"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
