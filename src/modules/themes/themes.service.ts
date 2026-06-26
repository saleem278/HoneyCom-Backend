import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ITheme } from '../../models/Theme.model';
import { IUser } from '../../models/User.model';
import { CreateThemeDto } from './dto/create-theme.dto';
import { UpdateThemeDto } from './dto/update-theme.dto';

export type UserRole = 'customer' | 'seller' | 'contentEditor' | 'admin' | 'superadmin';

@Injectable()
export class ThemesService {
  constructor(
    @InjectModel('Theme') private themeModel: Model<ITheme>,
    @InjectModel('User') private userModel: Model<IUser>,
  ) {}

  async findAll() {
    const themes = await this.themeModel.find().sort({ createdAt: -1 }).lean();
    return { success: true, themes };
  }

  async findOne(id: string) {
    const theme = await this.themeModel.findById(id).lean();
    if (!theme) throw new NotFoundException('Theme not found');
    return { success: true, theme };
  }

  async create(dto: CreateThemeDto, createdBy?: string) {
    const theme = await this.themeModel.create({ ...dto, createdBy });
    return { success: true, theme };
  }

  async update(id: string, dto: UpdateThemeDto) {
    const theme = await this.themeModel.findByIdAndUpdate(id, { $set: dto }, { new: true });
    if (!theme) throw new NotFoundException('Theme not found');
    return { success: true, theme };
  }

  async remove(id: string) {
    const theme = await this.themeModel.findByIdAndDelete(id);
    if (!theme) throw new NotFoundException('Theme not found');
    return { success: true, message: 'Theme deleted' };
  }

  /** Resolve the effective theme for a user — called at login and by GET /themes/me */
  async resolveEffectiveTheme(user: IUser): Promise<{ theme: any; isDark: boolean; source: string }> {
    const themeSettings = await this._getThemeSettings();
    const role = user.role as UserRole;

    const pref = (user as any).themePreference ?? {};
    const globalAllow = themeSettings.allowOverride?.[role] ?? false;
    const canChange = pref.canChangeTheme === true || (pref.canChangeTheme === 'inherit' && globalAllow);

    // 1. Admin force-assigned
    if (pref.assignedThemeId) {
      const theme = await this.themeModel.findById(pref.assignedThemeId).lean();
      if (theme) return { theme, isDark: pref.prefersDark ?? false, source: 'assigned' };
    }

    // 2. User's own choice (if permitted)
    if (canChange && pref.chosenThemeId) {
      const theme = await this.themeModel.findById(pref.chosenThemeId).lean();
      if (theme) return { theme, isDark: pref.prefersDark ?? false, source: 'user' };
    }

    // 3. Role default
    const roleDefaultId = themeSettings.defaults?.[role];
    if (roleDefaultId) {
      const theme = await this.themeModel.findById(roleDefaultId).lean();
      if (theme) return { theme, isDark: pref.prefersDark ?? false, source: 'roleDefault' };
    }

    // 4. System default
    const systemDefault = await this.themeModel.findOne({ isDefault: true, isActive: true }).lean();
    if (systemDefault) return { theme: systemDefault, isDark: pref.prefersDark ?? false, source: 'systemDefault' };

    // 5. First active theme
    const fallback = await this.themeModel.findOne({ isActive: true }).lean();
    if (fallback) return { theme: fallback, isDark: pref.prefersDark ?? false, source: 'fallback' };

    return { theme: null, isDark: false, source: 'none' };
  }

  /** Public — effective theme for a logged-out guest. Resolves the
   *  theme.roleDefaults.guest, then system default, then first active. */
  async getGuestTheme(): Promise<{ theme: any; isDark: boolean; source: string; canChange: boolean }> {
    const themeSettings = await this._getThemeSettings();

    const guestDefaultId = themeSettings.defaults?.['guest'];
    if (guestDefaultId) {
      const theme = await this.themeModel.findById(guestDefaultId).lean();
      if (theme && (theme as any).isActive) {
        return { theme, isDark: false, source: 'roleDefault', canChange: false };
      }
    }

    const systemDefault = await this.themeModel.findOne({ isDefault: true, isActive: true }).lean();
    if (systemDefault) return { theme: systemDefault, isDark: false, source: 'systemDefault', canChange: false };

    const fallback = await this.themeModel.findOne({ isActive: true }).lean();
    if (fallback) return { theme: fallback, isDark: false, source: 'fallback', canChange: false };

    return { theme: null, isDark: false, source: 'none', canChange: false };
  }

  /** GET /themes/me — returns user's effective theme + whether they can change it */
  async getMyTheme(userId: string) {
    const user = await this.userModel.findById(userId).lean();
    if (!user) throw new NotFoundException('User not found');
    const themeSettings = await this._getThemeSettings();
    const pref = (user as any).themePreference ?? {};
    const globalAllow = themeSettings.allowOverride?.[user.role] ?? false;
    const canChange = pref.canChangeTheme === true || (pref.canChangeTheme === 'inherit' && globalAllow);
    const resolved = await this.resolveEffectiveTheme(user as IUser);
    return { success: true, ...resolved, canChange, prefersDark: pref.prefersDark ?? false };
  }

  /** PUT /themes/me — user sets their own chosen theme */
  async setMyTheme(userId: string, themeId: string | null, prefersDark?: boolean) {
    const user = await this.userModel.findById(userId).lean();
    if (!user) throw new NotFoundException('User not found');
    const themeSettings = await this._getThemeSettings();
    const pref = (user as any).themePreference ?? {};
    const globalAllow = themeSettings.allowOverride?.[user.role] ?? false;
    const canChange = pref.canChangeTheme === true || (pref.canChangeTheme === 'inherit' && globalAllow);
    if (!canChange) throw new BadRequestException('Theme selection not permitted for your account');
    if (themeId) {
      const theme = await this.themeModel.findById(themeId);
      if (!theme) throw new NotFoundException('Theme not found');
    }
    await this.userModel.updateOne({ _id: userId }, {
      $set: {
        'themePreference.chosenThemeId': themeId ?? null,
        ...(prefersDark !== undefined ? { 'themePreference.prefersDark': prefersDark } : {}),
      }
    });
    return { success: true, message: 'Theme preference updated' };
  }

  /** Admin: set per-user theme preference flags */
  async setUserThemePref(targetUserId: string, data: {
    canChangeTheme?: 'inherit' | boolean;
    assignedThemeId?: string | null;
  }) {
    const user = await this.userModel.findById(targetUserId);
    if (!user) throw new NotFoundException('User not found');
    const update: any = {};
    if (data.canChangeTheme !== undefined) update['themePreference.canChangeTheme'] = data.canChangeTheme;
    if (data.assignedThemeId !== undefined) update['themePreference.assignedThemeId'] = data.assignedThemeId ?? null;
    await this.userModel.updateOne({ _id: targetUserId }, { $set: update });
    return { success: true, message: 'User theme preference updated' };
  }

  /** Get theme settings from Settings collection */
  private async _getThemeSettings(): Promise<{ defaults: Record<string, string>; allowOverride: Record<string, boolean> }> {
    // Import Settings model dynamically to avoid circular dep
    const SettingsModel = this.themeModel.db.model('Settings');
    const [defaultsSetting, allowSetting] = await Promise.all([
      SettingsModel.findOne({ key: 'theme.roleDefaults' }).lean(),
      SettingsModel.findOne({ key: 'theme.allowOverride' }).lean(),
    ]);
    return {
      defaults: (defaultsSetting as any)?.value ?? {},
      allowOverride: (allowSetting as any)?.value ?? {},
    };
  }
}
