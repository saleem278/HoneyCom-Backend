import type { IThemeTokens } from '../../models/Theme.model';

/**
 * Modern theme palettes seeded for the multi-theme system.
 *
 * Each theme ships a full light + dark token set (23 tokens each). Palettes are
 * tuned to be modern/premium: saturated-but-not-neon accents, soft tinted
 * surfaces in light mode, and near-black layered surfaces in dark mode with the
 * accent kept vivid for contrast.
 *
 * Roles map to defaults in seedThemes():
 *   - Aurora Indigo    → system default (isDefault) + admin
 *   - Royal Violet     → admin alt
 *   - Coral Sunset     → customer default
 *   - Ocean Breeze     → customer alt
 *   - Emerald Desk     → seller default
 *   - Slate Professional → seller alt
 *   - Rose Studio      → contentEditor default
 *   - Amber Press      → contentEditor alt
 */

export interface SeedTheme {
  name: string;
  description: string;
  isDefault?: boolean;
  /** Logical role this palette is the default for (used to build roleDefaults). */
  roleDefault?: 'customer' | 'seller' | 'admin' | 'contentEditor' | 'system';
  lightTokens: IThemeTokens;
  darkTokens: IThemeTokens;
}

// Shared semantic + chrome tokens so each palette only customises accent/surface.
const lightSemantic = {
  success: '#16A34A', successSoft: '#DCFCE7',
  danger: '#DC2626', dangerSoft: '#FEE2E2',
  info: '#2563EB', infoSoft: '#DBEAFE',
  warning: '#D97706', warningSoft: '#FEF3C7',
};
const darkSemantic = {
  success: '#4ADE80', successSoft: '#0A2E1A',
  danger: '#F87171', dangerSoft: '#3A1212',
  info: '#60A5FA', infoSoft: '#11243F',
  warning: '#FBBF24', warningSoft: '#3A2A0A',
};

