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
    const hashedPassword = await bcrypt.hash('password123', 10);

    const users = [
      {
        name: 'Admin User',
        email: 'admin@honey.com',
        password: hashedPassword,
        role: 'admin',
        status: 'active',
        emailVerified: true,
      },
      {
        name: 'John Seller',
        email: 'seller@honey.com',
        password: hashedPassword,
        role: 'seller',
        status: 'active',
        emailVerified: true,
      },
      {
        name: 'Jane Seller',
        email: 'jane.seller@honey.com',
        password: hashedPassword,
        role: 'seller',
        status: 'active',
        emailVerified: true,
      },
      {
        name: 'Customer One',
        email: 'customer1@honey.com',
        password: hashedPassword,
        role: 'customer',
        status: 'active',
        emailVerified: true,
      },
      {
        name: 'Customer Two',
        email: 'customer2@honey.com',
        password: hashedPassword,
        role: 'customer',
        status: 'active',
        emailVerified: true,
      },
      {
        name: 'Content Editor',
        email: 'editor@honey.com',
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
    
    // Dynamically import Category schema only - avoid importing the pre-registered model
    // This prevents mongoose.model() from executing and triggering validation on other models
    const categoryModule = await import('../../models/Category.model');
    const CategorySchema = categoryModule.CategorySchema;
    
    // Register Category model using schema directly - this prevents validation on other models
    // The model file exports a pre-registered model, but we'll create a new one with just the schema
    const categoryModel = this.connection.model('Category', CategorySchema);

    const categories = [
      {
        name: 'Raw Honey',
        slug: 'raw-honey',
        description: 'Pure, unprocessed honey straight from the hive',
        image: 'https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=500',
        status: 'active',
      },
      {
        name: 'Flavored Honey',
        slug: 'flavored-honey',
        description: 'Honey infused with natural flavors',
        image: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=500',
        status: 'active',
      },
      {
        name: 'Honey Products',
        slug: 'honey-products',
        description: 'Products made with honey',
        image: 'https://images.unsplash.com/photo-1615485925534-4d27d0f8bd2b?w=500',
        status: 'active',
      },
      {
        name: 'Organic Honey',
        slug: 'organic-honey',
        description: 'Certified organic honey from sustainable sources',
        image: 'https://images.unsplash.com/photo-1615485925534-4d27d0f8bd2b?w=500',
        status: 'active',
      },
    ];

    const createdCategories = await categoryModel.insertMany(categories);
    this.logger.log(`✅ Created ${createdCategories.length} categories`);
    return createdCategories;
  }

  private async seedProducts(users: any[], categories: any[]) {
    this.logger.log('Seeding products...');

    // Dynamically import Product schema only - avoid importing the pre-registered model
    // This prevents mongoose.model() from executing and triggering validation on other models
    const productModule = await import('../../models/Product.model');
    const ProductSchema = productModule.ProductSchema;
    
    // Register Product model using schema directly - this prevents validation on other models
    const productModel = this.connection.model('Product', ProductSchema);

    const seller1 = users.find(u => u.email === 'seller@honey.com');
    const seller2 = users.find(u => u.email === 'jane.seller@honey.com');

    const products = [
      {
        name: 'Pure Wildflower Honey',
        description: 'Delicious wildflower honey collected from diverse floral sources. Rich in flavor with a smooth, creamy texture.',
        sku: 'HONEY-001',
        price: 24.99,
        compareAtPrice: 29.99,
        category: categories[0]._id,
        seller: seller1._id,
        images: [
          'https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=500',
          'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=500',
        ],
        inventory: 150,
        status: 'approved',
        rating: 4.5,
        numReviews: 12,
        tags: ['wildflower', 'pure', 'natural'],
      },
      {
        name: 'Organic Acacia Honey',
        description: 'Premium organic acacia honey with a light, delicate flavor. Perfect for tea and desserts.',
        sku: 'HONEY-002',
        price: 29.99,
        compareAtPrice: 34.99,
        category: categories[3]._id,
        seller: seller1._id,
        images: [
          'https://images.unsplash.com/photo-1615485925534-4d27d0f8bd2b?w=500',
        ],
        inventory: 100,
        status: 'approved',
        rating: 4.8,
        numReviews: 25,
        tags: ['organic', 'acacia', 'premium'],
      },
      {
        name: 'Lavender Infused Honey',
        description: 'Aromatic honey infused with natural lavender. Perfect for relaxation and flavor enhancement.',
        sku: 'HONEY-003',
        price: 27.99,
        compareAtPrice: 32.99,
        category: categories[1]._id,
        seller: seller2._id,
        images: [
          'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=500',
        ],
        inventory: 80,
        status: 'approved',
        rating: 4.3,
        numReviews: 8,
        tags: ['lavender', 'flavored', 'aromatic'],
      },
      {
        name: 'Manuka Honey 500+',
        description: 'Premium Manuka honey with 500+ MGO rating. Known for its unique properties and rich flavor.',
        sku: 'HONEY-004',
        price: 49.99,
        compareAtPrice: 59.99,
        category: categories[0]._id,
        seller: seller1._id,
        images: [
          'https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=500',
        ],
        inventory: 50,
        status: 'approved',
        rating: 5.0,
        numReviews: 15,
        tags: ['manuka', 'premium', 'mgo500'],
      },
      {
        name: 'Honey Comb',
        description: 'Natural honeycomb chunks. Eat as is or use to sweeten your favorite dishes.',
        sku: 'HONEY-005',
        price: 34.99,
        compareAtPrice: 39.99,
        category: categories[2]._id,
        seller: seller2._id,
        images: [
          'https://images.unsplash.com/photo-1615485925534-4d27d0f8bd2b?w=500',
        ],
        inventory: 60,
        status: 'approved',
        rating: 4.7,
        numReviews: 10,
        tags: ['honeycomb', 'natural', 'unprocessed'],
      },
      {
        name: 'Buckwheat Honey',
        description: 'Dark, robust buckwheat honey with a strong, distinct flavor. Rich in antioxidants.',
        sku: 'HONEY-006',
        price: 26.99,
        compareAtPrice: 31.99,
        category: categories[0]._id,
        seller: seller1._id,
        images: [
          'https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=500',
        ],
        inventory: 120,
        status: 'approved',
        rating: 4.2,
        numReviews: 7,
        tags: ['buckwheat', 'dark', 'robust'],
      },
      {
        name: 'Honey Soap',
        description: 'Natural soap made with honey. Moisturizing and gentle on the skin.',
        sku: 'HONEY-007',
        price: 12.99,
        compareAtPrice: 15.99,
        category: categories[2]._id,
        seller: seller2._id,
        images: [
          'https://images.unsplash.com/photo-1615485925534-4d27d0f8bd2b?w=500',
        ],
        inventory: 200,
        status: 'approved',
        rating: 4.6,
        numReviews: 18,
        tags: ['soap', 'skincare', 'natural'],
      },
      {
        name: 'Cinnamon Honey',
        description: 'Warm and spicy cinnamon-infused honey. Perfect for toast and baking.',
        sku: 'HONEY-008',
        price: 25.99,
        compareAtPrice: 30.99,
        category: categories[1]._id,
        seller: seller1._id,
        images: [
          'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=500',
        ],
        inventory: 90,
        status: 'approved',
        rating: 4.4,
        numReviews: 11,
        tags: ['cinnamon', 'flavored', 'spiced'],
      },
    ];

    const createdProducts = await productModel.insertMany(products);
    this.logger.log(`✅ Created ${createdProducts.length} products`);
    return createdProducts;
  }

  private async seedAddresses(users: any[]) {
    this.logger.log('Seeding addresses...');

    // Dynamically import Address schema only - avoid importing the pre-registered model
    const addressModule = await import('../../models/Address.model');
    const AddressSchema = addressModule.AddressSchema;
    
    // Register Address model using schema directly
    const addressModel = this.connection.model('Address', AddressSchema);

    const customer1 = users.find(u => u.email === 'customer1@honey.com');
    const customer2 = users.find(u => u.email === 'customer2@honey.com');

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

    const customer1 = users.find(u => u.email === 'customer1@honey.com');

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

    const customer1 = users.find(u => u.email === 'customer1@honey.com');

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

    const customer1 = users.find(u => u.email === 'customer1@honey.com');
    const customer2 = users.find(u => u.email === 'customer2@honey.com');

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

    const customer1 = users.find(u => u.email === 'customer1@honey.com');
    const customer2 = users.find(u => u.email === 'customer2@honey.com');

    const reviews = [
      {
        product: products[0]._id,
        user: customer1._id,
        rating: 5,
        comment: 'Amazing quality! The wildflower honey has such a rich flavor. Highly recommend!',
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

    const editor = users.find(u => u.email === 'editor@honey.com');

        // Dynamically import BlogCategory schema only - avoid importing the pre-registered model
        const blogCategoryModule = await import('../../models/BlogCategory.model');
        const BlogCategorySchema = blogCategoryModule.BlogCategorySchema;
        
        // Register BlogCategory model using schema directly
        const blogCategoryModel = this.connection.model('BlogCategory', BlogCategorySchema);

    // Blog Categories
    const blogCategories = await blogCategoryModel.insertMany([
      {
        name: 'Honey Benefits',
        slug: 'honey-benefits',
        description: 'Learn about the health benefits of honey',
      },
      {
        name: 'Recipes',
        slug: 'recipes',
        description: 'Delicious recipes using honey',
      },
      {
        name: 'Beekeeping',
        slug: 'beekeeping',
        description: 'Tips and guides for beekeeping',
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
        content: '<h1>About Honey Store</h1><p>We are passionate about bringing you the finest quality honey from trusted beekeepers around the world.</p>',
        status: 'published',
        metaTitle: 'About Us - Honey Store',
        metaDescription: 'Learn about our mission to provide the best honey products',
        author: editor._id,
      },
      {
        title: 'Privacy Policy',
        slug: 'privacy-policy',
        content: '<h1>Privacy Policy</h1><p>Your privacy is important to us...</p>',
        status: 'published',
        author: editor._id,
      },
      {
        title: 'Terms of Service',
        slug: 'terms-of-service',
        content: '<h1>Terms of Service</h1><p>Please read these terms carefully...</p>',
        status: 'published',
        author: editor._id,
      },
    ]);

    // Blog Posts
    await blogModel.insertMany([
      {
        title: '10 Amazing Health Benefits of Honey',
        slug: '10-amazing-health-benefits-of-honey',
        excerpt: 'Discover the incredible health benefits that honey has to offer',
        content: '<h1>10 Amazing Health Benefits of Honey</h1><p>Honey has been used for centuries for its medicinal properties...</p>',
        featuredImage: 'https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=800',
        category: blogCategories[0]._id,
        author: editor._id,
        tags: ['health', 'benefits', 'honey'],
        status: 'published',
        publishedAt: new Date(),
      },
      {
        title: 'Honey Glazed Salmon Recipe',
        slug: 'honey-glazed-salmon-recipe',
        excerpt: 'A delicious and easy recipe for honey glazed salmon',
        content: '<h1>Honey Glazed Salmon Recipe</h1><p>This recipe combines the sweetness of honey with the richness of salmon...</p>',
        featuredImage: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=800',
        category: blogCategories[1]._id,
        author: editor._id,
        tags: ['recipe', 'salmon', 'cooking'],
        status: 'published',
        publishedAt: new Date(),
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
}

