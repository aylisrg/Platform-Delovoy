"use client";

type Props = {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
};

export function ConfigEditor({ config, onChange }: Props) {
  const entries = Object.entries(config);

  function handleValueChange(key: string, value: string) {
    onChange({ ...config, [key]: value });
  }

  function handleKeyChange(oldKey: string, newKey: string) {
    const updated: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(config)) {
      updated[k === oldKey ? newKey : k] = v;
    }
    onChange(updated);
  }

  function handleRemove(key: string) {
    const updated = { ...config };
    delete updated[key];
    onChange(updated);
  }

  function handleAddKey() {
    const newKey = `key${entries.length + 1}`;
    onChange({ ...config, [newKey]: "" });
  }

  return (
    <div className="space-y-2">
      {entries.length === 0 && (
        <p className="text-sm text-zinc-400">Конфиг пуст. Добавьте параметры ниже.</p>
      )}
      {entries.map(([key, val]) => (
        <div key={key} className="flex items-center gap-2">
          <input
            type="text"
            value={key}
            onChange={(e) => handleKeyChange(key, e.target.value)}
            className="w-36 rounded border border-zinc-300 px-2 py-1 text-xs font-mono text-zinc-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
            placeholder="ключ"
          />
          <span className="text-zinc-400 text-sm">:</span>
          <input
            type="text"
            value={String(val ?? "")}
            onChange={(e) => handleValueChange(key, e.target.value)}
            className="flex-1 rounded border border-zinc-300 px-2 py-1 text-xs font-mono text-zinc-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
            placeholder="значение"
          />
          <button
            type="button"
            onClick={() => handleRemove(key)}
            className="text-zinc-400 hover:text-red-500 text-xs px-1"
            aria-label="Удалить"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={handleAddKey}
        className="mt-1 text-xs text-blue-600 hover:underline"
      >
        + Добавить параметр
      </button>
    </div>
  );
}
