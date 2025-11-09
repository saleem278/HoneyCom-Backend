import mongoose, { Schema, Document } from 'mongoose';

export interface IMenuItem {
  label: string;
  url: string;
  type: 'page' | 'category' | 'custom' | 'external';
  children?: IMenuItem[];
  order: number;
}

export interface IMenu extends Document {
  name: string;
  location: string;
  items: IMenuItem[];
  createdAt: Date;
  updatedAt: Date;
}

const MenuItemSchema: Schema = new Schema(
  {
    label: {
      type: String,
      required: true,
      trim: true,
    },
    url: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ['page', 'category', 'custom', 'external'],
      default: 'custom',
    },
    children: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const MenuSchema: Schema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide a menu name'],
      trim: true,
      unique: true,
    },
    location: {
      type: String,
      required: [true, 'Please provide a menu location'],
      trim: true,
    },
    items: {
      type: [MenuItemSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: 'menus', // Explicitly set collection name
  }
);

// Index
MenuSchema.index({ location: 1 });

export const Menu = mongoose.model<IMenu>('Menu', MenuSchema);
export { MenuSchema };

