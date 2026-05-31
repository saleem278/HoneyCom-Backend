import { Injectable, Logger } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Connection } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User, IUser } from '../../models/User.model';
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
  ) {}

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
      await this.seedSettings();

      this.logger.log('✅ Database seeding completed successfully!');
      return { success: true, message: 'Database seeded successfully' };
    } catch (error) {
      this.logger.error('❌ Error seeding database:', error);
      throw error;
    }
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
      },
      {
        name: 'Priya Fashion Store',
        email: 'jane.seller@dayam.in',
        password: hashedPassword,
        role: 'seller',
        status: 'active',
        emailVerified: true,
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

    const orders = [
      {
        orderNumber: 'ORD-001',
        customer: customer1._id,
        items: [
          {
            product: products[0]._id,
            name: products[0].name,
            quantity: 2,
            price: products[0].price,
            image: products[0].images[0],
          },
          {
            product: products[2]._id,
            name: products[2].name,
            quantity: 1,
            price: products[2].price,
            image: products[2].images[0],
          },
        ],
        shippingAddress: address1 || customer1._id, // Fallback to customer ID if no address
        paymentMethod: 'stripe', // Changed from 'card' to 'stripe'
        paymentStatus: 'paid',
        subtotal: 77.97,
        tax: 7.80,
        shipping: 10,
        discount: 0,
        total: 95.77,
        status: 'delivered',
        trackingNumber: 'TRACK123456',
        carrier: 'UPS',
      },
      {
        orderNumber: 'ORD-002',
        customer: customer2._id,
        items: [
          {
            product: products[1]._id,
            name: products[1].name,
            quantity: 1,
            price: products[1].price,
            image: products[1].images[0],
          },
        ],
        shippingAddress: address2 || customer2._id, // Fallback to customer ID if no address
        paymentMethod: 'paypal',
        paymentStatus: 'paid',
        subtotal: 29.99,
        tax: 3.00,
        shipping: 10,
        discount: 0,
        total: 42.99,
        status: 'processing', // Changed from 'shipped' to 'processing'
        trackingNumber: 'TRACK789012',
        carrier: 'FedEx',
      },
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

    const reviews = [
      {
        product: products[0]._id,
        user: customer1._id,
        rating: 5,
        comment: 'Excellent product! Arrived well-packaged and exactly as described. Highly recommend!',
        verifiedPurchase: true,
        helpful: 12,
        status: 'approved',
      },
      {
        product: products[0]._id,
        user: customer2._id,
        rating: 4,
        comment: 'Good honey, but a bit pricey. Still worth it for the quality.',
        verifiedPurchase: true,
        helpful: 5,
        status: 'approved',
      },
      {
        product: products[1]._id,
        user: customer1._id,
        rating: 5,
        comment: 'The acacia honey is perfect! Light and sweet, exactly as described.',
        verifiedPurchase: true,
        helpful: 8,
        status: 'approved',
      },
      {
        product: products[2]._id,
        user: customer2._id,
        rating: 4,
        comment: 'Lovely lavender flavor. Great for tea!',
        verifiedPurchase: true,
        helpful: 3,
        status: 'approved',
      },
    ];

    const createdReviews = await reviewModel.insertMany(reviews);
    this.logger.log(`✅ Created ${createdReviews.length} reviews`);
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

    // Menus
    await menuModel.insertMany([
      {
        name: 'Main Menu',
        location: 'header',
        items: [
          {
            label: 'Home',
            url: '/',
            order: 1,
          },
          {
            label: 'Products',
            url: '/products',
            order: 2,
          },
          {
            label: 'About',
            url: '/about-us',
            order: 3,
          },
          {
            label: 'Blog',
            url: '/blog',
            order: 4,
          },
        ],
        isActive: true,
      },
      {
        name: 'Footer Menu',
        location: 'footer',
        items: [
          {
            label: 'Privacy Policy',
            url: '/privacy-policy',
            order: 1,
          },
          {
            label: 'Terms of Service',
            url: '/terms-of-service',
            order: 2,
          },
          {
            label: 'Contact',
            url: '/contact',
            order: 3,
          },
        ],
        isActive: true,
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

  private async seedSettings() {
    this.logger.log('Seeding platform settings...');
    const db = this.userModel.db;
    const settingsCollection = db.collection('settings');

    await settingsCollection.deleteMany({});

    const now = new Date();
    const settings = [
      // ── Branding ────────────────────────────────────────────────────────────
      { key: 'branding.siteName',       value: 'Dayam',                             category: 'branding', description: 'Marketplace display name in header, emails, page titles.' },
      { key: 'branding.tagline',        value: "India's Trusted Multi-Seller Marketplace", category: 'branding', description: 'Short tagline in footer and emails.' },
      { key: 'branding.logoEmoji',      value: '🛒',                                category: 'branding', description: 'Logo emoji beside brand name.' },
      { key: 'branding.supportEmail',   value: 'support@dayam.in',                  category: 'branding', description: 'Support email in footer and emails.' },
      { key: 'branding.supportPhone',   value: '+91 98765 43210',                   category: 'branding', description: 'Support phone in footer.' },
      { key: 'branding.address',        value: '4th Floor, Tech Park, Sector 18, Gurugram, Haryana – 122001', category: 'branding', description: 'Company address.' },
      { key: 'branding.primaryColor',   value: '#F97316',                           category: 'branding', description: 'Primary accent color (hex).' },
      // Social links
      { key: 'branding.socialFacebook', value: 'https://facebook.com/dayam',        category: 'branding', description: 'Facebook page URL.' },
      { key: 'branding.socialTwitter',  value: 'https://twitter.com/dayam',         category: 'branding', description: 'Twitter/X profile URL.' },
      { key: 'branding.socialInstagram',value: 'https://instagram.com/dayam',       category: 'branding', description: 'Instagram profile URL.' },
      { key: 'branding.socialYoutube',  value: 'https://youtube.com/@dayam',        category: 'branding', description: 'YouTube channel URL.' },
      { key: 'branding.socialWhatsapp', value: 'https://wa.me/919876543210',        category: 'branding', description: 'WhatsApp chat link.' },

      // ── Orders ────────────────────────────────────────────────────────────
      { key: 'order.taxRate',           value: 0.1,    category: 'orders', description: 'Tax rate (decimal). 0.18 = 18% GST.' },
      { key: 'order.shippingFlat',      value: 99,     category: 'orders', description: 'Flat shipping fee in INR.' },
      { key: 'order.freeShippingAbove', value: 499,    category: 'orders', description: 'Order subtotal above which shipping is free.' },

      // ── Storefront — general ──────────────────────────────────────────────
      { key: 'storefront.announcementBar',    value: '🚚 Free delivery above ₹499 | ✅ 500+ Verified Sellers | 🛡️ Buyer Protection | 💳 EMI available', category: 'storefront', description: 'Ticker bar text. Pipe | separates items.' },
      { key: 'storefront.heroSlogan',         value: 'Shop Everything. Trust Everyone.', category: 'storefront', description: 'Hero section slogan.' },
      { key: 'storefront.featuredCount',      value: 8, category: 'storefront', description: 'Products shown in Deals of the Day.' },
      { key: 'storefront.defaultDeliveryCity',value: 'Mumbai', category: 'storefront', description: 'Default city shown in "Deliver to" header.' },
      { key: 'storefront.defaultDeliveryPin', value: '400001', category: 'storefront', description: 'Default PIN code shown in header.' },
      { key: 'storefront.searchPlaceholder',  value: 'Search for phones, fashion, groceries…', category: 'storefront', description: 'Search bar placeholder.' },
      { key: 'storefront.trendingSearches',   value: 'Samsung Galaxy S24, Nike Air Max, Minimalist Serum, Levi\'s Jeans', category: 'storefront', description: 'Comma-separated trending search terms in search dropdown.' },

      // ── Storefront — homepage ─────────────────────────────────────────────
      { key: 'storefront.promoBanner1Title',  value: 'Flash Sale', category: 'storefront', description: 'Left promo banner title.' },
      { key: 'storefront.promoBanner1Sub',    value: 'Up to 40% Off', category: 'storefront', description: 'Left promo banner subtitle.' },
      { key: 'storefront.promoBanner1Badge',  value: 'Limited Time', category: 'storefront', description: 'Left promo banner badge text.' },
      { key: 'storefront.promoBanner1Link',   value: '/products?sort=discount', category: 'storefront', description: 'Left promo banner click URL.' },
      { key: 'storefront.promoBanner1Emoji',  value: '🛍️', category: 'storefront', description: 'Left promo banner emoji.' },
      { key: 'storefront.promoBanner1Color',  value: 'from-orange-500 via-amber-500 to-yellow-400', category: 'storefront', description: 'Left banner Tailwind gradient classes.' },
      { key: 'storefront.promoBanner2Title',  value: 'Trending Fashion Picks', category: 'storefront', description: 'Right promo banner title.' },
      { key: 'storefront.promoBanner2Sub',    value: 'New Collection', category: 'storefront', description: 'Right promo banner badge.' },
      { key: 'storefront.promoBanner2Badge',  value: 'New Collection', category: 'storefront', description: 'Right promo banner badge text.' },
      { key: 'storefront.promoBanner2Link',   value: '/products?category=fashion', category: 'storefront', description: 'Right promo banner click URL.' },
      { key: 'storefront.promoBanner2Emoji',  value: '👗', category: 'storefront', description: 'Right promo banner emoji.' },
      { key: 'storefront.promoBanner2Color',  value: 'from-purple-600 via-violet-500 to-indigo-500', category: 'storefront', description: 'Right banner Tailwind gradient classes.' },

      // Mid-page feature banner
      { key: 'storefront.midBannerTitle',     value: 'Latest Smartphones & Laptops', category: 'storefront', description: 'Mid-page dark banner title.' },
      { key: 'storefront.midBannerSubtitle',  value: 'Up to 40% Off', category: 'storefront', description: 'Mid-page banner highlighted subtitle.' },
      { key: 'storefront.midBannerDesc',      value: 'Samsung, Apple, OnePlus, Dell and more — top brands at the best prices, delivered in 2 days.', category: 'storefront', description: 'Mid-page banner description.' },
      { key: 'storefront.midBannerLink',      value: '/products?category=electronics', category: 'storefront', description: 'Mid-page banner click URL.' },
      { key: 'storefront.midBannerEmoji',     value: '📱', category: 'storefront', description: 'Mid-page banner emoji.' },
      { key: 'storefront.midBannerCta',       value: 'Shop Now', category: 'storefront', description: 'Mid-page banner CTA button text.' },
      { key: 'storefront.midBannerNote',      value: 'Free delivery on all orders above ₹499', category: 'storefront', description: 'Mid-page banner small note.' },

      // Testimonials (JSON array)
      { key: 'storefront.testimonials', value: JSON.stringify([
          { name: 'Priya Sharma', location: 'Mumbai', rating: 5, avatar: '👩', text: 'Got my Samsung S24 in 2 days! Packaging was perfect and product is 100% genuine.' },
          { name: 'Rajesh Kumar', location: 'Bangalore', rating: 5, avatar: '👨', text: 'Great selection and fast delivery. The Levi\'s jeans fit perfectly. Will shop again!' },
          { name: 'Anita Patel', location: 'Delhi', rating: 5, avatar: '👩‍🦱', text: 'Minimalist serum arrived quickly and is 100% authentic. Customer support was helpful.' },
          { name: 'Vikram Singh', location: 'Pune', rating: 5, avatar: '🧔', text: 'Best prices for Nike shoes. Easy checkout, fast shipping, hassle-free returns.' },
        ]), category: 'storefront', description: 'Homepage customer reviews. JSON array of {name, location, rating, avatar, text}.' },

      // Homepage stats bar
      { key: 'storefront.stats', value: JSON.stringify([
          { value: '10K+', label: 'Products', emoji: '📦' },
          { value: '500+', label: 'Sellers', emoji: '🏪' },
          { value: '4.9★', label: 'Avg Rating', emoji: '⭐' },
          { value: '50K+', label: 'Customers', emoji: '🤝' },
        ]), category: 'storefront', description: 'Homepage stats bar. JSON array of {value, label, emoji}.' },

      // Newsletter
      { key: 'storefront.newsletterTitle',    value: 'Stay in the Loop', category: 'storefront', description: 'Newsletter section heading.' },
      { key: 'storefront.newsletterSubtitle', value: 'Subscribe for exclusive deals, new arrivals, and tips. No spam, ever.', category: 'storefront', description: 'Newsletter section subtitle.' },
      { key: 'storefront.newsletterCta',      value: 'Subscribe Free', category: 'storefront', description: 'Newsletter subscribe button text.' },
      { key: 'storefront.newsletterNote',     value: 'Join 50,000+ happy shoppers. Unsubscribe anytime.', category: 'storefront', description: 'Small note below newsletter form.' },
      { key: 'storefront.newsletterPlaceholder', value: 'Enter your email', category: 'storefront', description: 'Newsletter email input placeholder.' },

      // About page stats
      { key: 'storefront.aboutStats', value: JSON.stringify([
          { label: 'Products Listed', value: '10,000+' },
          { label: 'Verified Sellers', value: '500+' },
          { label: 'Happy Customers', value: '50,000+' },
          { label: 'Cities Served', value: '200+' },
        ]), category: 'storefront', description: 'About page statistics strip. JSON array of {label, value}.' },

      // Footer links
      { key: 'storefront.footerShopLinks', value: JSON.stringify([
          { label: 'All Products', href: '/products' },
          { label: 'Electronics', href: '/products?category=electronics' },
          { label: 'Fashion', href: '/products?category=fashion' },
          { label: 'Home & Kitchen', href: '/products?category=home-kitchen' },
          { label: 'Deals & Offers', href: '/products?sort=discount' },
          { label: 'New Arrivals', href: '/products?sort=newest' },
        ]), category: 'storefront', description: 'Footer "Shop" column links. JSON array of {label, href}.' },

      { key: 'storefront.footerHelpLinks', value: JSON.stringify([
          { label: 'Track My Order', href: '/orders' },
          { label: 'Returns & Refunds', href: '/returns' },
          { label: 'Shipping Info', href: '/shipping' },
          { label: 'FAQ', href: '/faq' },
          { label: 'Contact Us', href: '/contact' },
          { label: 'Sell on Dayam', href: '/seller/register' },
        ]), category: 'storefront', description: 'Footer "Help" column links. JSON array of {label, href}.' },

      // ── SEO ────────────────────────────────────────────────────────────────
      { key: 'seo.metaTitle',       value: "Dayam — India's Trusted Marketplace", category: 'seo', description: 'Default page <title>.' },
      { key: 'seo.metaDescription', value: 'Shop electronics, fashion, home, beauty and more from 500+ verified sellers. Best prices, fast delivery, easy returns.', category: 'seo', description: 'Default meta description.' },
      { key: 'seo.keywords',        value: 'online shopping, marketplace, electronics, fashion, grocery, India', category: 'seo', description: 'Meta keywords (comma-separated).' },
    ].map(s => ({ ...s, createdAt: now, updatedAt: now }));

    await settingsCollection.insertMany(settings);
    this.logger.log(`✅ Created ${settings.length} platform settings`);
  }
}

