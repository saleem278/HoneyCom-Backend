import mongoose, { Schema, Document } from 'mongoose';

export interface IThemeTokens {
  // Core
  accent: string;        // primary brand color
  accentSoft: string;    // light tint of accent
  onAccent: string;      // text on accent bg (usually #fff or #000)
  // Backgrounds
  bg: string;
  card: string;
  inputBg: string;
  // Text
  text: string;
  sub: string;
  muted: string;
  // Borders
  border: string;
  divider: string;
  // Semantic
  success: string;
  successSoft: string;
  danger: string;
  dangerSoft: string;
  info: string;
  infoSoft: string;
  warning: string;
  warningSoft: string;
  // Shimmer
  shimmer: string;
  shimmerHighlight: string;
  // Badge
  badgeBg: string;
  badgeText: string;
}

export interface ITheme extends Document {
  name: string;
  description?: string;
  lightTokens: IThemeTokens;
  darkTokens: IThemeTokens;
  isActive: boolean;
  isDefault: boolean;   // system fallback if no role default set
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ThemeTokensSchema = {
  accent: { type: String, required: true },
  accentSoft: { type: String, required: true },
  onAccent: { type: String, required: true },
  bg: { type: String, required: true },
  card: { type: String, required: true },
  inputBg: { type: String, required: true },
  text: { type: String, required: true },
  sub: { type: String, required: true },
  muted: { type: String, required: true },
  border: { type: String, required: true },
  divider: { type: String, required: true },
  success: { type: String, required: true },
  successSoft: { type: String, required: true },
  danger: { type: String, required: true },
  dangerSoft: { type: String, required: true },
  info: { type: String, required: true },
  infoSoft: { type: String, required: true },
  warning: { type: String, required: true },
  warningSoft: { type: String, required: true },
  shimmer: { type: String, required: true },
  shimmerHighlight: { type: String, required: true },
  badgeBg: { type: String, required: true },
  badgeText: { type: String, required: true },
};

const ThemeSchema: Schema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    lightTokens: { type: ThemeTokensSchema, required: true },
    darkTokens: { type: ThemeTokensSchema, required: true },
    isActive: { type: Boolean, default: true },
    isDefault: { type: Boolean, default: false },
    createdBy: { type: String },
  },
  { timestamps: true, collection: 'themes' }
);

ThemeSchema.index({ name: 1 });
ThemeSchema.index({ isActive: 1 });

export const Theme = mongoose.model<ITheme>('Theme', ThemeSchema);
export { ThemeSchema };
export default Theme;
