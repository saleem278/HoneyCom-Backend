import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EmailTemplate, IEmailTemplate } from '../../models/EmailTemplate.model';

/**
 * CRUD service for managed email templates. Named singular
 * (EmailTemplateService) to avoid colliding with the existing
 * services/email-templates.service.ts (EmailTemplatesService, plural) that
 * builds the HTML bodies.
 */
@Injectable()
export class EmailTemplateService {
  constructor(
    @InjectModel('EmailTemplate') private templateModel: Model<IEmailTemplate>,
  ) {}

  async findAll(filters?: { search?: string }) {
    const query: any = {};
    if (filters?.search) {
      const safe = filters.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 100);
      query.$or = [
        { name: { $regex: safe, $options: 'i' } },
        { key: { $regex: safe, $options: 'i' } },
        { subject: { $regex: safe, $options: 'i' } },
      ];
    }
    const templates = await this.templateModel.find(query).sort({ createdAt: -1 }).limit(500);
    return { success: true, templates };
  }

  async findOne(id: string) {
    const template = await this.templateModel.findById(id);
    if (!template) {
      throw new NotFoundException('Email template not found');
    }
    return { success: true, template };
  }

  async create(data: any) {
    const existing = await this.templateModel.findOne({ key: data.key });
    if (existing) {
      throw new BadRequestException('A template with this key already exists');
    }
    const template = await this.templateModel.create(data);
    return { success: true, template };
  }

  async update(id: string, data: any) {
    const template = await this.templateModel.findById(id);
    if (!template) {
      throw new NotFoundException('Email template not found');
    }
    if (data.key && data.key !== template.key) {
      const clash = await this.templateModel.findOne({ key: data.key, _id: { $ne: id } });
      if (clash) {
        throw new BadRequestException('A template with this key already exists');
      }
    }
    const updated = await this.templateModel.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true,
    });
    return { success: true, template: updated };
  }

  async delete(id: string) {
    const template = await this.templateModel.findById(id);
    if (!template) {
      throw new NotFoundException('Email template not found');
    }
    await this.templateModel.findByIdAndDelete(id);
    return { success: true, message: 'Email template deleted successfully' };
  }

  /**
   * Resolve an active template by key for the mailer. Returns null if no
   * active record exists, so callers can fall back to the legacy
   * email.* setting / hardcoded default. Lean read for the hot email path.
   */
  async resolveByKey(key: string): Promise<{
    subject: string;
    cta: string;
    intro: string;
  } | null> {
    const t = await this.templateModel.findOne({ key, isActive: true }).lean<IEmailTemplate>();
    if (!t) return null;
    return {
      subject: String(t.subject ?? ''),
      cta: String(t.cta ?? ''),
      intro: String(t.intro ?? ''),
    };
  }
}
