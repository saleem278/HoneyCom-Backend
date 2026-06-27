import { Injectable, Logger } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Connection } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User, IUser } from '../../models/User.model';
import { ThemeSchema } from '../../models/Theme.model';
import { SEED_THEMES } from './theme.seed-data';
// Product imported dynamically to avoid global registration
// Don't import Category, Blog, Page models here - importing them registers models globally
// They will be imported dynamically when needed
// Order, Review, Cart imported dynamically to avoid global registration
// Coupon imported dynamically to avoid global registration
// Media imported dynamically to avoid global registration
// Menu imported dynamically to avoid global registration
// Form imported dynamically to avoid global registration
// BlogCategory imported dynamically to avoid global registration
// Address, PaymentMethod imported dynamically to avoid global registration

@Injectable()
export class SeedService {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @InjectModel('User') private userModel: Model<IUser>,
    // Product removed from injection - will be loaded dynamically
    // Order, Review, Cart removed from injection - will be loaded dynamically
    // Coupon removed from injection - will be loaded dynamically
    // Media removed from injection - will be loaded dynamically
    // Menu removed from injection - will be loaded dynamically
    // Form removed from injection - will be loaded dynamically
    // BlogCategory removed from injection - will be loaded dynamically
    // Address, PaymentMethod removed from injection - will be loaded dynamically
    @InjectConnection() private connection: Connection,
  ) { }

  async seed() {
    this.logger.log('Starting database seeding...');

    try {
      // Clear existing data FIRST - this is critical
      // This will drop all collections including critical ones
      await this.clearDatabase();

      // Seed in order of dependencies - users first, then everything else
      const users = await this.seedUsers();
      this.logger.log(`Users created: ${users.length}`);
      if (users.length === 0) {
        throw new Error('No users were created. Cannot proceed with seeding.');
      }

      const categories = await this.seedCategories();
      const products = await this.seedProducts(users, categories);
      const addresses = await this.seedAddresses(users);
      await this.seedPaymentMethods(users);
      await this.seedCoupons();
      await this.seedCarts(users, products);
      await this.seedOrders(users, products, addresses);
      await this.seedReviews(users, products);
      await this.seedCMS(users);
      await this.seedBanners();
      await this.seedBrands();
      await this.seedWidgets();
      await this.seedDisputes(users, products);
      await this.seedSettings();
      // Themes must run AFTER settings: it writes theme.roleDefaults /
      // theme.allowOverride keyed by the inserted theme _ids.
      await this.seedThemes();
      // Newly-seeded domain collections (previously empty).
      await this.seedEmailTemplates();
      await this.seedStores(users);
      await this.seedFlashSales(users, products);
      await this.seedPayouts(users);
      await this.seedWalletTransactions(users);
      await this.seedLoyaltyTransactions(users);
      await this.seedNotifications(users);
      await this.seedBroadcasts(users);
      // Premium platform features (merged 45yy62): no storefront fallbacks,
      // so these must be seeded for the new pages to render real data.
      await this.seedDeliverySlots();
      await this.seedCollections(products);
      await this.seedBundles(users, products);
      await this.seedPriceHistory(users, products);

      this.logger.log('✅ Database seeding completed successfully!');
      return { success: true, message: 'Database seeded successfully' };
    } catch (error) {
      this.logger.error('❌ Error seeding database:', error);
      throw error;
    }
  }

  // ── Email templates ────────────────────────────────────────────────────────
  // Keys are the bare prefixes the mailer resolves (<key>Subject/Cta/Intro).
  private async seedEmailTemplates() {
    this.logger.log('Seeding email templates...');
    const mod = await import('../../models/EmailTemplate.model');
    const model = this.connection.model('EmailTemplate', mod.EmailTemplateSchema);
    await model.insertMany([
      { key: 'orderConfirm', name: 'Order Confirmation', subject: 'Order Confirmed #{{orderNumber}} - {{siteName}}', cta: 'Track My Order', intro: 'Thank you for your order! Here is a summary of what you ordered.', isActive: true },
      { key: 'shipping', name: 'Shipping Update', subject: 'Your order #{{orderNumber}} has shipped! - {{siteName}}', cta: 'Track Shipment', intro: 'Great news! Your order is on its way.', isActive: true },
      { key: 'verify', name: 'Email Verification', subject: 'Verify your email for {{siteName}}', cta: 'Verify Email', intro: 'Welcome to {{siteName}}! Please verify your email to start shopping.', isActive: true },
      { key: 'reset', name: 'Password Reset', subject: 'Reset your {{siteName}} password', cta: 'Reset Password', intro: 'We received a request to reset your password.', isActive: true },
      { key: 'sellerApproved', name: 'Seller Approved', subject: 'Congratulations! Your seller account is approved - {{siteName}}', cta: 'Go to Dashboard', intro: 'Your seller account has been approved. You can now list products.', isActive: true },
      { key: 'sellerRejected', name: 'Seller Rejected', subject: 'Update on your seller application - {{siteName}}', cta: 'Contact Support', intro: 'Thank you for your interest. Unfortunately we could not approve your application at this time.', isActive: true },
    ]);
    this.logger.log('✅ Created 6 email templates');
  }

  // ── Stores (one per seller) ──────────────────────────────────────────────────
  private async seedStores(users: any[]) {
    this.logger.log('Seeding stores...');
    const sellers = users.filter(u => u.role === 'seller');
    if (sellers.length === 0) return;
    const mod = await import('../../models/Store.model');
    const model = this.connection.model('Store', mod.StoreSchema);
    // Derive the store from the seller's OWN name so ownership always matches —
    // hardcoding store names by index swapped them (Raj's account showed Priya's
    // store). The seller user names are already the storefront names.
    const slugify = (name: string) =>
      name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const docs = sellers.map((s) => ({
      seller: s._id,
      storeName: s.name,
      slug: slugify(s.name),
      contact: { email: s.email, phone: s.phone || '' },
      settings: {},
    }));
    await model.insertMany(docs);
    this.logger.log(`✅ Created ${docs.length} stores`);
  }

  // ── Flash sales ──────────────────────────────────────────────────────────────
  private async seedFlashSales(users: any[], products: any[]) {
    this.logger.log('Seeding flash sales...');
    const admin = users.find(u => u.role === 'admin') || users.find(u => u.role === 'superadmin');
    if (!admin || !products || products.length === 0) return;
    const mod = await import('../../models/FlashSale.model');
    const model = this.connection.model('FlashSale', mod.FlashSaleSchema);
    const now = Date.now();
    const docs = products.slice(0, 3).map((p, i) => {
      const original = p.price ?? 999;
      const sale = Math.round(original * 0.7 * 100) / 100;
      return {
        product: p._id,
        originalPrice: original,
        salePrice: sale,
        discountPercent: 30,
        startTime: new Date(now - (i === 0 ? 3600_000 : -86400_000 * (i))),
        endTime: new Date(now + 86400_000 * (i + 2)),
        createdBy: admin._id,
      };
    });
    await model.insertMany(docs);
    this.logger.log(`✅ Created ${docs.length} flash sales`);
  }

  // ── Payouts ────────────────────────────────────────────────────────────────
  private async seedPayouts(users: any[]) {
    this.logger.log('Seeding payouts...');
    const sellers = users.filter(u => u.role === 'seller');
    if (sellers.length === 0) return;
    const mod = await import('../../models/Payout.model');
    const model = this.connection.model('Payout', mod.PayoutSchema);
    const docs = sellers.map((s, i) => ({
      seller: s._id,
      amount: 5000 + i * 2500,
      bankAccountName: s.name || 'Seller Account',
      bankAccountNumber: `XXXXXXXX${1000 + i}`,
      bankName: 'HDFC Bank',
    }));
    await model.insertMany(docs);
    this.logger.log(`✅ Created ${docs.length} payouts`);
  }

  // ── Wallet transactions ──────────────────────────────────────────────────────
  private async seedWalletTransactions(users: any[]) {
    this.logger.log('Seeding wallet transactions...');
    const customers = users.filter(u => u.role === 'customer');
    if (customers.length === 0) return;
    const mod = await import('../../models/WalletTransaction.model');
    const model = this.connection.model('WalletTransaction', mod.WalletTransactionSchema);
    const docs: any[] = [];
    customers.forEach(c => {
      docs.push({ user: c._id, amount: 1000, type: 'credit', reason: 'topup', description: 'Wallet top-up', balanceAfter: 1000 });
      docs.push({ user: c._id, amount: 200, type: 'debit', reason: 'order_payment', description: 'Order payment', balanceAfter: 800 });
    });
    await model.insertMany(docs);
    this.logger.log(`✅ Created ${docs.length} wallet transactions`);
  }

  // ── Loyalty transactions ──────────────────────────────────────────────────────
  private async seedLoyaltyTransactions(users: any[]) {
    this.logger.log('Seeding loyalty transactions...');
    const customers = users.filter(u => u.role === 'customer');
    if (customers.length === 0) return;
    const mod = await import('../../models/LoyaltyTransaction.model');
    const model = this.connection.model('LoyaltyTransaction', mod.LoyaltyTransactionSchema);
    const docs: any[] = [];
    customers.forEach(c => {
      docs.push({ user: c._id, points: 100, type: 'earn', description: 'Welcome bonus', balanceAfter: 100 });
      docs.push({ user: c._id, points: 50, type: 'redeem', description: 'Redeemed at checkout', balanceAfter: 50 });
    });
    await model.insertMany(docs);
    this.logger.log(`✅ Created ${docs.length} loyalty transactions`);
  }

  // ── Notifications ──────────────────────────────────────────────────────────────
  private async seedNotifications(users: any[]) {
    this.logger.log('Seeding notifications...');
    if (!users || users.length === 0) return;
    const mod = await import('../../models/Notification.model');
    const model = this.connection.model('Notification', mod.NotificationSchema);
    const docs = users.slice(0, 4).map(u => ({
      user: u._id,
      title: 'Welcome to the platform',
      message: 'Thanks for joining. Explore the latest deals and offers.',
      type: 'other',
    }));
    await model.insertMany(docs);
    this.logger.log(`✅ Created ${docs.length} notifications`);
  }

  // ── Broadcasts ──────────────────────────────────────────────────────────────
  private async seedBroadcasts(users: any[]) {
    this.logger.log('Seeding broadcasts...');
    const admin = users.find(u => u.role === 'admin') || users.find(u => u.role === 'superadmin');
    if (!admin) return;
    const mod = await import('../../models/Broadcast.model');
    const model = this.connection.model('Broadcast', mod.BroadcastSchema);
    await model.insertMany([
      { title: 'Festive Sale is Live', message: 'Up to 40% off across all categories this week only!', createdBy: admin._id, type: 'promotion', status: 'sent', channels: ['inApp'] },
      { title: 'Scheduled Maintenance', message: 'The platform will undergo brief maintenance this weekend.', createdBy: admin._id, type: 'system', status: 'draft', channels: ['inApp'] },
    ]);
    this.logger.log('✅ Created 2 broadcasts');
  }

  // ── Delivery slots ───────────────────────────────────────────────────────────
  private async seedDeliverySlots() {
    this.logger.log('Seeding delivery slots...');
    const mod = await import('../../models/DeliverySlot.model');
    const model = this.connection.model('DeliverySlot', mod.DeliverySlotSchema);
    const allDays = [0, 1, 2, 3, 4, 5, 6];
    const docs = [
      { label: 'Morning (8 AM – 12 PM)', startTime: '08:00', endTime: '12:00', cutoffTime: '06:00', isExpress: false, daysAvailable: allDays, maxOrders: 50, extraCharge: 0 },
      { label: 'Afternoon (12 PM – 4 PM)', startTime: '12:00', endTime: '16:00', cutoffTime: '10:00', isExpress: false, daysAvailable: allDays, maxOrders: 50, extraCharge: 0 },
      { label: 'Evening (4 PM – 8 PM)', startTime: '16:00', endTime: '20:00', cutoffTime: '14:00', isExpress: false, daysAvailable: allDays, maxOrders: 50, extraCharge: 0 },
      { label: 'Express (within 2 hours)', startTime: '09:00', endTime: '21:00', cutoffTime: '19:00', isExpress: true, daysAvailable: allDays, maxOrders: 15, extraCharge: 99 },
      { label: 'Weekend Slot (10 AM – 2 PM)', startTime: '10:00', endTime: '14:00', cutoffTime: '08:00', isExpress: false, daysAvailable: [0, 6], maxOrders: 30, extraCharge: 0 },
    ];
    await model.insertMany(docs);
    this.logger.log(`✅ Created ${docs.length} delivery slots`);
  }

  // ── Collections ──────────────────────────────────────────────────────────────
  private async seedCollections(products: any[]) {
    this.logger.log('Seeding collections...');
    if (!products || products.length === 0) return;
    const mod = await import('../../models/Collection.model');
    const model = this.connection.model('Collection', mod.CollectionSchema);
    const pick = (n: number) => products.slice(0, Math.min(n, products.length)).map(p => p._id);
    const docs = [
      { name: 'Trending Now', slug: 'trending-now', description: 'The products everyone is buying this season.', image: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=1200&q=80', products: pick(8), isFeatured: true, displayOrder: 1, isActive: true },
      { name: 'New Arrivals', slug: 'new-arrivals', description: 'Fresh picks just added to the catalogue.', image: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=1200&q=80', products: products.slice(-6).map(p => p._id), isFeatured: true, displayOrder: 2, isActive: true },
      { name: 'Editor’s Choice', slug: 'editors-choice', description: 'Hand-curated favourites from our team.', image: 'https://images.unsplash.com/photo-1472851294608-062f824d29cc?auto=format&fit=crop&w=1200&q=80', products: pick(5), isFeatured: true, displayOrder: 3, isActive: true },
      { name: 'Budget Finds', slug: 'budget-finds', description: 'Great quality without breaking the bank.', image: 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?auto=format&fit=crop&w=1200&q=80', products: pick(6), isFeatured: false, displayOrder: 4, isActive: true },
    ];
    await model.insertMany(docs);
    this.logger.log(`✅ Created ${docs.length} collections`);
  }

  // ── Bundles ──────────────────────────────────────────────────────────────────
  private async seedBundles(users: any[], products: any[]) {
    this.logger.log('Seeding bundles...');
    if (!products || products.length < 2) return;
    const seller = users.find(u => u.role === 'seller');
    const mod = await import('../../models/Bundle.model');
    const model = this.connection.model('Bundle', mod.BundleSchema);
    const makeBundle = (name: string, description: string, items: any[], discount: number) => {
      const originalPrice = Math.round(items.reduce((sum, p) => sum + (p.price ?? 0), 0) * 100) / 100;
      const bundlePrice = Math.round(originalPrice * (1 - discount / 100) * 100) / 100;
      return {
        name,
        description,
        products: items.map(p => p._id),
        seller: seller?._id,
        bundlePrice,
        originalPrice,
        discountPercent: discount,
        image: items[0]?.images?.[0],
        isActive: true,
      };
    };
    const docs = [
      makeBundle('Starter Combo', 'Two best-sellers bundled at a saving.', products.slice(0, 2), 15),
      makeBundle('Value Pack', 'Three products, one great price.', products.slice(0, 3), 20),
      makeBundle('Premium Bundle', 'Our top picks together for maximum value.', products.slice(0, Math.min(4, products.length)), 25),
    ];
    await model.insertMany(docs);
    this.logger.log(`✅ Created ${docs.length} bundles`);
  }

  // ── Price history ──────────────────────────────────────────────────────────────
  private async seedPriceHistory(users: any[], products: any[]) {
    this.logger.log('Seeding price history...');
    if (!products || products.length === 0) return;
    const admin = users.find(u => u.role === 'admin') || users.find(u => u.role === 'superadmin');
    const mod = await import('../../models/PriceHistory.model');
    const model = this.connection.model('PriceHistory', mod.PriceHistorySchema);
    const now = Date.now();
    const docs: any[] = [];
    // Give the first few products a 90/60/30-day price trail ending at today's price.
    products.slice(0, 6).forEach(p => {
      const current = p.price ?? 999;
      const points = [
        { daysAgo: 90, factor: 1.2 },
        { daysAgo: 60, factor: 1.1 },
        { daysAgo: 30, factor: 1.05 },
        { daysAgo: 0, factor: 1 },
      ];
      points.forEach(pt => {
        docs.push({
          product: p._id,
          price: Math.round(current * pt.factor * 100) / 100,
          compareAtPrice: p.compareAtPrice,
          changedAt: new Date(now - pt.daysAgo * 86400_000),
          changedBy: admin?._id,
        });
      });
    });
    await model.insertMany(docs);
    this.logger.log(`✅ Created ${docs.length} price history records`);
  }

  private async clearDatabase() {
    this.logger.log('Clearing existing data...');
    const connection = this.userModel.db;

    // CRITICAL: Drop collections with required fields FIRST
    // These might have invalid documents that cause validation errors
    const criticalCollections = [
      'users',       // Drop users first to avoid validation during other model imports
      'addresses',
      'paymentmethods',
      'categories',  // Has required slug field
      'blogs',       // Has required slug field
      'pages',       // Has required slug field
      'products',    // Has multiple required fields
      'orders',      // Has required customer field
      'reviews',     // Has required user/product fields
      'carts',       // Has required user field
      'coupons',     // Has multiple required fields
      'menus',       // Has required location field
      'forms',       // Has validation requiring fields
      'media',       // Has multiple required fields
      'blogcategories', // Has required slug field
      'banners',
      'brands',
      'widgets',
      'disputes',
      'notifications',
    ];

    for (const collectionName of criticalCollections) {
      try {
        await connection.db.collection(collectionName).drop();
        this.logger.log(`✅ Dropped critical collection: ${collectionName}`);
      } catch (error: any) {
        if (error.code !== 26 && !error.message.includes('not found')) {
          this.logger.warn(`Failed to drop ${collectionName}: ${error.message}`);
        }
      }
    }

    // Then get all other collections and drop them
    const collections = await connection.db.listCollections().toArray();
    this.logger.log(`Found ${collections.length} collections to process`);

    // Drop all collections except system collections
    for (const collection of collections) {
      const collectionName = collection.name;
      // Skip system collections and already dropped critical collections
      if (
        collectionName.startsWith('system.') ||
        collectionName === 'indexes' ||
        criticalCollections.includes(collectionName)
      ) {
        continue;
      }

      try {
        await connection.db.collection(collectionName).drop();
        this.logger.log(`✅ Dropped collection: ${collectionName}`);
      } catch (error: any) {
        // Ignore errors if collection doesn't exist (error code 26) or namespace not found
        if (error.code !== 26 && !error.message.includes('not found')) {
          this.logger.warn(`Failed to drop collection ${collectionName}: ${error.message}`);
        }
      }
    }

    // Wait a moment to ensure all drops are committed
    await new Promise(resolve => setTimeout(resolve, 100));
    this.logger.log('✅ Database clearing completed');
  }

  private async seedUsers() {
    this.logger.log('Seeding users...');
    // Use env var so seed passwords are never committed to source. If the
    // variable is absent, generate a random one and log it ONCE so whoever
    // ran the seed can retrieve it. Never use a predictable default.
    const rawPassword = process.env.SEED_USER_PASSWORD || (() => {
      const generated = require('crypto').randomBytes(16).toString('hex');
      this.logger.warn(`SEED_USER_PASSWORD not set — generated one-time password: ${generated}`);
      return generated;
    })();
    const hashedPassword = await bcrypt.hash(rawPassword, 12);

    const users = [
      {
        name: 'Super Admin',
        email: 'superadmin@dayam.in',
        password: hashedPassword,
        role: 'superadmin',
        status: 'active',
        emailVerified: true,
      },
      {
        name: 'Admin User',
        email: 'admin@dayam.in',
        password: hashedPassword,
        role: 'admin',
        status: 'active',
        emailVerified: true,
      },
      {
        name: 'Raj Electronics',
        email: 'seller@dayam.in',
        password: hashedPassword,
        role: 'seller',
        status: 'active',
        emailVerified: true,
        // Seeded sellers are pre-approved so their store + products are live
        // (otherwise they default to approvalStatus 'pending' and the public
        // approval gate would hide everything).
        sellerInfo: { approvalStatus: 'approved', submittedAt: new Date(), reviewedAt: new Date() },
      },
      {
        name: 'Priya Fashion Store',
        email: 'jane.seller@dayam.in',
        password: hashedPassword,
        role: 'seller',
        status: 'active',
        emailVerified: true,
        sellerInfo: { approvalStatus: 'approved', submittedAt: new Date(), reviewedAt: new Date() },
      },
      {
        name: 'Ankit Sharma',
        email: 'customer1@dayam.in',
        password: hashedPassword,
        role: 'customer',
        status: 'active',
        emailVerified: true,
      },
      {
        name: 'Meera Patel',
        email: 'customer2@dayam.in',
        password: hashedPassword,
        role: 'customer',
        status: 'active',
        emailVerified: true,
      },
      {
        name: 'Content Editor',
        email: 'editor@dayam.in',
        password: hashedPassword,
        role: 'contentEditor',
        status: 'active',
        emailVerified: true,
      },
    ];

    try {
      // Don't use deleteMany - it can trigger validation on other models
      // Collections are already dropped in clearDatabase()

      const createdUsers = await this.userModel.insertMany(users, {
        ordered: true,
        rawResult: false,
      });

      this.logger.log(`✅ Created ${createdUsers.length} users`);

      // Debug: Log user IDs to ensure they're accessible
      createdUsers.forEach((user, index) => {
        this.logger.log(`User ${index + 1}: ${user.email} - ID: ${user._id}`);
      });

      return createdUsers;
    } catch (error: any) {
      this.logger.error(`Error seeding users: ${error.message}`);
      this.logger.error(`Error details: ${JSON.stringify(error, null, 2)}`);
      throw error;
    }
  }

  private async seedCategories() {
    this.logger.log('Seeding categories...');

    const categoryModule = await import('../../models/Category.model');
    const CategorySchema = categoryModule.CategorySchema;
    const categoryModel = this.connection.model('Category', CategorySchema);

    const categories = [
      // ── Electronics ─────────────────────────────────────────────────────
      {
        name: 'Electronics',
        slug: 'electronics',
        description: 'Smartphones, laptops, accessories, and the latest gadgets',
        image: 'https://images.unsplash.com/photo-1498049794561-7780e7231661?w=600',
        icon: '📱',
        featured: true,
        displayOrder: 1,
        status: 'active',
      },
      {
        name: 'Smartphones',
        slug: 'smartphones',
        description: 'Latest Android and iOS smartphones from top brands',
        image: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=600',
        icon: '📱',
        featured: false,
        displayOrder: 2,
        status: 'active',
      },
      {
        name: 'Laptops & Computers',
        slug: 'laptops',
        description: 'Laptops, desktops, monitors and computing accessories',
        image: 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=600',
        icon: '💻',
        featured: false,
        displayOrder: 3,
        status: 'active',
      },
      // ── Fashion ──────────────────────────────────────────────────────────
      {
        name: 'Fashion',
        slug: 'fashion',
        description: "Men's, women's and kids' clothing, footwear and accessories",
        image: 'https://images.unsplash.com/photo-1445205170230-053b83016050?w=600',
        icon: '👗',
        featured: true,
        displayOrder: 4,
        status: 'active',
      },
      {
        name: "Men's Clothing",
        slug: 'mens-clothing',
        description: "Shirts, trousers, suits, and casual wear for men",
        image: 'https://images.unsplash.com/photo-1490578474895-699cd4e2cf59?w=600',
        icon: '👔',
        featured: false,
        displayOrder: 5,
        status: 'active',
      },
      {
        name: "Women's Clothing",
        slug: 'womens-clothing',
        description: "Dresses, tops, ethnic wear and western outfits for women",
        image: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=600',
        icon: '👗',
        featured: false,
        displayOrder: 6,
        status: 'active',
      },
      {
        name: 'Footwear',
        slug: 'footwear',
        description: 'Sneakers, formal shoes, sandals and sports footwear',
        image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600',
        icon: '👟',
        featured: false,
        displayOrder: 7,
        status: 'active',
      },
      // ── Home & Kitchen ───────────────────────────────────────────────────
      {
        name: 'Home & Kitchen',
        slug: 'home-kitchen',
        description: 'Furniture, cookware, decor and everything for your home',
        image: 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=600',
        icon: '🏠',
        featured: true,
        displayOrder: 8,
        status: 'active',
      },
      {
        name: 'Kitchen Appliances',
        slug: 'kitchen-appliances',
        description: 'Mixers, microwaves, air fryers and smart kitchen gadgets',
        image: 'https://images.unsplash.com/photo-1585771724684-38269d6639fd?w=600',
        icon: '🍳',
        featured: false,
        displayOrder: 9,
        status: 'active',
      },
      {
        name: 'Home Decor',
        slug: 'home-decor',
        description: 'Candles, wall art, cushions and decorative items',
        image: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=600',
        icon: '🕯️',
        featured: false,
        displayOrder: 10,
        status: 'active',
      },
      // ── Beauty & Personal Care ───────────────────────────────────────────
      {
        name: 'Beauty & Personal Care',
        slug: 'beauty',
        description: 'Skincare, haircare, makeup and personal grooming products',
        image: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=600',
        icon: '💄',
        featured: true,
        displayOrder: 11,
        status: 'active',
      },
      {
        name: 'Skincare',
        slug: 'skincare',
        description: 'Moisturisers, serums, sunscreens and face wash',
        image: 'https://images.unsplash.com/photo-1570194065650-d99fb4ee3b4c?w=600',
        icon: '✨',
        featured: false,
        displayOrder: 12,
        status: 'active',
      },
      // ── Sports & Fitness ─────────────────────────────────────────────────
      {
        name: 'Sports & Fitness',
        slug: 'sports',
        description: 'Gym equipment, sportswear, cycles and outdoor gear',
        image: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=600',
        icon: '🏋️',
        featured: true,
        displayOrder: 13,
        status: 'active',
      },
      // ── Books & Stationery ───────────────────────────────────────────────
      {
        name: 'Books & Stationery',
        slug: 'books',
        description: 'Fiction, non-fiction, textbooks, notebooks and art supplies',
        image: 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=600',
        icon: '📚',
        featured: false,
        displayOrder: 14,
        status: 'active',
      },
      // ── Grocery & Gourmet ────────────────────────────────────────────────
      {
        name: 'Grocery & Gourmet',
        slug: 'grocery',
        description: 'Organic foods, snacks, beverages and specialty gourmet items',
        image: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=600',
        icon: '🛒',
        featured: true,
        displayOrder: 15,
        status: 'active',
      },
      {
        name: 'Health & Nutrition',
        slug: 'health-nutrition',
        description: 'Vitamins, supplements, protein powders and wellness products',
        image: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=600',
        icon: '💊',
        featured: false,
        displayOrder: 16,
        status: 'active',
      },
      // ── Toys & Baby ──────────────────────────────────────────────────────
      {
        name: 'Toys & Baby',
        slug: 'toys-baby',
        description: 'Educational toys, baby gear, games and kids accessories',
        image: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600',
        icon: '🧸',
        featured: false,
        displayOrder: 17,
        status: 'active',
      },
      // ── Automotive ───────────────────────────────────────────────────────
      {
        name: 'Automotive',
        slug: 'automotive',
        description: 'Car accessories, tools, care products and bike gear',
        image: 'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=600',
        icon: '🚗',
        featured: false,
        displayOrder: 18,
        status: 'active',
      },
    ];

    const createdCategories = await categoryModel.insertMany(categories);
    this.logger.log(`✅ Created ${createdCategories.length} categories`);
    return createdCategories;
  }

  private async seedProducts(users: any[], categories: any[]) {
    this.logger.log('Seeding products...');

    const productModule = await import('../../models/Product.model');
    const ProductSchema = productModule.ProductSchema;
    const productModel = this.connection.model('Product', ProductSchema);

    const seller1 = users.find(u => u.email === 'seller@dayam.in');
    const seller2 = users.find(u => u.email === 'jane.seller@dayam.in');

    // Helper to find category by slug
    const cat = (slug: string) => {
      const found = categories.find((c: any) => c.slug === slug);
      if (!found) throw new Error(`Category not found: ${slug}`);
      return found._id;
    };

    const products = [
      // ── Electronics / Smartphones ────────────────────────────────────────
      {
        name: 'Samsung Galaxy S24 Ultra 256GB',
        description: 'The Samsung Galaxy S24 Ultra features a 6.8-inch Dynamic AMOLED display, Snapdragon 8 Gen 3 chipset, 200MP quad-camera system, and built-in S Pen. All-day battery life with 45W fast charging.',
        sku: 'ELEC-SM-S24U',
        price: 124999,
        compareAtPrice: 134999,
        category: cat('smartphones'),
        seller: seller1._id,
        images: [
          'https://images.unsplash.com/photo-1610945415295-d9bbf067e59c?w=600',
          'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=600',
        ],
        inventory: 45,
        status: 'approved',
        featured: true,
        rating: 4.7,
        numReviews: 312,
        tags: ['samsung', 'galaxy', 'android', 'flagship', '5g'],
        specifications: [
          { label: 'Display', value: '6.8" Dynamic AMOLED 2X, 3088×1440' },
          { label: 'Processor', value: 'Snapdragon 8 Gen 3' },
          { label: 'RAM', value: '12 GB' },
          { label: 'Storage', value: '256 GB' },
          { label: 'Camera', value: '200MP + 12MP + 10MP + 10MP' },
          { label: 'Battery', value: '5000 mAh, 45W Fast Charging' },
          { label: 'OS', value: 'Android 14 (One UI 6.1)' },
          { label: 'Connectivity', value: '5G, Wi-Fi 7, Bluetooth 5.3' },
          { label: 'Weight', value: '232g' },
          { label: 'Color', value: 'Titanium Black' },
        ],
        qna: [
          { q: 'Does the S24 Ultra support 5G in India?', a: 'Yes, it supports both SA and NSA 5G bands including the sub-6GHz bands available in India.' },
          { q: 'Is the S Pen included in the box?', a: 'Yes, the S Pen is built into the device and included out of the box.' },
          { q: 'What warranty is provided?', a: '1-year Samsung India warranty with access to 2000+ service centers across India.' },
          { q: 'Does it support wireless charging?', a: 'Yes, it supports 15W wireless charging and 4.5W reverse wireless charging.' },
        ],
      },
      {
        name: 'Apple iPhone 15 Pro 128GB Natural Titanium',
        description: 'iPhone 15 Pro with A17 Pro chip, titanium design, 48MP main camera with 5x optical zoom, Action Button, and USB-C with USB 3 speeds. Available in natural titanium finish.',
        sku: 'ELEC-AP-IP15P',
        price: 134900,
        compareAtPrice: 139900,
        category: cat('smartphones'),
        seller: seller2._id,
        images: [
          'https://images.unsplash.com/photo-1592750475338-74b7b21085ab?w=600',
          'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=600',
        ],
        inventory: 30,
        status: 'approved',
        featured: true,
        rating: 4.9,
        numReviews: 547,
        tags: ['apple', 'iphone', 'ios', 'flagship', '5g'],
        specifications: [
          { label: 'Display', value: '6.1" Super Retina XDR OLED' },
          { label: 'Processor', value: 'Apple A17 Pro' },
          { label: 'Storage', value: '128 GB' },
          { label: 'Camera', value: '48MP Main + 12MP Ultra Wide + 12MP 5x Telephoto' },
          { label: 'Battery', value: 'Up to 23 hours video playback' },
          { label: 'Charging', value: 'USB-C, MagSafe, Qi2' },
          { label: 'OS', value: 'iOS 17' },
          { label: 'Build', value: 'Titanium frame, textured matte glass back' },
          { label: 'Weight', value: '187g' },
          { label: 'Color', value: 'Natural Titanium' },
        ],
        qna: [
          { q: 'Does iPhone 15 Pro support 5G?', a: 'Yes, it supports 5G (sub-6GHz) across all Indian networks.' },
          { q: 'Can I use two SIMs?', a: 'It supports Dual SIM (nano-SIM + eSIM) in India.' },
          { q: 'Does it come with a charger in the box?', a: 'Apple includes a USB-C cable but no power adapter. You will need to purchase an adapter separately.' },
          { q: 'What warranty does this carry?', a: '1-year Apple India limited warranty. You can also purchase AppleCare+ for extended coverage.' },
        ],
      },
      {
        name: 'OnePlus 12 256GB Flowy Emerald',
        description: 'OnePlus 12 packs Snapdragon 8 Gen 3, 50MP Hasselblad triple camera, 100W SUPERVOOC charging, and a 6.82-inch LTPO AMOLED display with up to 120Hz refresh rate.',
        sku: 'ELEC-OP-OP12',
        price: 64999,
        compareAtPrice: 69999,
        category: cat('smartphones'),
        seller: seller1._id,
        images: [
          'https://images.unsplash.com/photo-1601784551446-20c9e07cdbdb?w=600',
        ],
        inventory: 60,
        status: 'approved',
        featured: false,
        rating: 4.5,
        numReviews: 189,
        tags: ['oneplus', 'android', '5g', 'fast-charging'],
      },
      // ── Laptops ──────────────────────────────────────────────────────────
      {
        name: 'Apple MacBook Air M3 13-inch 8GB/256GB',
        description: 'MacBook Air with M3 chip — the most advanced MacBook Air ever. Up to 18 hours battery, 13.6-inch Liquid Retina display, 8-core CPU and 8-core GPU. Fanless, silent performance.',
        sku: 'ELEC-AP-MBA-M3',
        price: 114900,
        compareAtPrice: 119900,
        category: cat('laptops'),
        seller: seller2._id,
        images: [
          'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=600',
          'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=600',
        ],
        inventory: 25,
        status: 'approved',
        featured: true,
        rating: 4.8,
        numReviews: 423,
        tags: ['apple', 'macbook', 'laptop', 'm3', 'ultrabook'],
      },
      {
        name: 'Dell XPS 15 Intel Core i7 16GB/512GB',
        description: 'Dell XPS 15 with 13th Gen Intel Core i7-13700H, 16GB DDR5 RAM, 512GB NVMe SSD, NVIDIA RTX 4060, and a stunning 15.6-inch OLED 3.5K touchscreen display.',
        sku: 'ELEC-DL-XPS15',
        price: 159990,
        compareAtPrice: 179990,
        category: cat('laptops'),
        seller: seller1._id,
        images: [
          'https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=600',
        ],
        inventory: 18,
        status: 'approved',
        featured: false,
        rating: 4.6,
        numReviews: 156,
        tags: ['dell', 'xps', 'laptop', 'gaming', 'oled'],
      },
      // ── Men's Clothing ───────────────────────────────────────────────────
      {
        name: 'Allen Solly Men Slim Fit Formal Shirt - White',
        description: 'Allen Solly Men formal slim fit shirt in premium cotton fabric. Features a classic point collar, single chest pocket, and full button placket. Machine washable. Available in sizes S-XXL.',
        sku: 'FASH-AS-MSHIRT-WHT',
        price: 1299,
        compareAtPrice: 1799,
        category: cat('mens-clothing'),
        seller: seller1._id,
        images: [
          'https://images.unsplash.com/photo-1598033129183-c4f50c736f10?w=600',
          'https://images.unsplash.com/photo-1490578474895-699cd4e2cf59?w=600',
        ],
        inventory: 200,
        status: 'approved',
        featured: false,
        rating: 4.2,
        numReviews: 88,
        tags: ['shirt', 'formal', 'mens', 'slim-fit'],
        variants: [{ name: 'Size', options: ['S', 'M', 'L', 'XL', 'XXL'] }],
      },
      {
        name: 'Levi\'s 511 Slim Fit Jeans - Blue Indigo',
        description: 'Levi\'s iconic 511 slim fit jeans crafted from stretch denim for comfort and mobility. Sits below the waist, slim through the seat and thigh, and narrow at the leg opening.',
        sku: 'FASH-LV-511-INDIGO',
        price: 2999,
        compareAtPrice: 3999,
        category: cat('mens-clothing'),
        seller: seller2._id,
        images: [
          'https://images.unsplash.com/photo-1542272604-787c3835535d?w=600',
        ],
        inventory: 150,
        status: 'approved',
        featured: false,
        rating: 4.5,
        numReviews: 234,
        tags: ['levis', 'jeans', 'mens', 'denim'],
        variants: [{ name: 'Size', options: ['28', '30', '32', '34', '36'] }],
      },
      // ── Women's Clothing ─────────────────────────────────────────────────
      {
        name: 'Biba Women Anarkali Kurta - Multicolor',
        description: 'Biba women anarkali kurta in multicolor floral print. Made from premium cotton blend fabric. Features three-quarter sleeves and a flared silhouette. Perfect for festive occasions.',
        sku: 'FASH-BB-WKURTA-MC',
        price: 1599,
        compareAtPrice: 2299,
        category: cat('womens-clothing'),
        seller: seller1._id,
        images: [
          'https://images.unsplash.com/photo-1594938298603-c8148c4b0abb?w=600',
          'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=600',
        ],
        inventory: 120,
        status: 'approved',
        featured: true,
        rating: 4.3,
        numReviews: 145,
        tags: ['biba', 'kurta', 'ethnic', 'womens', 'festive'],
        variants: [{ name: 'Size', options: ['XS', 'S', 'M', 'L', 'XL'] }],
      },
      {
        name: 'H&M Women Floral Wrap Dress',
        description: 'Elegant wrap dress in a floaty woven fabric with an all-over floral print. V-neck, long sleeves with buttons at the cuffs, and a tie belt at the waist. Midi length.',
        sku: 'FASH-HM-WDRESS-FL',
        price: 1999,
        compareAtPrice: 2799,
        category: cat('womens-clothing'),
        seller: seller2._id,
        images: [
          'https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=600',
        ],
        inventory: 85,
        status: 'approved',
        featured: false,
        rating: 4.1,
        numReviews: 67,
        tags: ['hm', 'dress', 'floral', 'womens', 'midi'],
        variants: [{ name: 'Size', options: ['XS', 'S', 'M', 'L'] }],
      },
      // ── Footwear ─────────────────────────────────────────────────────────
      {
        name: 'Nike Air Max 270 Running Shoes - Black/White',
        description: "Nike Air Max 270 features Nike's largest Air unit yet for incredible all-day comfort. Mesh upper for breathability, foam midsole for cushioning, and rubber outsole for durability.",
        sku: 'FASH-NK-AM270-BLK',
        price: 10995,
        compareAtPrice: 13495,
        category: cat('footwear'),
        seller: seller1._id,
        images: [
          'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600',
          'https://images.unsplash.com/photo-1460353581641-37baddab0fa2?w=600',
        ],
        inventory: 80,
        status: 'approved',
        featured: true,
        rating: 4.6,
        numReviews: 391,
        tags: ['nike', 'airmax', 'running', 'shoes', 'sneakers'],
        variants: [{ name: 'Size (UK)', options: ['6', '7', '8', '9', '10', '11'] }],
      },
      {
        name: 'Adidas Ultraboost 22 Running Shoes',
        description: 'Adidas Ultraboost 22 with Boost midsole for incredible energy return, Primeknit upper for adaptive support, and Continental rubber outsole for exceptional grip on any surface.',
        sku: 'FASH-AD-UB22-WHT',
        price: 14999,
        compareAtPrice: 17999,
        category: cat('footwear'),
        seller: seller2._id,
        images: [
          'https://images.unsplash.com/photo-1608231387042-66d1773070a5?w=600',
        ],
        inventory: 55,
        status: 'approved',
        featured: false,
        rating: 4.7,
        numReviews: 278,
        tags: ['adidas', 'ultraboost', 'running', 'shoes'],
        variants: [{ name: 'Size (UK)', options: ['6', '7', '8', '9', '10', '11'] }],
      },
      // ── Kitchen Appliances ────────────────────────────────────────────────
      {
        name: 'Philips HD9252/90 Air Fryer 1400W 4.1L',
        description: 'Philips air fryer with Rapid Air technology circulates hot air for crispy results using up to 90% less fat. 4.1L capacity, 7 preset programs, digital touchscreen, dishwasher-safe basket.',
        sku: 'HOME-PH-AF4L',
        price: 7995,
        compareAtPrice: 10995,
        category: cat('kitchen-appliances'),
        seller: seller1._id,
        images: [
          'https://images.unsplash.com/photo-1585771724684-38269d6639fd?w=600',
        ],
        inventory: 65,
        status: 'approved',
        featured: true,
        rating: 4.5,
        numReviews: 512,
        tags: ['philips', 'airfryer', 'kitchen', 'healthy-cooking'],
      },
      {
        name: 'Instant Pot Duo 7-in-1 Electric Pressure Cooker 6L',
        description: 'Instant Pot Duo combines 7 kitchen appliances in 1: pressure cooker, slow cooker, rice cooker, steamer, sauté pan, yogurt maker and warmer. 6L capacity with 13 built-in programs.',
        sku: 'HOME-IP-DUO6L',
        price: 8999,
        compareAtPrice: 11999,
        category: cat('kitchen-appliances'),
        seller: seller2._id,
        images: [
          'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=600',
        ],
        inventory: 40,
        status: 'approved',
        featured: false,
        rating: 4.8,
        numReviews: 689,
        tags: ['instant-pot', 'pressure-cooker', 'kitchen', 'multi-cooker'],
      },
      {
        name: 'Dyson V15 Detect Cordless Vacuum Cleaner',
        description: 'Dyson V15 Detect reveals microscopic dust with its built-in laser. Intelligent suction automatically adapts to hidden debris. Up to 60 minutes fade-free power. HEPA filtration.',
        sku: 'HOME-DY-V15',
        price: 52900,
        compareAtPrice: 62900,
        category: cat('home-kitchen'),
        seller: seller1._id,
        images: [
          'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600',
        ],
        inventory: 20,
        status: 'approved',
        featured: false,
        rating: 4.7,
        numReviews: 203,
        tags: ['dyson', 'vacuum', 'cordless', 'home-cleaning'],
      },
      // ── Home Decor ────────────────────────────────────────────────────────
      {
        name: 'Scented Soy Wax Candle Set - Lavender & Vanilla (Pack of 3)',
        description: 'Hand-poured soy wax candles with premium fragrance oils. Set of 3 — lavender, vanilla, and sandalwood. 40-hour burn time each. Eco-friendly, clean-burning, no toxic chemicals.',
        sku: 'HOME-DC-CANDLE3',
        price: 999,
        compareAtPrice: 1499,
        category: cat('home-decor'),
        seller: seller2._id,
        images: [
          'https://images.unsplash.com/photo-1602523961358-f9f03dd557db?w=600',
          'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=600',
        ],
        inventory: 180,
        status: 'approved',
        featured: false,
        rating: 4.4,
        numReviews: 134,
        tags: ['candle', 'soy-wax', 'home-decor', 'aromatherapy', 'gift'],
      },
      // ── Beauty & Skincare ─────────────────────────────────────────────────
      {
        name: 'Minimalist 10% Niacinamide + Zinc Face Serum 30ml',
        description: 'Minimalist niacinamide serum with 10% niacinamide and 1% zinc to visibly reduce pores, control sebum, and even skin tone. Lightweight, water-based formula suitable for all skin types.',
        sku: 'BEAU-MM-NIAC30',
        price: 599,
        compareAtPrice: 799,
        category: cat('skincare'),
        seller: seller1._id,
        images: [
          'https://images.unsplash.com/photo-1570194065650-d99fb4ee3b4c?w=600',
          'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=600',
        ],
        inventory: 300,
        status: 'approved',
        featured: true,
        rating: 4.6,
        numReviews: 892,
        tags: ['minimalist', 'niacinamide', 'serum', 'skincare', 'pores'],
      },
      {
        name: 'Mamaearth Onion Hair Oil 250ml - Hair Fall Control',
        description: 'Mamaearth onion hair oil with onion and plant keratin controls hair fall and promotes growth. Enriched with argan oil for deep nourishment. Suitable for all hair types. Toxin-free formula.',
        sku: 'BEAU-ME-HAIROIL250',
        price: 349,
        compareAtPrice: 449,
        category: cat('beauty'),
        seller: seller2._id,
        images: [
          'https://images.unsplash.com/photo-1526045612212-70caf35c14df?w=600',
        ],
        inventory: 250,
        status: 'approved',
        featured: false,
        rating: 4.3,
        numReviews: 1203,
        tags: ['mamaearth', 'hair-oil', 'onion', 'hairfall', 'natural'],
      },
      {
        name: 'Lakme 9 to 5 Primer + Matte Lipstick - Ruby Rush',
        description: 'Lakme 9 to 5 primer and matte lipstick with built-in primer for smooth, even application. Long-lasting 9-hour formula. Creamy yet matte finish. Color: Ruby Rush (bold red).',
        sku: 'BEAU-LK-LIPSTICK-RR',
        price: 299,
        compareAtPrice: 399,
        category: cat('beauty'),
        seller: seller1._id,
        images: [
          'https://images.unsplash.com/photo-1586495777744-4e6232bf2a53?w=600',
        ],
        inventory: 400,
        status: 'approved',
        featured: false,
        rating: 4.2,
        numReviews: 567,
        tags: ['lakme', 'lipstick', 'matte', 'makeup'],
        variants: [{ name: 'Shade', options: ['Ruby Rush', 'Pink Blush', 'Berry Passion', 'Nude Affair'] }],
      },
      // ── Sports & Fitness ──────────────────────────────────────────────────
      {
        name: 'Boldfit Adjustable Dumbbell Set 20kg (Pair)',
        description: 'Boldfit adjustable dumbbell set with quick-change weight mechanism. Each dumbbell adjusts from 2kg to 10kg in 2kg increments. Solid steel construction with anti-slip grip. Includes storage tray.',
        sku: 'SPRT-BF-DUMBBELL20',
        price: 3499,
        compareAtPrice: 4999,
        category: cat('sports'),
        seller: seller2._id,
        images: [
          'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=600',
          'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=600',
        ],
        inventory: 75,
        status: 'approved',
        featured: true,
        rating: 4.4,
        numReviews: 345,
        tags: ['dumbbell', 'fitness', 'gym', 'weight-training', 'home-gym'],
      },
      {
        name: 'Decathlon Artengo TR 190 Tennis Racket',
        description: 'Decathlon Artengo TR 190 recreational tennis racket for beginners and intermediate players. 100 sq.in head size, aluminium frame for durability, strung with synthetic strings. Weight: 265g.',
        sku: 'SPRT-DC-TENNIS',
        price: 1299,
        compareAtPrice: 1799,
        category: cat('sports'),
        seller: seller1._id,
        images: [
          'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600',
        ],
        inventory: 55,
        status: 'approved',
        featured: false,
        rating: 4.1,
        numReviews: 89,
        tags: ['decathlon', 'tennis', 'racket', 'sports'],
      },
      {
        name: 'Puma Men Running Track Pants - Black',
        description: 'Puma men track pants with moisture-wicking dryCELL technology. Side pockets with zipper, elastic waistband with inner drawstring. Lightweight and breathable for training and running.',
        sku: 'SPRT-PM-TRACKPANT-BLK',
        price: 1799,
        compareAtPrice: 2499,
        category: cat('sports'),
        seller: seller2._id,
        images: [
          'https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=600',
        ],
        inventory: 130,
        status: 'approved',
        featured: false,
        rating: 4.3,
        numReviews: 156,
        tags: ['puma', 'trackpant', 'running', 'sportswear'],
        variants: [{ name: 'Size', options: ['S', 'M', 'L', 'XL', 'XXL'] }],
      },
      // ── Books ─────────────────────────────────────────────────────────────
      {
        name: 'Atomic Habits by James Clear (Paperback)',
        description: 'Atomic Habits by James Clear is a practical guide to building good habits and breaking bad ones. Learn how tiny changes can lead to remarkable results. Over 10 million copies sold worldwide.',
        sku: 'BOOK-JC-ATOMIC',
        price: 499,
        compareAtPrice: 699,
        category: cat('books'),
        seller: seller1._id,
        images: [
          'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=600',
          'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=600',
        ],
        inventory: 500,
        status: 'approved',
        featured: true,
        rating: 4.9,
        numReviews: 2341,
        tags: ['book', 'self-help', 'habits', 'productivity', 'james-clear'],
      },
      {
        name: 'The Psychology of Money by Morgan Housel',
        description: 'Morgan Housel explores the strange ways people think about money and teaches you how to make better sense of one of life\'s most important subjects. A must-read for anyone seeking financial wisdom.',
        sku: 'BOOK-MH-PSYMONEY',
        price: 449,
        compareAtPrice: 599,
        category: cat('books'),
        seller: seller2._id,
        images: [
          'https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=600',
        ],
        inventory: 380,
        status: 'approved',
        featured: false,
        rating: 4.8,
        numReviews: 1567,
        tags: ['book', 'finance', 'money', 'personal-finance'],
      },
      // ── Grocery & Gourmet ─────────────────────────────────────────────────
      {
        name: 'Tata Salt Lite 1kg (Low Sodium)',
        description: 'Tata Salt Lite with 15% lower sodium compared to regular salt. Iodized for thyroid health. Processed under strict quality standards. Available in easy-pour packaging. Ideal for a healthier lifestyle.',
        sku: 'GROC-TS-SALTLITE1KG',
        price: 39,
        compareAtPrice: 49,
        category: cat('grocery'),
        seller: seller1._id,
        images: [
          'https://images.unsplash.com/photo-1501432377862-3d0432b87a14?w=600',
        ],
        inventory: 1000,
        status: 'approved',
        featured: false,
        rating: 4.4,
        numReviews: 2890,
        tags: ['tata', 'salt', 'low-sodium', 'grocery', 'staples'],
      },
      {
        name: 'Yoga Bar Oats + Whey Protein Bar - Choco Almond (Pack of 6)',
        description: 'Yoga Bar protein bars with 8g protein per bar. Made with whole grain oats, whey protein, and real almonds. No refined sugar. Perfect post-workout snack or healthy breakfast on the go.',
        sku: 'GROC-YB-PROTBAR6',
        price: 349,
        compareAtPrice: 420,
        category: cat('grocery'),
        seller: seller2._id,
        images: [
          'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=600',
        ],
        inventory: 600,
        status: 'approved',
        featured: false,
        rating: 4.2,
        numReviews: 734,
        tags: ['yoga-bar', 'protein-bar', 'snacks', 'healthy', 'oats'],
      },
      // ── Health & Nutrition ────────────────────────────────────────────────
      {
        name: 'Oziva Protein & Herbs for Women 500g - Chocolate',
        description: 'OZiva protein blend with whey protein, soy protein, ayurvedic herbs, and multivitamins. 23g protein per serving. Designed for women — supports lean muscle, weight management and hormonal balance.',
        sku: 'HLTH-OZ-PROTWOMEN500',
        price: 1299,
        compareAtPrice: 1799,
        category: cat('health-nutrition'),
        seller: seller1._id,
        images: [
          'https://images.unsplash.com/photo-1593095948071-474c5cc2989d?w=600',
        ],
        inventory: 150,
        status: 'approved',
        featured: false,
        rating: 4.3,
        numReviews: 456,
        tags: ['oziva', 'protein', 'women', 'supplement', 'whey'],
        variants: [{ name: 'Flavor', options: ['Chocolate', 'Vanilla', 'Strawberry'] }],
      },
      {
        name: 'Himalaya Ashwagandha Tablet 60 Tabs - Stress Relief',
        description: 'Himalaya Ashwagandha pure herb tablets. Clinically proven to reduce stress and anxiety, improve physical endurance, and boost immunity. 1 tablet twice daily after meals. No artificial preservatives.',
        sku: 'HLTH-HIM-ASHWA60',
        price: 185,
        compareAtPrice: 230,
        category: cat('health-nutrition'),
        seller: seller2._id,
        images: [
          'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=600',
        ],
        inventory: 800,
        status: 'approved',
        featured: false,
        rating: 4.5,
        numReviews: 1234,
        tags: ['himalaya', 'ashwagandha', 'ayurvedic', 'stress-relief', 'supplement'],
      },
      // ── Toys & Baby ───────────────────────────────────────────────────────
      {
        name: 'LEGO Classic Creative Brick Box 484 Pieces',
        description: 'LEGO Classic creative brick box with 484 pieces in 33 colors. Includes building guide with 5 ideas. Develops creativity, motor skills and problem-solving in children ages 4+. 100% compatible with all LEGO sets.',
        sku: 'TOYS-LG-CLASSIC484',
        price: 3199,
        compareAtPrice: 3999,
        category: cat('toys-baby'),
        seller: seller1._id,
        images: [
          'https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=600',
          'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600',
        ],
        inventory: 90,
        status: 'approved',
        featured: true,
        rating: 4.8,
        numReviews: 678,
        tags: ['lego', 'toys', 'building', 'kids', 'creative'],
      },
      {
        name: 'Fisher-Price Laugh & Learn Smart Stages Chair',
        description: 'Fisher-Price baby activity chair with 3 Smart Stages learning levels that grow with baby (6-36 months). 65+ songs, sounds, and phrases. Teaches ABCs, numbers, colours, and more.',
        sku: 'TOYS-FP-SMARTCHAIR',
        price: 2499,
        compareAtPrice: 3499,
        category: cat('toys-baby'),
        seller: seller2._id,
        images: [
          'https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=600',
        ],
        inventory: 45,
        status: 'approved',
        featured: false,
        rating: 4.6,
        numReviews: 289,
        tags: ['fisher-price', 'baby', 'educational', 'learning', 'infant'],
      },
      // ── Automotive ────────────────────────────────────────────────────────
      {
        name: 'Bosch S4 Car Battery 55Ah 12V - Maintenance Free',
        description: 'Bosch S4 maintenance-free car battery with 55Ah capacity. Suitable for most petrol and diesel cars. High cycle stability, vibration resistant, and leak-proof design. 24-month warranty.',
        sku: 'AUTO-BSH-BATT55AH',
        price: 5499,
        compareAtPrice: 6999,
        category: cat('automotive'),
        seller: seller1._id,
        images: [
          'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=600',
        ],
        inventory: 35,
        status: 'approved',
        featured: false,
        rating: 4.4,
        numReviews: 167,
        tags: ['bosch', 'car-battery', 'automotive', 'maintenance-free'],
      },
      {
        name: '3M Scotchgard Car Wash Shampoo 500ml',
        description: '3M Scotchgard car wash shampoo with pH balanced formula that is safe on clear coat and wax finishes. Rich foaming action removes dirt, grime, and road film without stripping wax protection.',
        sku: 'AUTO-3M-CARWASH500',
        price: 299,
        compareAtPrice: 399,
        category: cat('automotive'),
        seller: seller2._id,
        images: [
          'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600',
        ],
        inventory: 250,
        status: 'approved',
        featured: false,
        rating: 4.3,
        numReviews: 312,
        tags: ['3m', 'car-wash', 'shampoo', 'automotive', 'car-care'],
      },
    ];

    const createdProducts = await productModel.insertMany(products);
    this.logger.log(`✅ Created ${createdProducts.length} products across ${categories.length} categories`);
    return createdProducts;
  }

  private async seedAddresses(users: any[]) {
    this.logger.log('Seeding addresses...');

    // Dynamically import Address schema only - avoid importing the pre-registered model
    const addressModule = await import('../../models/Address.model');
    const AddressSchema = addressModule.AddressSchema;

    // Register Address model using schema directly
    const addressModel = this.connection.model('Address', AddressSchema);

    const customer1 = users.find(u => u.email === 'customer1@dayam.in');
    const customer2 = users.find(u => u.email === 'customer2@dayam.in');

    if (!customer1 || !customer2) {
      this.logger.warn('Customer users not found, skipping address seeding');
      this.logger.log(`Available users: ${users.map(u => u.email).join(', ')}`);
      return [];
    }

    const user1Id = customer1._id || customer1.id;
    const user2Id = customer2._id || customer2.id;

    this.logger.log(`Found customer1: ${customer1.email} with ID: ${user1Id} (type: ${typeof user1Id})`);
    this.logger.log(`Found customer2: ${customer2.email} with ID: ${user2Id} (type: ${typeof user2Id})`);

    if (!user1Id || !user2Id) {
      this.logger.error(`Missing user IDs: customer1=${!!user1Id}, customer2=${!!user2Id}`);
      throw new Error('User IDs are missing');
    }

    const addresses = [
      {
        user: user1Id,
        type: 'both',
        firstName: 'Customer',
        lastName: 'One',
        addressLine1: '123 Main Street',
        addressLine2: 'Apt 4B',
        city: 'New York',
        state: 'NY',
        zipCode: '10001',
        country: 'United States',
        phone: '+1234567890',
        isDefault: true,
      },
      {
        user: user2Id,
        type: 'both',
        firstName: 'Customer',
        lastName: 'Two',
        addressLine1: '456 Oak Avenue',
        city: 'Los Angeles',
        state: 'CA',
        zipCode: '90001',
        country: 'United States',
        phone: '+1987654321',
        isDefault: true,
      },
    ];

    // Log the exact data being sent
    this.logger.log(`Preparing to insert ${addresses.length} addresses`);
    addresses.forEach((addr, index) => {
      this.logger.log(`Address ${index + 1}: user=${addr.user}, type=${addr.type}, userType=${typeof addr.user}`);
    });

    // Validate before insert
    const invalidAddresses = addresses.filter(addr => !addr.user || !addr.type);
    if (invalidAddresses.length > 0) {
      this.logger.error(`Found ${invalidAddresses.length} invalid addresses`);
      invalidAddresses.forEach((addr, index) => {
        this.logger.error(`Invalid address ${index + 1}: user=${addr.user}, type=${addr.type}`);
      });
      throw new Error('Address data is invalid: missing required fields');
    }

    try {
      const createdAddresses = await addressModel.insertMany(addresses, {
        ordered: false,
        rawResult: false
      });
      this.logger.log(`✅ Created ${createdAddresses.length} addresses`);
      return createdAddresses;
    } catch (error: any) {
      this.logger.error(`Error inserting addresses: ${error.message}`);
      this.logger.error(`Address data was: ${JSON.stringify(addresses, null, 2)}`);
      throw error;
    }
  }

  private async seedPaymentMethods(users: any[]) {
    this.logger.log('Seeding payment methods...');

    // Dynamically import PaymentMethod schema only - avoid importing the pre-registered model
    const paymentMethodModule = await import('../../models/PaymentMethod.model');
    const PaymentMethodSchema = paymentMethodModule.PaymentMethodSchema;

    // Register PaymentMethod model using schema directly
    const paymentMethodModel = this.connection.model('PaymentMethod', PaymentMethodSchema);

    const customer1 = users.find(u => u.email === 'customer1@dayam.in');

    if (!customer1) {
      this.logger.warn('Customer user not found, skipping payment method seeding');
      this.logger.log(`Available users: ${users.map(u => u.email).join(', ')}`);
      return [];
    }

    const user1Id = customer1._id || customer1.id;

    this.logger.log(`Found customer1: ${customer1.email} with ID: ${user1Id} (type: ${typeof user1Id})`);

    if (!user1Id) {
      this.logger.error(`Missing user ID for customer1`);
      throw new Error('User ID is missing');
    }

    const paymentMethods = [
      {
        user: user1Id,
        type: 'card',
        cardHolderName: 'Customer One',
        last4: '4242',
        brand: 'visa',
        expiryMonth: '12',
        expiryYear: '2025',
        isDefault: true,
      },
    ];

    // Log the exact data being sent
    this.logger.log(`Preparing to insert ${paymentMethods.length} payment methods`);
    paymentMethods.forEach((pm, index) => {
      this.logger.log(`Payment method ${index + 1}: user=${pm.user}, type=${pm.type}, userType=${typeof pm.user}`);
    });

    // Validate before insert
    const invalidPaymentMethods = paymentMethods.filter(pm => !pm.user || !pm.type);
    if (invalidPaymentMethods.length > 0) {
      this.logger.error(`Found ${invalidPaymentMethods.length} invalid payment methods`);
      invalidPaymentMethods.forEach((pm, index) => {
        this.logger.error(`Invalid payment method ${index + 1}: user=${pm.user}, type=${pm.type}`);
      });
      throw new Error('Payment method data is invalid: missing required fields');
    }

    try {
      const createdPaymentMethods = await paymentMethodModel.insertMany(paymentMethods, {
        ordered: false,
        rawResult: false
      });
      this.logger.log(`✅ Created ${createdPaymentMethods.length} payment methods`);
      return createdPaymentMethods;
    } catch (error: any) {
      this.logger.error(`Error inserting payment methods: ${error.message}`);
      this.logger.error(`Payment method data was: ${JSON.stringify(paymentMethods, null, 2)}`);
      throw error;
    }
  }

  private async seedCoupons() {
    this.logger.log('Seeding coupons...');

    // Dynamically import Coupon schema only - avoid importing the pre-registered model
    const couponModule = await import('../../models/Coupon.model');
    const CouponSchema = couponModule.CouponSchema;

    // Register Coupon model using schema directly
    const couponModel = this.connection.model('Coupon', CouponSchema);

    const coupons = [
      {
        code: 'WELCOME10',
        type: 'percentage',
        value: 10,
        minPurchase: 50,
        maxDiscount: 20,
        validFrom: new Date(),
        validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
        usageLimit: 1000,
        usedCount: 0,
        status: 'active',
      },
      {
        code: 'HONEY20',
        type: 'percentage',
        value: 20,
        minPurchase: 100,
        maxDiscount: 50,
        validFrom: new Date(),
        validUntil: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000), // 6 months
        usageLimit: 500,
        usedCount: 0,
        status: 'active',
      },
      {
        code: 'FLAT15',
        type: 'fixed',
        value: 15,
        minPurchase: 75,
        validFrom: new Date(),
        validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 3 months
        usageLimit: 200,
        usedCount: 0,
        status: 'active',
      },
    ];

    const createdCoupons = await couponModel.insertMany(coupons);
    this.logger.log(`✅ Created ${createdCoupons.length} coupons`);
    return createdCoupons;
  }

  private async seedCarts(users: any[], products: any[]) {
    this.logger.log('Seeding carts...');

    // Dynamically import Cart schema only - avoid importing the pre-registered model
    const cartModule = await import('../../models/Cart.model');
    const CartSchema = cartModule.CartSchema;

    // Register Cart model using schema directly
    const cartModel = this.connection.model('Cart', CartSchema);

    const customer1 = users.find(u => u.email === 'customer1@dayam.in');

    const carts = [
      {
        user: customer1._id,
        items: [
          {
            product: products[0]._id,
            quantity: 2,
          },
          {
            product: products[1]._id,
            quantity: 1,
          },
        ],
        couponCode: 'WELCOME10',
        couponDiscount: 5,
      },
    ];

    const createdCarts = await cartModel.insertMany(carts);
    this.logger.log(`✅ Created ${createdCarts.length} carts`);
    return createdCarts;
  }

  private async seedOrders(users: any[], products: any[], addresses: any[] = []) {
    this.logger.log('Seeding orders...');

    // Dynamically import Order schema only - avoid importing the pre-registered model
    const orderModule = await import('../../models/Order.model');
    const OrderSchema = orderModule.OrderSchema;

    // Register Order model using schema directly
    const orderModel = this.connection.model('Order', OrderSchema);

    const customer1 = users.find(u => u.email === 'customer1@dayam.in');
    const customer2 = users.find(u => u.email === 'customer2@dayam.in');

    // Get address IDs - use first address for customer1, second for customer2
    const address1 = addresses && addresses.length > 0 ? addresses[0]._id : null;
    const address2 = addresses && addresses.length > 1 ? addresses[1]._id : null;

    if (!address1 || !address2) {
      this.logger.warn('Addresses not found, creating orders without shipping addresses');
    }

    // Snapshot each line item the way the real order-create path does: seller +
    // commission split derived from the product, and totals computed from the
    // actual line-item prices (the old hardcoded $ figures contradicted the INR
    // item prices in the same document). Order settings mirror seedSettings.
    const COMMISSION_RATE = 0.10; // platform.commissionRate
    const TAX_RATE = 0.18;        // order.taxRate
    const SHIPPING_FLAT = 99;     // order.shippingFlat
    const FREE_SHIP_ABOVE = 499;  // order.freeShippingAbove
    const round2 = (n: number) => Math.round(n * 100) / 100;

    const buildItem = (product: any, quantity: number) => {
      const lineTotal = (product.price ?? 0) * quantity;
      const commissionAmount = round2(lineTotal * COMMISSION_RATE);
      return {
        product: product._id,
        name: product.name,
        quantity,
        price: product.price,
        image: product.images?.[0],
        seller: product.seller,                 // ownership snapshot
        commissionRate: COMMISSION_RATE,
        commissionAmount,
        sellerEarning: round2(lineTotal - commissionAmount),
      };
    };

    const buildOrder = (base: any, items: any[]) => {
      const subtotal = round2(items.reduce((s, it) => s + it.price * it.quantity, 0));
      const tax = round2(subtotal * TAX_RATE);
      const shipping = subtotal >= FREE_SHIP_ABOVE ? 0 : SHIPPING_FLAT;
      const discount = 0;
      const total = round2(subtotal + tax + shipping - discount);
      return { ...base, items, subtotal, tax, shipping, discount, total };
    };

    const orders = [
      buildOrder(
        {
          orderNumber: 'ORD-001',
          customer: customer1._id,
          shippingAddress: address1 || customer1._id,
          paymentMethod: 'razorpay',
          paymentStatus: 'paid',
          status: 'delivered',
          trackingNumber: 'TRACK123456',
          carrier: 'UPS',
        },
        [buildItem(products[0], 2), buildItem(products[2], 1)],
      ),
      buildOrder(
        {
          orderNumber: 'ORD-002',
          customer: customer2._id,
          shippingAddress: address2 || customer2._id,
          paymentMethod: 'paypal',
          paymentStatus: 'paid',
          status: 'processing',
          trackingNumber: 'TRACK789012',
          carrier: 'FedEx',
        },
        [buildItem(products[1], 1)],
      ),
    ];

    const createdOrders = await orderModel.insertMany(orders);
    this.logger.log(`✅ Created ${createdOrders.length} orders`);
    return createdOrders;
  }

  private async seedReviews(users: any[], products: any[]) {
    this.logger.log('Seeding reviews...');

    // Dynamically import Review schema only - avoid importing the pre-registered model
    const reviewModule = await import('../../models/Review.model');
    const ReviewSchema = reviewModule.ReviewSchema;

    // Register Review model using schema directly
    const reviewModel = this.connection.model('Review', ReviewSchema);

    const customer1 = users.find(u => u.email === 'customer1@dayam.in');
    const customer2 = users.find(u => u.email === 'customer2@dayam.in');

    // Only products in a DELIVERED order for that customer can be verified
    // purchases. Per seedOrders: ORD-001 (customer1, DELIVERED) contains
    // products[0] + products[2]; ORD-002 (customer2, PROCESSING) contains
    // products[1] (NOT delivered → not a verified purchase). Reviews are written
    // product-agnostic (no stale honey copy) and only set verifiedPurchase where
    // the delivered-order invariant actually holds.
    const reviews = [
      {
        product: products[0]._id,
        user: customer1._id,
        rating: 5,
        comment: 'Excellent product! Arrived well-packaged and exactly as described. Highly recommend.',
        verifiedPurchase: true, // customer1 received products[0] in delivered ORD-001
        helpful: 12,
        status: 'approved',
      },
      {
        product: products[2]._id,
        user: customer1._id,
        rating: 4,
        comment: 'Good value for the price and the quality holds up. Would buy again.',
        verifiedPurchase: true, // customer1 received products[2] in delivered ORD-001
        helpful: 5,
        status: 'approved',
      },
      {
        product: products[1]._id,
        user: customer2._id,
        rating: 5,
        comment: 'Exactly what I was looking for — fast delivery and great quality.',
        verifiedPurchase: false, // products[1] is in ORD-002 which is only 'processing'
        helpful: 8,
        status: 'approved',
      },
    ];

    const createdReviews = await reviewModel.insertMany(reviews);

    // insertMany does NOT fire ReviewSchema.post('save'), so the denormalised
    // product.rating / numReviews would stay at the hardcoded seedProducts
    // values and disagree with the real review docs. Recompute them from the
    // actual approved reviews so the catalogue numbers match reality, and zero
    // out products that have no reviews (instead of fictional 312-count cards).
    const ProductModule = await import('../../models/Product.model');
    // Product is already registered earlier in the seed run — reuse it to avoid
    // Mongoose's OverwriteModelError from re-registering the same model name.
    const productModel = this.connection.models.Product
      || this.connection.model('Product', ProductModule.ProductSchema);
    const agg = await reviewModel.aggregate([
      { $match: { status: 'approved' } },
      { $group: { _id: '$product', avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);
    const byProduct = new Map(agg.map((a: any) => [String(a._id), a]));
    await Promise.all(products.map((p: any) => {
      const stats = byProduct.get(String(p._id));
      return productModel.updateOne(
        { _id: p._id },
        {
          $set: {
            rating: stats ? Math.round(stats.avg * 10) / 10 : 0,
            numReviews: stats ? stats.count : 0,
          },
        },
      );
    }));

    this.logger.log(`✅ Created ${createdReviews.length} reviews + recomputed product ratings`);
    return createdReviews;
  }

  private async seedCMS(users: any[]) {
    this.logger.log('Seeding CMS content...');

    const editor = users.find(u => u.email === 'editor@dayam.in');

    // Dynamically import BlogCategory schema only - avoid importing the pre-registered model
    const blogCategoryModule = await import('../../models/BlogCategory.model');
    const BlogCategorySchema = blogCategoryModule.BlogCategorySchema;

    // Register BlogCategory model using schema directly
    const blogCategoryModel = this.connection.model('BlogCategory', BlogCategorySchema);

    // Blog Categories
    const blogCategories = await blogCategoryModel.insertMany([
      {
        name: 'Shopping Tips',
        slug: 'shopping-tips',
        description: 'Smart tips to help you shop better and save more',
      },
      {
        name: 'Tech Reviews',
        slug: 'tech-reviews',
        description: 'In-depth reviews of the latest electronics and gadgets',
      },
      {
        name: 'Fashion & Style',
        slug: 'fashion-style',
        description: 'Style guides, trends and fashion advice',
      },
      {
        name: 'Health & Wellness',
        slug: 'health-wellness',
        description: 'Tips on healthy living, nutrition and fitness',
      },
      {
        name: 'Seller Guide',
        slug: 'seller-guide',
        description: 'Resources and guides for sellers on Dayam',
      },
    ]);

    // Dynamically import models to avoid global registration during module initialization
    const pageModule = await import('../../models/Page.model');
    const blogModule = await import('../../models/Blog.model');
    const PageSchema = pageModule.PageSchema;
    const BlogSchema = blogModule.BlogSchema;

    // Register models using schema directly
    const pageModel = this.connection.model('Page', PageSchema);
    const blogModel = this.connection.model('Blog', BlogSchema);

    // Pages
    await pageModel.insertMany([
      {
        title: 'About Us',
        slug: 'about-us',
        content: '<h1>About Dayam</h1><p>Dayam is India\'s next-generation multi-seller marketplace connecting millions of buyers with verified sellers across every category — from electronics and fashion to groceries and home decor.</p><p>We believe commerce should be fair, fast, and trustworthy. Every seller on Dayam is KYC-verified, every product is reviewed, and every transaction is protected by our buyer guarantee.</p>',
        status: 'published',
        metaTitle: 'About Dayam - India\'s Trusted Marketplace',
        metaDescription: 'Learn about Dayam — connecting buyers with verified sellers across India.',
        author: editor._id,
      },
      {
        title: 'Privacy Policy',
        slug: 'privacy-policy',
        content: '<h1>Privacy Policy</h1><p>At Dayam, your privacy is our priority. We collect only the data necessary to provide our services and never sell your personal information to third parties.</p><p>Data we collect: name, email, phone number, shipping addresses, and order history. All payment data is handled by Stripe and never stored on our servers.</p>',
        status: 'published',
        metaTitle: 'Privacy Policy - Dayam',
        metaDescription: 'Read Dayam\'s privacy policy to understand how we handle your data.',
        author: editor._id,
      },
      {
        title: 'Terms of Service',
        slug: 'terms-of-service',
        content: '<h1>Terms of Service</h1><p>By using Dayam, you agree to these terms. Our platform connects buyers with independent sellers. Dayam is not responsible for the quality of third-party seller products beyond our verification process.</p><p>Buyers are protected by our 10-day return policy on eligible items. Sellers must comply with our seller guidelines and maintain minimum ratings.</p>',
        status: 'published',
        metaTitle: 'Terms of Service - Dayam',
        metaDescription: 'Read Dayam\'s terms of service.',
        author: editor._id,
      },
      {
        title: 'Shipping Policy',
        slug: 'shipping-policy',
        content: '<h1>Shipping Policy</h1><p>Standard delivery: 3-7 business days. Express delivery: 1-2 days (available in select cities). Free shipping on orders above ₹499. Real-time tracking on all orders.</p>',
        status: 'published',
        metaTitle: 'Shipping Policy - Dayam',
        metaDescription: 'Learn about Dayam\'s shipping and delivery policy.',
        author: editor._id,
      },
    ]);

    // Blog Posts
    await blogModel.insertMany([
      {
        title: '10 Tips to Find the Best Deals on Dayam',
        slug: '10-tips-find-best-deals-honeycom',
        excerpt: 'Smart shopping strategies to save more on every order — from using coupons to timing your purchases.',
        content: '<h1>10 Tips to Find the Best Deals on Dayam</h1><p>Shopping smart starts with knowing where to look and when to buy. Here are 10 proven strategies to get the most value on Dayam.</p><h2>1. Check Deals of the Day</h2><p>Our homepage features time-limited deals with up to 40% off. Check every morning for new offers.</p><h2>2. Use Coupon Codes</h2><p>New users get 10% off with code WELCOME10. Check your profile for personalized coupons.</p><h2>3. Set Price Alerts</h2><p>Add items to your wishlist and we\'ll notify you when prices drop.</p>',
        featuredImage: 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=800',
        category: blogCategories[0]._id,
        author: editor._id,
        tags: ['shopping', 'deals', 'savings', 'coupons'],
        status: 'published',
        publishedAt: new Date(),
      },
      {
        title: 'Samsung Galaxy S24 Ultra vs iPhone 15 Pro: Which Should You Buy?',
        slug: 'samsung-s24-ultra-vs-iphone-15-pro',
        excerpt: 'A detailed comparison of 2024\'s two flagship smartphones to help you make the right choice.',
        content: '<h1>Samsung Galaxy S24 Ultra vs iPhone 15 Pro</h1><p>Both are exceptional smartphones, but they excel in different areas. Here\'s our in-depth comparison.</p><h2>Display</h2><p>The S24 Ultra wins with its larger 6.8-inch LTPO AMOLED display. The iPhone 15 Pro has a slightly smaller but incredibly sharp Super Retina XDR display.</p><h2>Camera</h2><p>S24 Ultra leads with 200MP main sensor. iPhone 15 Pro delivers more natural colors and better video stabilization.</p><h2>Performance</h2><p>Both are blazing fast. The A17 Pro in iPhone is marginally faster in single-core tasks; Snapdragon 8 Gen 3 excels in gaming and multi-core workloads.</p><h2>Verdict</h2><p>Choose iPhone 15 Pro for ecosystem integration and video quality. Choose S24 Ultra for camera versatility and Android flexibility.</p>',
        featuredImage: 'https://images.unsplash.com/photo-1510557880182-3d4d3cba35a5?w=800',
        category: blogCategories[1]._id,
        author: editor._id,
        tags: ['samsung', 'iphone', 'smartphone', 'review', 'comparison'],
        status: 'published',
        publishedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
      {
        title: 'Monsoon Fashion 2025: Top Trends to Shop Now',
        slug: 'monsoon-fashion-2025-top-trends',
        excerpt: 'Stay stylish this monsoon with our curated guide to the season\'s must-have fashion pieces.',
        content: '<h1>Monsoon Fashion 2025: Top Trends</h1><p>The monsoon season calls for fashion that is both practical and stylish. Here are the trends dominating 2025.</p><h2>1. Pastel Kurtas</h2><p>Lightweight cotton kurtas in pastel shades are perfect for humid weather. Shop Biba, W, and Fabindia collections on Dayam.</p><h2>2. Waterproof Sneakers</h2><p>Rain-ready footwear has gone fashionable. Nike and Adidas both have excellent waterproof options.</p><h2>3. Linen Co-ords</h2><p>Breathable linen co-ord sets in earthy tones are trending across all age groups this season.</p>',
        featuredImage: 'https://images.unsplash.com/photo-1445205170230-053b83016050?w=800',
        category: blogCategories[2]._id,
        author: editor._id,
        tags: ['fashion', 'monsoon', 'style', 'trends', '2025'],
        status: 'published',
        publishedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      },
      {
        title: 'How to Become a Verified Seller on Dayam',
        slug: 'how-to-become-verified-seller-honeycom',
        excerpt: 'Step-by-step guide for businesses and entrepreneurs to start selling on Dayam and reach millions of buyers.',
        content: '<h1>How to Become a Verified Seller on Dayam</h1><p>Joining Dayam as a seller gives you access to millions of active shoppers across India. Here\'s how to get started.</p><h2>Step 1: Register</h2><p>Visit /seller/register and fill in your business details — business name, GSTIN, and bank account for payouts.</p><h2>Step 2: KYC Verification</h2><p>Upload your PAN card, Aadhaar/passport, and business proof. Our team reviews and approves within 24-48 hours.</p><h2>Step 3: List Your Products</h2><p>Use our seller dashboard to add products with images, descriptions, pricing, and inventory. Products go live after admin approval.</p><h2>Step 4: Start Selling</h2><p>Receive orders, process them via your dashboard, and get paid within 7 days of delivery confirmation.</p>',
        featuredImage: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=800',
        category: blogCategories[4]._id,
        author: editor._id,
        tags: ['seller', 'guide', 'ecommerce', 'business', 'honeycom'],
        status: 'published',
        publishedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      },
      {
        title: 'Best Home Gym Equipment Under ₹5000 in 2025',
        slug: 'best-home-gym-equipment-under-5000-2025',
        excerpt: 'Build an effective home workout setup without breaking the bank. Our top picks under ₹5000.',
        content: '<h1>Best Home Gym Equipment Under ₹5000</h1><p>You don\'t need an expensive gym membership to stay fit. Here are the best home gym investments under ₹5000.</p><h2>1. Adjustable Dumbbell Set (₹3499)</h2><p>Boldfit adjustable dumbbells replace a full rack of weights and are perfect for beginners and intermediate lifters.</p><h2>2. Resistance Bands Set (₹799)</h2><p>Versatile bands for full-body workouts. Great for warm-ups, stretching, and strength training.</p><h2>3. Yoga Mat (₹599)</h2><p>A 6mm non-slip yoga mat is essential for floor exercises, yoga, and stretching.</p><h2>4. Jump Rope (₹299)</h2><p>One of the best cardio tools available. 10 minutes of jumping rope equals 30 minutes of jogging.</p>',
        featuredImage: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800',
        category: blogCategories[3]._id,
        author: editor._id,
        tags: ['fitness', 'home-gym', 'sports', 'health', 'equipment'],
        status: 'published',
        publishedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      },
    ]);

    // Dynamically import Media schema only - avoid importing the pre-registered model
    const mediaModule = await import('../../models/Media.model');
    const MediaSchema = mediaModule.MediaSchema;

    // Register Media model using schema directly
    const mediaModel = this.connection.model('Media', MediaSchema);

    // Media
    await mediaModel.insertMany([
      {
        fileName: 'honey-banner.jpg',
        fileUrl: 'https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=1200',
        fileType: 'image',
        mimeType: 'image/jpeg',
        fileSize: 245000,
        uploadedBy: editor._id,
      },
      {
        fileName: 'product-showcase.jpg',
        fileUrl: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=1200',
        fileType: 'image',
        mimeType: 'image/jpeg',
        fileSize: 189000,
        uploadedBy: editor._id,
      },
    ]);

    // Dynamically import Menu schema only - avoid importing the pre-registered model
    const menuModule = await import('../../models/Menu.model');
    const MenuSchema = menuModule.MenuSchema;

    // Register Menu model using schema directly
    const menuModel = this.connection.model('Menu', MenuSchema);

    // Menus. The storefront reads its navigation EXCLUSIVELY from these CMS
    // menus (no settings fallback), so the header + categories menus must be
    // seeded with real data. These mirror the canonical nav defaults.
    await menuModel.insertMany([
      {
        // Top nav links (storefront header bar). highlight flags the emphasized link.
        name: 'Header Navigation',
        location: 'header',
        items: [
          { label: 'Deals', url: '/products?sort=discount', type: 'custom', highlight: true, order: 1 },
          { label: 'New Arrivals', url: '/products?sort=newest', type: 'custom', order: 2 },
          { label: 'Best Sellers', url: '/products?sort=popular', type: 'custom', order: 3 },
          { label: 'Electronics', url: '/products?category=electronics', type: 'category', order: 4 },
        ],
      },
      {
        // Mega-menu categories (storefront "All Categories" dropdown).
        // Each item carries emoji + slug + sub-category labels.
        name: 'Mega Menu Categories',
        location: 'categories',
        items: [
          { label: 'Electronics', url: '/products?category=electronics', type: 'category', emoji: '📱', slug: 'electronics', sub: ['Smartphones', 'Laptops', 'Audio', 'Cameras', 'Accessories'], order: 1 },
          { label: 'Fashion', url: '/products?category=fashion', type: 'category', emoji: '👗', slug: 'fashion', sub: ["Men's Clothing", "Women's Clothing", 'Footwear', 'Accessories', 'Kids'], order: 2 },
          { label: 'Home & Kitchen', url: '/products?category=home-kitchen', type: 'category', emoji: '🏠', slug: 'home-kitchen', sub: ['Appliances', 'Cookware', 'Furniture', 'Decor', 'Storage'], order: 3 },
          { label: 'Beauty', url: '/products?category=beauty', type: 'category', emoji: '💄', slug: 'beauty', sub: ['Skincare', 'Haircare', 'Makeup', 'Fragrances', 'Personal Care'], order: 4 },
          { label: 'Sports', url: '/products?category=sports', type: 'category', emoji: '🏋️', slug: 'sports', sub: ['Gym Equipment', 'Sportswear', 'Outdoor Gear', 'Cycles', 'Yoga'], order: 5 },
          { label: 'Grocery', url: '/products?category=grocery', type: 'category', emoji: '🛒', slug: 'grocery', sub: ['Staples', 'Snacks', 'Beverages', 'Health Foods', 'Organic'], order: 6 },
        ],
      },
      {
        name: 'Footer Menu',
        location: 'footer',
        items: [
          { label: 'Privacy Policy', url: '/privacy-policy', order: 1 },
          { label: 'Terms of Service', url: '/terms-of-service', order: 2 },
          { label: 'Contact', url: '/contact', order: 3 },
        ],
      },
    ]);

    // Dynamically import Form schema only - avoid importing the pre-registered model
    const formModule = await import('../../models/Form.model');
    const FormSchema = formModule.FormSchema;

    // Register Form model using schema directly
    const formModel = this.connection.model('Form', FormSchema);

    // Forms
    await formModel.insertMany([
      {
        name: 'Contact Form',
        slug: 'contact-form',
        fields: [
          {
            name: 'name',
            label: 'Name',
            type: 'text',
            required: true,
            order: 1,
          },
          {
            name: 'email',
            label: 'Email',
            type: 'email',
            required: true,
            order: 2,
          },
          {
            name: 'message',
            label: 'Message',
            type: 'textarea',
            required: true,
            order: 3,
          },
        ],
        submitButtonText: 'Send Message',
        successMessage: 'Thank you for your message!',
        isActive: true,
      },
    ]);

    this.logger.log('✅ Created CMS content (pages, blog posts, media, menus, forms)');
  }

  private async seedBanners() {
    this.logger.log('Seeding banners...');
    const bannerModule = await import('../../models/Banner.model');
    const bannerModel = this.connection.model('Banner', bannerModule.BannerSchema);
    await bannerModel.insertMany([
      {
        title: 'Mega Sale — Up to 50% Off',
        description: 'Shop the biggest sale of the year across all categories.',
        image: 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=1200&q=80',
        link: '/products?sort=discount',
        position: 'top',
        status: 'active',
        order: 1,
      },
      {
        title: 'New Arrivals — Fashion 2026',
        description: 'Discover the latest trends from verified fashion sellers.',
        image: 'https://images.unsplash.com/photo-1445205170230-053b83016050?w=1200&q=80',
        link: '/products?category=fashion&sort=newest',
        position: 'top',
        status: 'active',
        order: 2,
      },
      {
        title: 'Electronics Bonanza',
        description: 'Samsung, Apple, OnePlus — top brands, best prices.',
        image: 'https://images.unsplash.com/photo-1498049794561-7780e7231661?w=1200&q=80',
        link: '/products?category=electronics',
        position: 'top',
        status: 'active',
        order: 3,
      },
      {
        title: 'Home & Kitchen Deals',
        description: 'Upgrade your home with top-rated appliances and decor.',
        image: 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=1200&q=80',
        link: '/products?category=home-kitchen',
        position: 'middle',
        status: 'active',
        order: 1,
      },
    ]);
    this.logger.log('✅ Created 4 banners');
  }

  private async seedBrands() {
    this.logger.log('Seeding brands...');
    const brandModule = await import('../../models/Brand.model');
    const brandModel = this.connection.model('Brand', brandModule.BrandSchema);
    await brandModel.insertMany([
      { name: 'Samsung', slug: 'samsung', description: 'Global leader in consumer electronics and smartphones.', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/24/Samsung_Logo.svg/200px-Samsung_Logo.svg.png', website: 'https://samsung.com', status: 'active' },
      { name: 'Apple', slug: 'apple', description: 'Premium consumer electronics, software and services.', logo: 'https://upload.wikimedia.org/wikipedia/commons/f/fa/Apple_logo_black.svg', website: 'https://apple.com', status: 'active' },
      { name: 'Nike', slug: 'nike', description: 'World\'s leading athletic footwear and apparel brand.', logo: 'https://upload.wikimedia.org/wikipedia/commons/a/a6/Logo_NIKE.svg', website: 'https://nike.com', status: 'active' },
      { name: "Levi's", slug: 'levis', description: 'Iconic American denim brand since 1853.', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Levi%27s_Logo.svg/200px-Levi%27s_Logo.svg.png', website: 'https://levi.com', status: 'active' },
      { name: 'Philips', slug: 'philips', description: 'Leading health tech and consumer electronics brand.', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/52/Philips_logo_new.svg/200px-Philips_logo_new.svg.png', website: 'https://philips.com', status: 'active' },
      { name: 'Himalaya', slug: 'himalaya', description: 'India\'s trusted herbal wellness and skincare brand.', logo: '', website: 'https://himalayawellness.in', status: 'active' },
      { name: 'OnePlus', slug: 'oneplus', description: 'Premium Android smartphones and accessories.', logo: '', website: 'https://oneplus.com', status: 'active' },
      { name: 'Bosch', slug: 'bosch', description: 'German engineering leader in home appliances and tools.', logo: '', website: 'https://bosch.com', status: 'active' },
    ]);
    this.logger.log('✅ Created 8 brands');
  }

  private async seedWidgets() {
    this.logger.log('Seeding widgets...');
    const widgetModule = await import('../../models/Widget.model');
    const widgetModel = this.connection.model('Widget', widgetModule.WidgetSchema);
    await widgetModel.insertMany([
      {
        name: 'Homepage Announcement',
        type: 'html',
        content: '<div style="background:#F97316;color:#fff;padding:10px;text-align:center;font-weight:600;">🚚 Free delivery on orders above ₹499 | ✅ 500+ Verified Sellers | 🛡️ Buyer Protection</div>',
        location: 'header',
        isActive: true,
      },
      {
        name: 'Trust Badges Sidebar',
        type: 'html',
        content: '<ul><li>✅ 100% Authentic Products</li><li>🔒 Secure Payments</li><li>↩️ Easy Returns</li><li>🚚 Fast Delivery</li></ul>',
        location: 'product-sidebar',
        isActive: true,
      },
      {
        name: 'Newsletter Signup Footer',
        type: 'text',
        content: 'Subscribe to get exclusive deals and new arrivals straight to your inbox. No spam, ever.',
        location: 'footer',
        isActive: true,
      },
      {
        name: 'Checkout Trust Strip',
        type: 'html',
        content: '<div style="display:flex;gap:16px;padding:12px;background:#f9fafb;border-radius:8px;"><span>🔒 SSL Secured</span><span>💳 Multiple Payment Options</span><span>🛡️ Buyer Protection</span></div>',
        location: 'checkout-sidebar',
        isActive: true,
      },
    ]);
    this.logger.log('✅ Created 4 widgets');
  }

  private async seedDisputes(users: any[], products: any[]) {
    this.logger.log('Seeding disputes...');
    const disputeModule = await import('../../models/Dispute.model');
    const disputeModel = this.connection.model('Dispute', disputeModule.DisputeSchema);

    const customer1 = users.find(u => u.email === 'customer1@dayam.in');
    const customer2 = users.find(u => u.email === 'customer2@dayam.in');
    const seller = users.find(u => u.email === 'seller@dayam.in');

    if (!customer1 || !customer2 || !seller) {
      this.logger.warn('Skipping disputes — required users not found');
      return;
    }

    // Each dispute must reference an order that ACTUALLY belongs to its
    // customer, and its seller must come from that order's line items (not a
    // hardcoded seller). Pairing a dispute.customer with another customer's
    // order is a cross-entity orphan / auth-confusion leak.
    const orderModule = await import('../../models/Order.model');
    const orderModel = this.connection.model('Order', orderModule.OrderSchema);
    const order1 = await orderModel.findOne({ customer: customer1._id });
    const order2 = await orderModel.findOne({ customer: customer2._id });
    if (!order1) {
      this.logger.warn('Skipping disputes — no order found for customer1');
      return;
    }
    // Derive the disputed seller from the order's own line items.
    const sellerOf = (o: any) => (o?.items?.[0]?.seller) ?? seller._id;

    const disputes: any[] = [
      {
        order: order1._id,
        customer: customer1._id,
        seller: sellerOf(order1),
        type: 'quality',
        reason: 'Product quality issue',
        description: 'The product received is different from what was shown in the listing. The color is completely different and the build quality is poor.',
        status: 'open',
        attachments: [],
      },
      {
        order: order1._id,
        customer: customer1._id,
        seller: sellerOf(order1),
        type: 'refund',
        reason: 'Item not as described',
        description: 'Requested a refund but seller has not responded in 5 days.',
        status: 'resolved',
        resolution: 'refund',
        resolutionNotes: 'Full refund processed. Customer has been notified.',
        resolvedBy: users.find(u => u.role === 'admin')?._id,
        resolvedAt: new Date(),
        attachments: [],
      },
    ];

    // Only add customer2's dispute if customer2 actually has an order.
    if (order2) {
      disputes.push({
        order: order2._id,
        customer: customer2._id,
        seller: sellerOf(order2),
        type: 'delivery',
        reason: 'Late delivery',
        description: 'Order was supposed to arrive within 3 days but it has been 10 days. No tracking update since the order was shipped.',
        status: 'in_review',
        attachments: [],
      });
    }

    await disputeModel.insertMany(disputes);
    this.logger.log(`✅ Created ${disputes.length} disputes`);
  }

  private async seedSettings() {
    this.logger.log('Seeding platform settings...');
    const db = this.userModel.db;
    const settingsCollection = db.collection('settings');

    await settingsCollection.deleteMany({});

    const now = new Date();
    const settings = [
      // ── Branding ────────────────────────────────────────────────────────────
      { key: 'branding.siteName', value: 'Dayam', category: 'branding', description: 'Marketplace display name in header, emails, page titles.' },
      { key: 'branding.tagline', value: "India's Trusted Multi-Seller Marketplace", category: 'branding', description: 'Short tagline in footer and emails.' },
      { key: 'branding.logoEmoji', value: '🛒', category: 'branding', description: 'Logo emoji beside brand name.' },
      { key: 'branding.supportEmail', value: 'support@dayam.in', category: 'branding', description: 'Support email in footer and emails.' },
      { key: 'branding.supportPhone', value: '+91 98765 43210', category: 'branding', description: 'Support phone in footer.' },
      { key: 'branding.address', value: '4th Floor, Tech Park, Sector 18, Gurugram, Haryana – 122001', category: 'branding', description: 'Company address.' },
      { key: 'branding.primaryColor', value: '#F97316', category: 'branding', description: 'Primary accent color (hex).' },
      { key: 'branding.currency', value: 'INR', category: 'branding', description: 'Default currency code.' },
      // Social links
      { key: 'branding.socialFacebook', value: 'https://facebook.com/dayam', category: 'branding', description: 'Facebook page URL.' },
      { key: 'branding.socialTwitter', value: 'https://twitter.com/dayam', category: 'branding', description: 'Twitter/X profile URL.' },
      { key: 'branding.socialInstagram', value: 'https://instagram.com/dayam', category: 'branding', description: 'Instagram profile URL.' },
      { key: 'branding.socialYoutube', value: 'https://youtube.com/@dayam', category: 'branding', description: 'YouTube channel URL.' },
      { key: 'branding.socialWhatsapp', value: 'https://wa.me/919876543210', category: 'branding', description: 'WhatsApp chat link.' },

      // ── Platform / Monetisation ───────────────────────────────────────────
      { key: 'platform.commissionRate', value: 0.10, category: 'platform', description: 'Platform commission on seller revenue (decimal). 0.10 = 10%. Snapshotted on each order line item at creation time.' },

      // ── Orders ────────────────────────────────────────────────────────────
      { key: 'order.taxRate', value: 0.18, category: 'orders', description: 'Tax rate (decimal). 0.18 = 18% GST.' },
      { key: 'order.shippingFlat', value: 99, category: 'orders', description: 'Flat shipping fee in INR.' },
      { key: 'order.freeShippingAbove', value: 499, category: 'orders', description: 'Order subtotal above which shipping is free.' },
      { key: 'order.returnWindowDays', value: 30, category: 'orders', description: 'Number of days after delivery within which returns are accepted.' },

      // ── Storefront — general ──────────────────────────────────────────────
      { key: 'storefront.announcementBar', value: '🚚 Free delivery above ₹499 | ✅ 500+ Verified Sellers | 🛡️ Buyer Protection | 💳 EMI available', category: 'storefront', description: 'Ticker bar text. Pipe | separates items.' },
      { key: 'storefront.heroSlogan', value: 'Shop Everything. Trust Everyone.', category: 'storefront', description: 'Hero section slogan.' },
      { key: 'storefront.featuredCount', value: 8, category: 'storefront', description: 'Products shown in Deals of the Day.' },
      { key: 'storefront.defaultDeliveryCity', value: 'Mumbai', category: 'storefront', description: 'Default city shown in "Deliver to" header.' },
      { key: 'storefront.defaultDeliveryPin', value: '400001', category: 'storefront', description: 'Default PIN code shown in header.' },
      { key: 'storefront.searchPlaceholder', value: 'Search for phones, fashion, groceries…', category: 'storefront', description: 'Search bar placeholder.' },
      { key: 'storefront.trendingSearches', value: 'Samsung Galaxy S24, Nike Air Max, Minimalist Serum, Levi\'s Jeans', category: 'storefront', description: 'Comma-separated trending search terms in search dropdown.' },

      // ── Storefront — homepage ─────────────────────────────────────────────
      { key: 'storefront.promoBanner1Title', value: 'Flash Sale', category: 'storefront', description: 'Left promo banner title.' },
      { key: 'storefront.promoBanner1Sub', value: 'Up to 40% Off', category: 'storefront', description: 'Left promo banner subtitle.' },
      { key: 'storefront.promoBanner1Badge', value: 'Limited Time', category: 'storefront', description: 'Left promo banner badge text.' },
      { key: 'storefront.promoBanner1Link', value: '/products?sort=discount', category: 'storefront', description: 'Left promo banner click URL.' },
      { key: 'storefront.promoBanner1Emoji', value: '🛍️', category: 'storefront', description: 'Left promo banner emoji.' },
      { key: 'storefront.promoBanner1Color', value: 'from-orange-500 via-amber-500 to-yellow-400', category: 'storefront', description: 'Left banner Tailwind gradient classes.' },
      { key: 'storefront.promoBanner2Title', value: 'Trending Fashion Picks', category: 'storefront', description: 'Right promo banner title.' },
      { key: 'storefront.promoBanner2Sub', value: 'New Collection', category: 'storefront', description: 'Right promo banner badge.' },
      { key: 'storefront.promoBanner2Badge', value: 'New Collection', category: 'storefront', description: 'Right promo banner badge text.' },
      { key: 'storefront.promoBanner2Link', value: '/products?category=fashion', category: 'storefront', description: 'Right promo banner click URL.' },
      { key: 'storefront.promoBanner2Emoji', value: '👗', category: 'storefront', description: 'Right promo banner emoji.' },
      { key: 'storefront.promoBanner2Color', value: 'from-purple-600 via-violet-500 to-indigo-500', category: 'storefront', description: 'Right banner Tailwind gradient classes.' },

      // Mid-page feature banner
      { key: 'storefront.midBannerTitle', value: 'Latest Smartphones & Laptops', category: 'storefront', description: 'Mid-page dark banner title.' },
      { key: 'storefront.midBannerSubtitle', value: 'Up to 40% Off', category: 'storefront', description: 'Mid-page banner highlighted subtitle.' },
      { key: 'storefront.midBannerDesc', value: 'Samsung, Apple, OnePlus, Dell and more — top brands at the best prices, delivered in 2 days.', category: 'storefront', description: 'Mid-page banner description.' },
      { key: 'storefront.midBannerLink', value: '/products?category=electronics', category: 'storefront', description: 'Mid-page banner click URL.' },
      { key: 'storefront.midBannerEmoji', value: '📱', category: 'storefront', description: 'Mid-page banner emoji.' },
      { key: 'storefront.midBannerCta', value: 'Shop Now', category: 'storefront', description: 'Mid-page banner CTA button text.' },
      { key: 'storefront.midBannerNote', value: 'Free delivery on all orders above ₹499', category: 'storefront', description: 'Mid-page banner small note.' },

      // Testimonials (JSON array)
      {
        key: 'storefront.testimonials', value: JSON.stringify([
          { name: 'Priya Sharma', location: 'Mumbai', rating: 5, avatar: '👩', text: 'Got my Samsung S24 in 2 days! Packaging was perfect and product is 100% genuine.' },
          { name: 'Rajesh Kumar', location: 'Bangalore', rating: 5, avatar: '👨', text: 'Great selection and fast delivery. The Levi\'s jeans fit perfectly. Will shop again!' },
          { name: 'Anita Patel', location: 'Delhi', rating: 5, avatar: '👩‍🦱', text: 'Minimalist serum arrived quickly and is 100% authentic. Customer support was helpful.' },
          { name: 'Vikram Singh', location: 'Pune', rating: 5, avatar: '🧔', text: 'Best prices for Nike shoes. Easy checkout, fast shipping, hassle-free returns.' },
        ]), category: 'storefront', description: 'Homepage customer reviews. JSON array of {name, location, rating, avatar, text}.'
      },

      // Homepage stats bar
      {
        key: 'storefront.stats', value: JSON.stringify([
          { value: '10K+', label: 'Products', emoji: '📦' },
          { value: '500+', label: 'Sellers', emoji: '🏪' },
          { value: '4.9★', label: 'Avg Rating', emoji: '⭐' },
          { value: '50K+', label: 'Customers', emoji: '🤝' },
        ]), category: 'storefront', description: 'Homepage stats bar. JSON array of {value, label, emoji}.'
      },

      // Newsletter
      { key: 'storefront.newsletterTitle', value: 'Stay in the Loop', category: 'storefront', description: 'Newsletter section heading.' },
      { key: 'storefront.newsletterSubtitle', value: 'Subscribe for exclusive deals, new arrivals, and tips. No spam, ever.', category: 'storefront', description: 'Newsletter section subtitle.' },
      { key: 'storefront.newsletterCta', value: 'Subscribe Free', category: 'storefront', description: 'Newsletter subscribe button text.' },
      { key: 'storefront.newsletterNote', value: 'Join 50,000+ happy shoppers. Unsubscribe anytime.', category: 'storefront', description: 'Small note below newsletter form.' },
      { key: 'storefront.newsletterPlaceholder', value: 'Enter your email', category: 'storefront', description: 'Newsletter email input placeholder.' },

      // About page stats
      {
        key: 'storefront.aboutStats', value: JSON.stringify([
          { label: 'Products Listed', value: '10,000+' },
          { label: 'Verified Sellers', value: '500+' },
          { label: 'Happy Customers', value: '50,000+' },
          { label: 'Cities Served', value: '200+' },
        ]), category: 'storefront', description: 'About page statistics strip. JSON array of {label, value}.'
      },

      // Footer links
      {
        key: 'storefront.footerShopLinks', value: JSON.stringify([
          { label: 'All Products', href: '/products' },
          { label: 'Electronics', href: '/products?category=electronics' },
          { label: 'Fashion', href: '/products?category=fashion' },
          { label: 'Home & Kitchen', href: '/products?category=home-kitchen' },
          { label: 'Deals & Offers', href: '/products?sort=discount' },
          { label: 'New Arrivals', href: '/products?sort=newest' },
        ]), category: 'storefront', description: 'Footer "Shop" column links. JSON array of {label, href}.'
      },

      {
        key: 'storefront.footerHelpLinks', value: JSON.stringify([
          { label: 'Track My Order', href: '/orders' },
          { label: 'Returns & Refunds', href: '/returns' },
          { label: 'Shipping Info', href: '/shipping' },
          { label: 'FAQ', href: '/faq' },
          { label: 'Contact Us', href: '/contact' },
          { label: 'Sell on Dayam', href: '/seller/register' },
        ]), category: 'storefront', description: 'Footer "Help" column links. JSON array of {label, href}.'
      },

      // Trust features
      {
        key: 'storefront.trustFeatures', value: JSON.stringify([
          { icon: 'Truck', title: 'Free Delivery', desc: 'On orders above ₹499 across India' },
          { icon: 'ShieldCheck', title: '100% Authentic', desc: 'Verified sellers, genuine products' },
          { icon: 'RefreshCw', title: 'Easy Returns', desc: '10-day hassle-free return policy' },
          { icon: 'Award', title: 'Secure Payments', desc: 'UPI, cards, COD & EMI options' },
        ]), category: 'storefront', description: 'Trust feature strip on homepage. JSON array of {icon, title, desc}. Icons: Truck, ShieldCheck, RefreshCw, Award.'
      },

      { key: 'storefront.heroCarouselInterval', value: 4500, category: 'storefront', description: 'Hero carousel auto-rotation interval in ms.' },

      // ── Navigation ─────────────────────────────────────────────────────────
      {
        key: 'navigation.categories', value: JSON.stringify([
          { label: 'Electronics', slug: 'electronics', emoji: '📱', sub: ['Smartphones', 'Laptops', 'Audio', 'Cameras', 'Accessories'] },
          { label: 'Fashion', slug: 'fashion', emoji: '👗', sub: ["Men's Clothing", "Women's Clothing", 'Footwear', 'Accessories', 'Kids'] },
          { label: 'Home & Kitchen', slug: 'home-kitchen', emoji: '🏠', sub: ['Appliances', 'Cookware', 'Furniture', 'Decor', 'Storage'] },
          { label: 'Beauty', slug: 'beauty', emoji: '💄', sub: ['Skincare', 'Haircare', 'Makeup', 'Fragrances', 'Personal Care'] },
          { label: 'Sports', slug: 'sports', emoji: '🏋️', sub: ['Gym Equipment', 'Sportswear', 'Outdoor Gear', 'Cycles', 'Yoga'] },
          { label: 'Grocery', slug: 'grocery', emoji: '🛒', sub: ['Staples', 'Snacks', 'Beverages', 'Health Foods', 'Organic'] },
        ]), category: 'navigation', description: 'Header mega-menu categories. JSON array of {label, slug, emoji, sub[]}.'
      },
      {
        key: 'navigation.navLinks', value: JSON.stringify([
          { label: 'Deals', href: '/products?sort=discount', highlight: true },
          { label: 'New Arrivals', href: '/products?sort=newest' },
          { label: 'Best Sellers', href: '/products?sort=popular' },
          { label: 'Electronics', href: '/products?category=electronics' },
        ]), category: 'navigation', description: 'Top navigation bar links. JSON array of {label, href, highlight?}.'
      },

      // ── Footer ─────────────────────────────────────────────────────────────
      {
        key: 'footer.paymentMethods', value: JSON.stringify([
          { label: 'Visa', emoji: '💳' }, { label: 'Mastercard', emoji: '💳' },
          { label: 'UPI', emoji: '📱' }, { label: 'Net Banking', emoji: '🏦' },
          { label: 'COD', emoji: '💵' }, { label: 'EMI', emoji: '📋' },
        ]), category: 'footer', description: 'Accepted payment methods shown in footer. JSON array of {label, emoji}.'
      },
      {
        key: 'footer.trustBadges', value: JSON.stringify([
          { icon: 'Truck', title: 'Free Delivery', sub: 'On orders above ₹499' },
          { icon: 'RefreshCw', title: 'Easy Returns', sub: 'On eligible items' },
          { icon: 'ShieldCheck', title: 'Secure Payment', sub: '100% encrypted checkout' },
          { icon: 'Award', title: 'Verified Sellers', sub: 'KYC checked & trusted' },
        ]), category: 'footer', description: 'Trust strip above footer links. JSON array of {icon, title, sub}.'
      },
      {
        key: 'footer.shopLinks', value: JSON.stringify([
          { label: 'All Products', href: '/products' }, { label: 'Electronics', href: '/products?category=electronics' },
          { label: 'Fashion', href: '/products?category=fashion' }, { label: 'Home & Kitchen', href: '/products?category=home-kitchen' },
          { label: 'Deals & Offers', href: '/products?sort=discount' }, { label: 'New Arrivals', href: '/products?sort=newest' },
        ]), category: 'footer', description: 'Footer "Shop" column links. JSON array of {label, href}.'
      },
      {
        key: 'footer.helpLinks', value: JSON.stringify([
          { label: 'Track My Order', href: '/orders' }, { label: 'Returns & Refunds', href: '/returns' },
          { label: 'Shipping Info', href: '/shipping' }, { label: 'FAQ', href: '/faq' },
          { label: 'Contact Us', href: '/contact' }, { label: 'Sell on Dayam', href: '/seller/register' },
        ]), category: 'footer', description: 'Footer "Help" column links. JSON array of {label, href}.'
      },
      { key: 'footer.securityText', value: 'SSL Secured • PCI DSS Compliant', category: 'footer', description: 'Security badge text in footer bottom bar.' },
      { key: 'footer.appDownloadText', value: 'Download our app', category: 'footer', description: 'App download section heading in footer.' },

      // ── Support / Contact ──────────────────────────────────────────────────
      {
        key: 'support.faqs', value: JSON.stringify([
          { q: 'How long does delivery take?', a: 'Standard delivery takes 3–7 business days. Express delivery (1–2 days) is available in select cities.' },
          { q: 'What is the return policy?', a: 'We offer a 10-day hassle-free return window for most products. Items must be unused and in original packaging.' },
          { q: 'How do I become a seller?', a: 'Register as a seller, complete your KYC, and list your products. Approval typically takes 24–48 hours.' },
          { q: 'Are the products genuine?', a: 'All sellers are KYC-verified. Products from Brand Verified sellers carry an authenticity guarantee.' },
          { q: 'How do I track my order?', a: "Go to Orders → select your order → click Track. You'll see real-time updates." },
          { q: 'What payment methods are accepted?', a: 'We accept all major credit/debit cards, UPI, net banking, and select wallets.' },
        ]), category: 'support', description: 'FAQ accordion on the Contact page. JSON array of {q, a}.'
      },
      { key: 'support.contactSubjects', value: 'Order Question, Product Question, Shipping & Delivery, Returns & Refunds, Seller Support, General Inquiry, Other', category: 'support', description: 'Contact form subject dropdown options (comma-separated).' },
      {
        key: 'support.businessHours', value: JSON.stringify([
          { day: 'Mon–Sat', hours: '9 AM – 7 PM IST' },
          { day: 'Sunday', hours: 'Closed (email only)' },
        ]), category: 'support', description: 'Business hours on the Contact page. JSON array of {day, hours}.'
      },
      { key: 'support.whatsappLink', value: 'https://wa.me/919876543210', category: 'support', description: 'WhatsApp chat link for the Live Chat contact card.' },
      { key: 'support.emergencySupportText', value: 'Emergency support available 24/7 via WhatsApp', category: 'support', description: 'Green note below business hours on the Contact page.' },

      // ── About Page ─────────────────────────────────────────────────────────
      { key: 'about.heroTagline', value: "India's Next-Gen Marketplace", category: 'about', description: 'Large headline on the About page hero.' },
      { key: 'about.mission', value: 'was born from a simple belief — that shopping online should be safe, transparent, and empowering for both buyers and sellers.', category: 'about', description: 'Mission statement paragraph on the About page.' },
      {
        key: 'about.stats', value: JSON.stringify([
          { label: 'Products Listed', value: '10,000+' }, { label: 'Verified Sellers', value: '500+' },
          { label: 'Happy Customers', value: '50,000+' }, { label: 'Cities Served', value: '200+' },
        ]), category: 'about', description: 'Stats strip on the About page. JSON array of {label, value}.'
      },
      {
        key: 'about.values', value: JSON.stringify([
          { title: 'Quality First', desc: 'Every seller is verified and every product reviewed before it reaches your hands.', color: 'from-green-500 to-emerald-500' },
          { title: 'Buyer Protection', desc: 'Full purchase protection, easy returns, and secure payments on every order.', color: 'from-blue-500 to-indigo-500' },
          { title: 'Seller Empowerment', desc: 'We give small businesses and artisans the tools to reach millions of customers.', color: 'from-purple-500 to-pink-500' },
          { title: 'Reliable Delivery', desc: 'Pan-India logistics with real-time tracking and same-day shipping from select sellers.', color: 'from-orange-500 to-amber-500' },
        ]), category: 'about', description: 'Core values cards on the About page. JSON array of {title, desc, color}.'
      },
      {
        key: 'about.whyUs', value: JSON.stringify([
          { title: 'Verified Sellers', desc: 'Every seller undergoes KYC and quality checks before listing.' },
          { title: 'Secure Payments', desc: '256-bit SSL encryption and multiple payment options including UPI, cards, and COD.' },
          { title: 'Fast Shipping', desc: 'Express delivery available in 100+ cities. Track your order live.' },
          { title: '24/7 Support', desc: 'Our support team is available around the clock to help with orders, returns, and more.' },
          { title: 'Easy Returns', desc: '10-day hassle-free return policy on eligible products.' },
          { title: 'Eco Packaging', desc: 'We encourage sellers to use eco-friendly packaging materials.' },
        ]), category: 'about', description: 'Why-us grid on the About page. JSON array of {title, desc}.'
      },

      // ── SEO ────────────────────────────────────────────────────────────────
      { key: 'seo.metaTitle', value: "Dayam — India's Trusted Marketplace", category: 'seo', description: 'Default page <title>.' },
      { key: 'seo.metaDescription', value: 'Shop electronics, fashion, home, beauty and more from 500+ verified sellers. Best prices, fast delivery, easy returns.', category: 'seo', description: 'Default meta description.' },
      { key: 'seo.keywords', value: 'online shopping, marketplace, electronics, fashion, grocery, India', category: 'seo', description: 'Meta keywords (comma-separated).' },

      // ── Products ────────────────────────────────────────────────────────────
      { key: 'products.reviewsEnabled', value: true, category: 'products', description: 'Allow customers to leave product reviews.' },
      { key: 'products.maxImagesPerProduct', value: 8, category: 'products', description: 'Maximum number of images allowed per product listing.' },
      { key: 'products.lowStockThreshold', value: 10, category: 'products', description: 'Show "Low stock" badge when inventory is at or below this number.' },

      // ── Notifications ───────────────────────────────────────────────────────
      { key: 'notifications.orderConfirmationEnabled', value: true, category: 'notifications', description: 'Send email on order placement.' },
      { key: 'notifications.shipmentUpdateEnabled', value: true, category: 'notifications', description: 'Send email when order ships.' },
      { key: 'notifications.promotionalEmailsEnabled', value: true, category: 'notifications', description: 'Allow promotional / newsletter emails.' },
    ].map(s => ({ ...s, createdAt: now, updatedAt: now }));

    await settingsCollection.insertMany(settings);
    this.logger.log(`✅ Created ${settings.length} platform settings`);
  }

  // ── Themes ──────────────────────────────────────────────────────────────
  // Seeds the modern palette library + wires per-role defaults and the
  // user-override permission flags into the settings collection. Runs after
  // seedSettings() so it can append the theme.* config keys keyed by _id.
  private async seedThemes() {
    this.logger.log('Seeding themes...');
    const now = new Date();

    // The themes collection isn't dropped by name in clearDatabase's critical
    // list, but the generic sweep clears it; clear explicitly to be safe.
    const themeModel = this.connection.model('Theme', ThemeSchema);
    await themeModel.deleteMany({});

    const docs = SEED_THEMES.map((t) => ({
      name: t.name,
      description: t.description,
      lightTokens: t.lightTokens,
      darkTokens: t.darkTokens,
      isActive: true,
      isDefault: !!t.isDefault,
      createdAt: now,
      updatedAt: now,
    }));

    const inserted = await themeModel.insertMany(docs);
    this.logger.log(`✅ Created ${inserted.length} themes`);

    // Map theme name → inserted _id so we can build the role-defaults config.
    const idByName = new Map<string, string>();
    inserted.forEach((doc: any) => idByName.set(doc.name, String(doc._id)));

    // First palette flagged roleDefault for each role wins as that role's
    // default (the *-alt palettes are selectable but not the default).
    const pickFirst = (role: string): string | undefined => {
      const seed = SEED_THEMES.find((t) => t.roleDefault === role);
      return seed ? idByName.get(seed.name) : undefined;
    };

    const roleDefaults = {
      customer: pickFirst('customer') ?? '',
      seller: pickFirst('seller') ?? '',
      admin: pickFirst('admin') ?? '',
      contentEditor: pickFirst('contentEditor') ?? '',
    };

    // Everyone may pick their own theme by default; admin can lock per-role
    // or per-user later from the Theme Settings screen.
    const allowOverride = {
      admin: true,
      customer: true,
      seller: true,
      contentEditor: true,
    };

    const settingsCollection = this.userModel.db.collection('settings');
    await settingsCollection.deleteMany({
      key: { $in: ['theme.roleDefaults', 'theme.allowOverride'] },
    });
    await settingsCollection.insertMany([
      { key: 'theme.roleDefaults', value: roleDefaults, category: 'theme', description: 'Default theme _id per role.', createdAt: now, updatedAt: now },
      { key: 'theme.allowOverride', value: allowOverride, category: 'theme', description: 'Whether users of each role may choose their own theme.', createdAt: now, updatedAt: now },
    ]);
    this.logger.log('✅ Wired theme role defaults + override flags');
  }
}

