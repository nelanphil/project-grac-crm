export type XaiListedModel = {
  id: string;
  aliases: string[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function textOutputs(row: Record<string, unknown>): boolean {
  const outputs = row.output_modalities;
  if (!Array.isArray(outputs) || outputs.length === 0) return true;
  return outputs.some((item) => item === "text");
}

/** Newest chat models first. Image-only models are left out. */
export function parseXaiModelList(body: unknown): XaiListedModel[] {
  const record = asRecord(body);
  const rows = Array.isArray(record?.models)
    ? record.models
    : Array.isArray(record?.data)
      ? record.data
      : [];
  const parsed = rows
    .map((row) => {
      const item = asRecord(row);
      if (!item || !textOutputs(item)) return null;
      const id = typeof item.id === "string" ? item.id.trim() : "";
      if (!id) return null;
      const aliases = Array.isArray(item.aliases)
        ? item.aliases
            .filter((alias): alias is string => typeof alias === "string")
            .map((alias) => alias.trim())
            .filter((alias) => alias && alias !== id)
        : [];
      const created = typeof item.created === "number" ? item.created : 0;
      return { id, aliases, created };
    })
    .filter((item): item is { id: string; aliases: string[]; created: number } => Boolean(item));
  parsed.sort((left, right) => right.created - left.created || left.id.localeCompare(right.id));
  const seen = new Set<string>();
  return parsed.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).map(({ id, aliases }) => ({ id, aliases }));
}
