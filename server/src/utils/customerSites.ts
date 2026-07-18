import { Types } from "mongoose";
import { Customer, ICustomer } from "../models/mongo/Customer";
import { CustomerAddress } from "../models/mongo/CustomerAddress";
import { Equipment } from "../models/mongo/Equipment";

export function normalizePhoneDigits(phone: string | null | undefined): string {
  return (phone ?? "").replace(/\D/g, "");
}

export function customerHasSiteData(customer: {
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  generatorModel?: string;
  serial?: string;
  atsSerial?: string;
  exday?: string;
  extime?: string;
  lastSvc?: Date | null;
}): boolean {
  return Boolean(
    customer.address?.trim() ||
      customer.city?.trim() ||
      customer.state?.trim() ||
      customer.zip?.trim() ||
      customer.generatorModel?.trim() ||
      customer.serial?.trim() ||
      customer.atsSerial?.trim() ||
      customer.exday?.trim() ||
      customer.extime?.trim() ||
      customer.lastSvc
  );
}

export function customerHasEquipmentData(customer: {
  generatorModel?: string;
  serial?: string;
  atsSerial?: string;
  exday?: string;
  extime?: string;
  lastSvc?: Date | null;
}): boolean {
  return Boolean(
    customer.generatorModel?.trim() ||
      customer.serial?.trim() ||
      customer.atsSerial?.trim() ||
      customer.exday?.trim() ||
      customer.extime?.trim() ||
      customer.lastSvc
  );
}

export function defaultAddressLabel(city?: string, address?: string): string {
  const cityLabel = city?.trim();
  if (cityLabel) return cityLabel;
  const street = address?.trim();
  if (street) return street.slice(0, 40);
  return "Primary";
}

/** Refresh denormalized primary address/equipment fields on the customer. */
export async function syncCustomerPrimaryFields(
  customerId: Types.ObjectId | string
): Promise<void> {
  const primaryAddress = await CustomerAddress.findOne({
    customerRef: customerId,
    isPrimary: true,
  }).lean();

  const address =
    primaryAddress ??
    (await CustomerAddress.findOne({ customerRef: customerId })
      .sort({ createdAt: 1 })
      .lean());

  if (!address) {
    await Customer.findByIdAndUpdate(customerId, {
      $set: {
        address: "",
        city: "",
        state: "",
        zip: "",
        generatorModel: "",
        serial: "",
        atsSerial: "",
        lastSvc: null,
        exday: "",
        extime: "",
      },
    });
    return;
  }

  if (!address.isPrimary) {
    await CustomerAddress.updateOne({ _id: address._id }, { $set: { isPrimary: true } });
  }

  const equipment = await Equipment.findOne({ addressRef: address._id })
    .sort({ createdAt: 1 })
    .lean();

  await Customer.findByIdAndUpdate(customerId, {
    $set: {
      address: address.address ?? "",
      city: address.city ?? "",
      state: address.state ?? "",
      zip: address.zip ?? "",
      generatorModel: equipment?.generatorModel ?? "",
      serial: equipment?.serial ?? "",
      atsSerial: equipment?.atsSerial ?? "",
      lastSvc: equipment?.lastSvc ?? null,
      exday: equipment?.exday ?? "",
      extime: equipment?.extime ?? "",
    },
  });
}

/**
 * Ensure a customer has at least one address (and equipment if flat fields have it).
 * Used by migration and merge for pre-migration customers.
 */
export async function ensureCustomerSiteFromFlat(
  customer: Pick<
    ICustomer,
    | "_id"
    | "legacyId"
    | "address"
    | "city"
    | "state"
    | "zip"
    | "generatorModel"
    | "serial"
    | "atsSerial"
    | "lastSvc"
    | "exday"
    | "extime"
  >
): Promise<{ addressId: Types.ObjectId; created: boolean }> {
  const existing = await CustomerAddress.findOne({
    customerRef: customer._id,
  })
    .sort({ isPrimary: -1, createdAt: 1 })
    .lean();

  if (existing) {
    return { addressId: existing._id as Types.ObjectId, created: false };
  }

  if (!customerHasSiteData(customer)) {
    const addressDoc = await CustomerAddress.create({
      customerRef: customer._id,
      label: "Primary",
      address: "",
      city: "",
      state: "",
      zip: "",
      isPrimary: true,
      legacyCustomerId: customer.legacyId ?? null,
    });
    return { addressId: addressDoc._id as Types.ObjectId, created: true };
  }

  const addressDoc = await CustomerAddress.create({
    customerRef: customer._id,
    label: defaultAddressLabel(customer.city, customer.address),
    address: customer.address ?? "",
    city: customer.city ?? "",
    state: customer.state ?? "",
    zip: customer.zip ?? "",
    isPrimary: true,
    legacyCustomerId: customer.legacyId ?? null,
  });

  if (customerHasEquipmentData(customer)) {
    await Equipment.create({
      customerRef: customer._id,
      addressRef: addressDoc._id,
      generatorModel: customer.generatorModel ?? "",
      serial: customer.serial ?? "",
      atsSerial: customer.atsSerial ?? "",
      lastSvc: customer.lastSvc ?? null,
      exday: customer.exday ?? "",
      extime: customer.extime ?? "",
    });
  }

  return { addressId: addressDoc._id as Types.ObjectId, created: true };
}
