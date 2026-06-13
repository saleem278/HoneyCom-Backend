import mongoose, { Schema, Document } from 'mongoose';

/**
 * A managed transactional-email template. Replaces the old fixed
 * email.* settings keys with editable, CRUD-able records.
 *
 * `key` is the stable identifier the mailer resolves by (e.g. 'orderConfirm',
 * 'shipping', 'verify', 'reset', 'sellerApproved', 'sellerRejected', or any
 * new admin-created template). The mailer looks up a template by key and
 * falls back to the legacy email.* setting / hardcoded default if none/inactive.
 *
 * subject/cta/intro mirror the three fields the mailer already substitutes;
 * {{orderNumber}} and {{siteName}} placeholders are honored by the mailer.
 */
export interface IEmailTemplate extends Document {
  key: string;
  name: string;
  subject: string;
  cta?: string;
  intro?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const EmailTemplateSchema: Schema = new Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    subject: { type: String, required: true, trim: true },
    cta: { type: String, trim: true, default: '' },
    intro: { type: String, trim: true, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'emailtemplates' },
);

EmailTemplateSchema.index({ key: 1 }, { unique: true });

export const EmailTemplate = mongoose.model<IEmailTemplate>(
  'EmailTemplate',
  EmailTemplateSchema,
);
export { EmailTemplateSchema };
export default EmailTemplate;
