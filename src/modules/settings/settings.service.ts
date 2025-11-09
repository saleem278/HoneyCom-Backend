import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Settings, ISettings } from '../../models/Settings.model';

@Injectable()
export class SettingsService {
  constructor(
    @InjectModel('Settings') private settingsModel: Model<ISettings>,
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
    settings.forEach((setting) => {
      if (!result[setting.category]) {
        result[setting.category] = {};
      }
      result[setting.category][setting.key] = setting.value;
    });
    return {
      success: true,
      settings: result,
    };
  }

  async set(key: string, value: any, category: string, description?: string) {
    const setting = await this.settingsModel.findOneAndUpdate(
      { key },
      { key, value, category, description },
      { upsert: true, new: true }
    );
    return {
      success: true,
      setting,
    };
  }

  async setMultiple(settings: Array<{ key: string; value: any; category: string; description?: string }>) {
    const operations = settings.map((s) => ({
      updateOne: {
        filter: { key: s.key },
        update: { $set: s },
        upsert: true,
      },
    }));

    await this.settingsModel.bulkWrite(operations);
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

