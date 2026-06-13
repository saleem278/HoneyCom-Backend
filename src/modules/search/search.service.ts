import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ISearchHistory } from '../../models/SearchHistory.model';
import { TrackSearchDto } from './dto/track-search.dto';

@Injectable()
export class SearchService {
  constructor(
    @InjectModel('SearchHistory') private searchHistoryModel: Model<ISearchHistory>,
  ) {}

  /**
   * Track a search term. If the same user/anonymous pair searched the same
   * term within the last 5 minutes, skip recording to prevent spam.
   */
  async trackSearch(dto: TrackSearchDto, userId?: string) {
    const term = dto.term.trim();
    if (!term) return { success: true, skipped: true };

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    // Rate-limit: skip if exact same term within last 5 minutes for same user
    const filter: any = {
      term,
      searchedAt: { $gte: fiveMinutesAgo },
    };

    if (userId) {
      filter.user = new Types.ObjectId(userId);
    } else {
      // For anonymous, avoid saving if user field is null and same term exists
      filter.user = { $exists: false };
    }

    const recent = await this.searchHistoryModel.findOne(filter).lean();
    if (recent) {
      return { success: true, skipped: true };
    }

    const doc: any = { term, searchedAt: new Date() };
    if (userId) doc.user = new Types.ObjectId(userId);

    await this.searchHistoryModel.create(doc);
    return { success: true };
  }

  /**
   * Get the authenticated user's last 10 unique search terms (most recent first).
   */
  async getUserHistory(userId: string) {
    const history = await this.searchHistoryModel
      .find({ user: new Types.ObjectId(userId) })
      .sort({ searchedAt: -1 })
      .limit(50)
      .lean();

    // Deduplicate by term, keeping the most recent
    const seen = new Set<string>();
    const unique: typeof history = [];
    for (const h of history) {
      if (!seen.has(h.term)) {
        seen.add(h.term);
        unique.push(h);
        if (unique.length >= 10) break;
      }
    }

    return { success: true, history: unique };
  }

  /**
   * Clear all search history for the authenticated user.
   */
  async clearUserHistory(userId: string) {
    await this.searchHistoryModel.deleteMany({ user: new Types.ObjectId(userId) });
    return { success: true, message: 'Search history cleared' };
  }

  /**
   * Get top 10 most searched terms in the last 24 hours.
   */
  async getTrending() {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const trending = await this.searchHistoryModel.aggregate([
      { $match: { searchedAt: { $gte: since24h } } },
      { $group: { _id: '$term', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: 10 },
      { $project: { _id: 0, term: '$_id', count: 1 } },
    ]);

    return { success: true, trending };
  }
}
