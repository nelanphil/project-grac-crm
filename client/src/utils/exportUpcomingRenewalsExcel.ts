import type { ContractListItem } from "@/lib/api";
import { STANDING_LABELS } from "@/lib/contractDates";
import { formatContractCatalogLabel } from "@/lib/contractTypes";
import {
  formatCustomerRecordName,
  formatCustomerState,
  toProperCase,
} from "@/lib/formatName";

const EMPTY = "—";
const TEXT_COLUMNS = new Set(["Phone", "Zip"]);

function formatPhone(phone: string | undefined | null): string {
  if (!phone) return EMPTY;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)})${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

export function upcomingRenewalsExcelFilename(
  year: number,
  monthIndex: number,
): string {
  const month = String(monthIndex + 1).padStart(2, "0");
  return `upcoming-renewals-${year}-${month}.xlsx`;
}

export function mapUpcomingRenewalsToExcelRows(contracts: ContractListItem[]) {
  return contracts.map((contract) => ({
    Customer: contract.customer
      ? formatCustomerRecordName(contract.customer)
      : `Customer #${contract.customerId}`,
    Phone: formatPhone(contract.customer?.phone),
    Street: contract.customer?.address
      ? toProperCase(contract.customer.address)
      : EMPTY,
    City: contract.customer?.city
      ? toProperCase(contract.customer.city)
      : EMPTY,
    State: formatCustomerState(contract.customer?.state),
    Zip: contract.customer?.zip?.trim() || EMPTY,
    "Contract Type": formatContractCatalogLabel(contract),
    "Renewal Due": contract.renewalDueDate
      ? new Date(contract.renewalDueDate).toLocaleDateString()
      : EMPTY,
    Status: STANDING_LABELS[contract.standing ?? "expired"],
  }));
}

export async function exportUpcomingRenewalsExcel(
  contracts: ContractListItem[],
  year: number,
  monthIndex: number,
): Promise<void> {
  const xlsxModule = await import("xlsx");
  const XLSX = xlsxModule.default ?? xlsxModule;
  const rows = mapUpcomingRenewalsToExcelRows(contracts);
  const worksheet = XLSX.utils.json_to_sheet(rows);

  const range = XLSX.utils.decode_range(worksheet["!ref"] ?? "A1");
  const headers: string[] = [];
  for (let column = range.s.c; column <= range.e.c; column++) {
    const cell =
      worksheet[XLSX.utils.encode_cell({ r: range.s.r, c: column })];
    headers[column] = String(cell?.v ?? "");
  }

  for (let row = range.s.r + 1; row <= range.e.r; row++) {
    for (let column = range.s.c; column <= range.e.c; column++) {
      if (!TEXT_COLUMNS.has(headers[column])) continue;
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      const cell = worksheet[address];
      if (!cell) continue;
      cell.t = "s";
      cell.v = String(cell.v ?? "");
      cell.z = "@";
    }
  }

  worksheet["!cols"] = [
    { wch: 28 },
    { wch: 16 },
    { wch: 28 },
    { wch: 18 },
    { wch: 8 },
    { wch: 10 },
    { wch: 22 },
    { wch: 14 },
    { wch: 12 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Upcoming Renewals");
  XLSX.writeFile(workbook, upcomingRenewalsExcelFilename(year, monthIndex));
}
