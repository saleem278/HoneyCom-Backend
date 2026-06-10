import mongoose, { Schema, Document } from 'mongoose';

export interface IDeliverySlot extends Document {
  label: string;
  startTime: string;
  endTime: string;
  cutoffTime: string;
  isExpress: boolean;
  daysAvailable: number[];
  maxOrders: number;
  extraCharge: number;
  isActive: boolean;
}

const DeliverySlotSchema: Schema = new Schema(
  {
    label: {
      type: String,
      required: [true, 'Slot label is required'],
      trim: true,
      maxlength: [100, 'Label cannot exceed 100 characters'],
    },
    startTime: {
      type: String,
      required: [true, 'Start time is required'],
      match: [/^\d{2}:\d{2}$/, 'startTime must be in HH:MM format'],
    },
    endTime: {
      type: String,
      required: [true, 'End time is required'],
      match: [/^\d{2}:\d{2}$/, 'endTime must be in HH:MM format'],
    },
    cutoffTime: {
      type: String,
      required: [true, 'Cutoff time is required'],
      match: [/^\d{2}:\d{2}$/, 'cutoffTime must be in HH:MM format'],
    },
    isExpress: {
      type: Boolean,
      default: false,
    },
    daysAvailable: [
      {
        type: Number,
        min: 0,
        max: 6,
      },
    ],
    maxOrders: {
      type: Number,
      required: [true, 'maxOrders is required'],
      min: [1, 'maxOrders must be at least 1'],
    },
    extraCharge: {
      type: Number,
      default: 0,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    collection: 'delivery_slots',
  }
);

export const DeliverySlot = mongoose.model<IDeliverySlot>('DeliverySlot', DeliverySlotSchema);
export { DeliverySlotSchema };
