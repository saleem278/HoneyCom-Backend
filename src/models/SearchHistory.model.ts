import mongoose, { Schema, Document } from 'mongoose';

export interface ISearchHistory extends Document {
  user?: mongoose.Types.ObjectId;
  term: string;
  searchedAt: Date;
}

const SearchHistorySchema: Schema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    term: {
      type: String,
      required: [true, 'Search term is required'],
      trim: true,
      maxlength: [200, 'Search term cannot exceed 200 characters'],
    },
    searchedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: false,
    collection: 'search_histories',
  }
);

SearchHistorySchema.index({ user: 1, searchedAt: -1 });
SearchHistorySchema.index({ searchedAt: -1 });

export const SearchHistory = mongoose.model<ISearchHistory>('SearchHistory', SearchHistorySchema);
export { SearchHistorySchema };
