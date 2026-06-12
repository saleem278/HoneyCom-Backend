import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Settings, ISettings } from '../../models/Settings.model';
import { EmailTemplatesService } from '../../services/email-templates.service';

/** Categories whose change immediately invalidates the email-templates cache. */
const EMAIL_CACHE_CATEGORIES = new Set(['branding', 'email']);

@Injectable()
export class SettingsService {
  constructor(
    @InjectModel('Settings') private settingsModel: Model<ISettings>,
    private emailTemplatesService: EmailTemplatesService,
  ) {}

  async getByCategory(category: string) {
    const settings = await this.settingsModel.find({ category }).lean();
    const result: any = {};
    settings.forEach((setting) => {
      result[setting.key] = setting.value;
    });
    return {
      success: true,
      settings: result,
    };
  }

  async getByKey(key: string) {
    const setting = await this.settingsModel.findOne({ key });
    if (!setting) {
      throw new NotFoundException(`Setting ${key} not found`);
    }
    return {
      success: true,
      setting: {
        key: setting.key,
        value: setting.value,
        category: setting.category,
      },
    };
  }

  async getAll() {
    const settings = await this.settingsModel.find().lean();
    const result: any = {};
    // Track the most-recent updatedAt and changedBy per category for the audit footer.
    const meta: Record<string, { updatedAt: Date | null; changedBy: string | null }> = {};

    settings.forEach((setting) => {
      if (!result[setting.category]) {
        result[setting.category] = {};
      }
      result[setting.category][setting.key] = setting.value;

      // Bubble up the most-recently-changed setting within the category.
      const existing = meta[setting.category];
      const settingUpdatedAt = (setting as any).updatedAt as Date | null;
      if (!existing || (settingUpdatedAt && (!existing.updatedAt || settingUpdatedAt > existing.updatedAt))) {
        meta[setting.category] = {
          updatedAt: settingUpdatedAt ?? null,
          changedBy: (setting as any).changedBy ?? null,
        };
      }
    });
    return {
      success: true,
      settings: result,
      meta,
    };
  }

  async set(key: string, value: any, category: string, description?: string, changedBy?: string) {
    const updateDoc: any = { key, value, category, description };
    if (changedBy) updateDoc.changedBy = changedBy;
    const setting = await this.settingsModel.findOneAndUpdate(
      { key },
      { $set: updateDoc },
      { upsert: true, new: true }
    );
    // Immediately invalidate the email-templates cache so branding/email changes
    // apply to the next email without waiting for the 5-min TTL.
    if (EMAIL_CACHE_CATEGORIES.has(category)) {
      this.emailTemplatesService.invalidateCache();
    }
    return {
      success: true,
      setting,
    };
  }

  async setMultiple(settings: Array<{ key: string; value: any; category: string; description?: string }>, changedBy?: string) {
    const operations = settings.map((s) => ({
      updateOne: {
        filter: { key: s.key },
        update: { $set: changedBy ? { ...s, changedBy } : s },
        upsert: true,
      },
    }));

    await this.settingsModel.bulkWrite(operations);

    // Invalidate email-templates cache if any saved setting is in a cache-sensitive category.
    const touchesCacheable = settings.some((s) => EMAIL_CACHE_CATEGORIES.has(s.category));
    if (touchesCacheable) {
      this.emailTemplatesService.invalidateCache();
    }

    return {
      success: true,
      message: 'Settings updated successfully',
    };
  }

  async delete(key: string) {
    const setting = await this.settingsModel.findOneAndDelete({ key });
    if (!setting) {
      throw new NotFoundException(`Setting ${key} not found`);
    }
    return {
      success: true,
      message: 'Setting deleted successfully',
    };
  }
}

