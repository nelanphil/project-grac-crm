import mongoose, { Schema, Document, Types } from "mongoose";

export interface IEquipment extends Document {
  customerRef: Types.ObjectId;
  addressRef: Types.ObjectId;
  generatorModel: string;
  serial: string;
  atsSerial: string;
  lastSvc: Date | null;
  exday: string;
  extime: string;
  createdAt: Date;
  updatedAt: Date;
}

const equipmentSchema = new Schema<IEquipment>(
  {
    customerRef: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    addressRef: {
      type: Schema.Types.ObjectId,
      ref: "CustomerAddress",
      required: true,
      index: true,
    },
    generatorModel: { type: String, default: "" },
    serial: { type: String, default: "" },
    atsSerial: { type: String, default: "" },
    lastSvc: { type: Date, default: null },
    exday: { type: String, default: "" },
    extime: { type: String, default: "" },
  },
  { timestamps: true },
);

equipmentSchema.index({ customerRef: 1, addressRef: 1 });
equipmentSchema.index({ serial: 1 });
equipmentSchema.index({ atsSerial: 1 });

export const Equipment = mongoose.model<IEquipment>(
  "Equipment",
  equipmentSchema,
);
