import mongoose, { Schema, Document } from 'mongoose';

export interface IMenuItem {
  label: string;
  url: string;
  type: 'page' | 'category' | 'custom' | 'external';
  children?: IMenuItem[];
  order: number;
  // Mega-menu category fields (so CMS menus can drive the storefront
  // mega-menu, not just flat nav links).
  emoji?: string;
  slug?: string;
  sub?: string[];
  // Top nav link emphasis (e.g. a "Deals" link rendered highlighted).
  highlight?: boolean;
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
    // Mega-menu category fields.
    emoji: { type: String, trim: true, default: '' },
    slug: { type: String, trim: true, default: '' },
    sub: { type: [String], default: [] },
    // Top-nav highlight flag.
    highlight: { type: Boolean, default: false },
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