export const SEED_THEMES: SeedTheme[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // SYSTEM DEFAULT + ADMIN — Aurora Indigo
  {
    name: 'Aurora Indigo',
    description: 'Premium indigo with violet accents. The system default — clean, enterprise, works for every role.',
    isDefault: true,
    roleDefault: 'admin',
    lightTokens: {
      accent: '#6366F1', accentSoft: '#EEF0FE', onAccent: '#FFFFFF',
      bg: '#F7F8FC', card: '#FFFFFF', inputBg: '#F1F3FA',
      text: '#0F1222', sub: '#454B66', muted: '#8A90AC',
      border: '#E3E6F2', divider: '#EDEFF8',
      ...lightSemantic,
      shimmer: '#EDEFF8', shimmerHighlight: '#F8F9FD',
      badgeBg: '#EEF0FE', badgeText: '#4338CA',
    },
    darkTokens: {
      accent: '#818CF8', accentSoft: '#1E1B4B', onAccent: '#0B0E1A',
      bg: '#0B0E1A', card: '#13172A', inputBg: '#1A1F38',
      text: '#EEF0FA', sub: '#A7AEC9', muted: '#6B7290',
      border: '#262C47', divider: '#1C2138',
      ...darkSemantic,
      shimmer: '#1A1F38', shimmerHighlight: '#232944',
      badgeBg: '#1E1B4B', badgeText: '#C7CBF7',
    },
  },

  // ADMIN ALT — Royal Violet
  {
    name: 'Royal Violet',
    description: 'Deep violet-to-fuchsia. A bolder admin look for control panels.',
    roleDefault: 'admin',
    lightTokens: {
      accent: '#9333EA', accentSoft: '#F5EBFE', onAccent: '#FFFFFF',
      bg: '#FAF7FE', card: '#FFFFFF', inputBg: '#F4EEFB',
      text: '#1A1124', sub: '#4E3D63', muted: '#9484A6',
      border: '#EBE0F6', divider: '#F2EAFA',
      ...lightSemantic,
      shimmer: '#F2EAFA', shimmerHighlight: '#FBF8FE',
      badgeBg: '#F5EBFE', badgeText: '#7E22CE',
    },
    darkTokens: {
      accent: '#C084FC', accentSoft: '#2A1145', onAccent: '#120A1C',
      bg: '#120A1C', card: '#1D1230', inputBg: '#261640',
      text: '#F3EAFB', sub: '#BBA6CF', muted: '#7E6B92',
      border: '#33214F', divider: '#241636',
      ...darkSemantic,
      shimmer: '#261640', shimmerHighlight: '#30204C',
      badgeBg: '#2A1145', badgeText: '#DDBEFB',
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // CUSTOMER DEFAULT — Coral Sunset
  {
    name: 'Coral Sunset',
    description: 'Warm coral-orange — friendly and energetic. Great for the customer storefront.',
    roleDefault: 'customer',
    lightTokens: {
      accent: '#F97316', accentSoft: '#FFF1E6', onAccent: '#FFFFFF',
      bg: '#FFF9F4', card: '#FFFFFF', inputBg: '#FFF2E9',
      text: '#1F1408', sub: '#5C4634', muted: '#A88C77',
      border: '#F7E4D4', divider: '#FCEEE2',
      ...lightSemantic,
      shimmer: '#FCEEE2', shimmerHighlight: '#FFFAF5',
      badgeBg: '#FFF1E6', badgeText: '#C2410C',
    },
    darkTokens: {
      accent: '#FB923C', accentSoft: '#3A1E0A', onAccent: '#1A0F05',
      bg: '#1A0F05', card: '#261609', inputBg: '#321E0C',
      text: '#FBEEE2', sub: '#D0B49A', muted: '#937560',
      border: '#412813', divider: '#2E1B0B',
      ...darkSemantic,
      shimmer: '#321E0C', shimmerHighlight: '#3E2611',
      badgeBg: '#3A1E0A', badgeText: '#FDC79C',
    },
  },

  // CUSTOMER ALT — Ocean Breeze
  {
    name: 'Ocean Breeze',
    description: 'Cool cyan-teal — calm, fresh and trustworthy. An alternate customer palette.',
    roleDefault: 'customer',
    lightTokens: {
      accent: '#0891B2', accentSoft: '#E0F7FB', onAccent: '#FFFFFF',
      bg: '#F4FBFD', card: '#FFFFFF', inputBg: '#EAF6F9',
      text: '#072027', sub: '#33545E', muted: '#7C9AA3',
      border: '#D5ECF1', divider: '#E6F4F7',
      ...lightSemantic,
      shimmer: '#E6F4F7', shimmerHighlight: '#F6FCFD',
      badgeBg: '#E0F7FB', badgeText: '#0E7490',
    },
    darkTokens: {
      accent: '#22D3EE', accentSoft: '#06303A', onAccent: '#04181D',
      bg: '#04181D', card: '#0A2730', inputBg: '#0E343F',
      text: '#E2F6FA', sub: '#97C2CC', muted: '#5E848E',
      border: '#14424F', divider: '#0C2E38',
      ...darkSemantic,
      shimmer: '#0E343F', shimmerHighlight: '#15414D',
      badgeBg: '#06303A', badgeText: '#9DEBF8',
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SELLER DEFAULT — Emerald Desk
  {
    name: 'Emerald Desk',
    description: 'Professional emerald green — clear, focused and chart-friendly for the seller console.',
    roleDefault: 'seller',
    lightTokens: {
      accent: '#059669', accentSoft: '#DEF7EC', onAccent: '#FFFFFF',
      bg: '#F4FBF8', card: '#FFFFFF', inputBg: '#EAF6F1',
      text: '#06231A', sub: '#33564A', muted: '#7B9C8E',
      border: '#D6ECE3', divider: '#E6F4EF',
      ...lightSemantic,
      shimmer: '#E6F4EF', shimmerHighlight: '#F6FCFA',
      badgeBg: '#DEF7EC', badgeText: '#047857',
    },
    darkTokens: {
      accent: '#34D399', accentSoft: '#06301F', onAccent: '#041A12',
      bg: '#041A12', card: '#0A281D', inputBg: '#0E3526',
      text: '#E2F6EE', sub: '#97C6B2', muted: '#5E8675',
      border: '#15442F', divider: '#0C2E20',
      ...darkSemantic,
      shimmer: '#0E3526', shimmerHighlight: '#154130',
      badgeBg: '#06301F', badgeText: '#9DEBC8',
    },
  },

  // SELLER ALT — Slate Professional
  {
    name: 'Slate Professional',
    description: 'Cool blue-slate — understated and data-dense. An alternate, low-distraction seller palette.',
    roleDefault: 'seller',
    lightTokens: {
      accent: '#2563EB', accentSoft: '#E4ECFE', onAccent: '#FFFFFF',
      bg: '#F6F8FC', card: '#FFFFFF', inputBg: '#EEF2FA',
      text: '#0C1424', sub: '#3C4A63', muted: '#8593AC',
      border: '#E0E6F1', divider: '#EBEFF7',
      ...lightSemantic,
      shimmer: '#EBEFF7', shimmerHighlight: '#F7F9FD',
      badgeBg: '#E4ECFE', badgeText: '#1D4ED8',
    },
    darkTokens: {
      accent: '#60A5FA', accentSoft: '#0E2348', onAccent: '#08101F',
      bg: '#08101F', card: '#101A30', inputBg: '#16223F',
      text: '#E8EEFA', sub: '#A0AEC9', muted: '#647189',
      border: '#202E4C', divider: '#16203A',
      ...darkSemantic,
      shimmer: '#16223F', shimmerHighlight: '#1E2B4A',
      badgeBg: '#0E2348', badgeText: '#AFCBF8',
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // CONTENT EDITOR DEFAULT — Rose Studio
  {
    name: 'Rose Studio',
    description: 'Editorial rose-pink — warm and creative for the content studio.',
    roleDefault: 'contentEditor',
    lightTokens: {
      accent: '#E11D48', accentSoft: '#FCE7EC', onAccent: '#FFFFFF',
      bg: '#FFF6F8', card: '#FFFFFF', inputBg: '#FCEDF1',
      text: '#240810', sub: '#5E3540', muted: '#AD8089',
      border: '#F6DEE4', divider: '#FBEAEF',
      ...lightSemantic,
      shimmer: '#FBEAEF', shimmerHighlight: '#FFF7F9',
      badgeBg: '#FCE7EC', badgeText: '#BE123C',
    },
    darkTokens: {
      accent: '#FB7185', accentSoft: '#3A0F1A', onAccent: '#1C060B',
      bg: '#1C060B', card: '#2A0E15', inputBg: '#37131C',
      text: '#FBE6EB', sub: '#D0A0AB', muted: '#936670',
      border: '#461823', divider: '#330F18',
      ...darkSemantic,
      shimmer: '#37131C', shimmerHighlight: '#431A24',
      badgeBg: '#3A0F1A', badgeText: '#FDA8B4',
    },
  },

  // CONTENT EDITOR ALT — Amber Press
  {
    name: 'Amber Press',
    description: 'Warm amber-gold — bright editorial energy. An alternate content-studio palette.',
    roleDefault: 'contentEditor',
    lightTokens: {
      accent: '#D97706', accentSoft: '#FEF3C7', onAccent: '#FFFFFF',
      bg: '#FFFBF2', card: '#FFFFFF', inputBg: '#FCF4E2',
      text: '#231708', sub: '#5C4A2E', muted: '#A89372',
      border: '#F4E6CA', divider: '#FAF0DC',
      ...lightSemantic,
      shimmer: '#FAF0DC', shimmerHighlight: '#FFFCF6',
      badgeBg: '#FEF3C7', badgeText: '#B45309',
    },
    darkTokens: {
      accent: '#FBBF24', accentSoft: '#3A2A06', onAccent: '#1C1404',
      bg: '#1C1404', card: '#291E08', inputBg: '#35280C',
      text: '#FAF1DC', sub: '#CFBC93', muted: '#917F5C',
      border: '#443211', divider: '#2F230A',
      ...darkSemantic,
      shimmer: '#35280C', shimmerHighlight: '#413112',
      badgeBg: '#3A2A06', badgeText: '#FCD66A',
    },
  },
];
