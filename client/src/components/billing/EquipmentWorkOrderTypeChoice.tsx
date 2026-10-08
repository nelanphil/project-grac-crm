import {
  NEW_INSTALL_WORK_ORDER_TYPE_SLUG,
  SWAP_WORK_ORDER_TYPE_SLUG,
  type WorkOrderTypeChoice,
} from "@/lib/service-ticket";

export default function EquipmentWorkOrderTypeChoice({
  types,
  value,
  message,
  onChange,
}: {
  types: WorkOrderTypeChoice[];
  value: string | null;
  message?: string | null;
  onChange: (type: WorkOrderTypeChoice) => void;
}) {
  const install = types.find((type) => type.slug === NEW_INSTALL_WORK_ORDER_TYPE_SLUG);
  const swap = types.find((type) => type.slug === SWAP_WORK_ORDER_TYPE_SLUG);
  const choices = [install, swap].filter((type): type is WorkOrderTypeChoice =>
    Boolean(type),
  );

  return (
    <div className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2.5 text-sm text-violet-950">
      <p className="font-medium">This includes equipment. Work order type</p>
      {message ? <p className="mt-1 text-xs text-red-700">{message}</p> : null}
      {choices.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {choices.map((type) => {
            const selected = value === type._id;
            return (
              <button
                key={type._id}
                type="button"
                aria-pressed={selected}
                onClick={() => onChange(type)}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                  selected
                    ? "border-violet-700 bg-violet-700 text-white"
                    : "border-violet-300 bg-white text-violet-950 hover:bg-violet-100"
                }`}
              >
                {type.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
