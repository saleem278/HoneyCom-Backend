import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Product, IProduct } from '../../models/Product.model';
import { Category, ICategory } from '../../models/Category.model';
import { IProductAlert } from '../../models/ProductAlert.model';
import { ISettings } from '../../models/Settings.model';
import { ExchangeRateService } from '../../services/exchange-rate.service';
import { MobileService } from '../mobile/mobile.service';
import { EmailService } from '../../services/email.service';
// SP-01: used by uploadProductImage to stream image buffers to Cloudinary.
import { uploadBufferToCloudinary } from '../../services/fileUpload.service';

@Injectable()
export class ProductsService {
  constructor(
    @InjectModel('Product') private productModel: Model<IProduct>,
    @InjectModel('Category') private categoryModel: Model<ICategory>,
    @InjectModel('ProductAlert') private productAlertModel: Model<IProductAlert>,
    @InjectModel('Settings') private settingsModel: Model<ISettings>,
    private exchangeRateService: ExchangeRateService,
    private mobileService: MobileService,
    private emailService: EmailService,
  ) {}

  /**
   * Escape a user-supplied string so it's safe to embed in a MongoDB $regex.
   * Without this, a search like "(a+)+" causes exponential backtracking (ReDoS).
   */
  private static escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async findAll(query: any, userRole?: string, userId?: string, currency: string = 'INR') {
    try {
      // Clamp page/limit to safe ranges to prevent memory exhaustion attacks.
      const rawPage = parseInt(query.page, 10);
      const rawLimit = parseInt(query.limit, 10);
      const page = (Number.isFinite(rawPage) && rawPage > 0) ? rawPage : 1;
      const limit = (Number.isFinite(rawLimit) && rawLimit > 0) ? Math.min(rawLimit, 100) : 12;
      const skip = (page - 1) * limit;

      const filter: any = {};

      // For regular users (not authenticated or not admin), only show approved products
      // For admin, allow filtering by status or show all if no status specified
      if (userRole === 'admin') {
        if (query.status) {
          filter.status = query.status;
        }
        // Allow admins to scope the list to a single seller (e.g. drilling in
        // from the seller-detail "View products" link). Without this the admin
        // branch silently ignored ?seller and always returned every product.
        if (query.seller && String(query.seller).match(/^[0-9a-fA-F]{24}$/)) {
          filter.seller = query.seller;
        }
        // If no status filter, admin sees all products
      } else if (userRole === 'seller') {
        // Seller always sees their own products, regardless of status
        if (userId) {
          filter.seller = userId;
        }
        // Allow status filter for seller too
        if (query.status) {
          filter.status = query.status;
        }
      } else {
        // Regular users only see approved products
        filter.status = 'approved';
        // Allow browsing a specific seller's storefront
        if (query.seller && String(query.seller).match(/^[0-9a-fA-F]{24}$/)) {
          filter.seller = query.seller;
        }
      }

      if (query.category) {
        // Check if category is a slug or an ID
        // First try to find by slug
        const categoryBySlug = await this.categoryModel.findOne({ slug: query.category });
        if (categoryBySlug) {
          filter.category = categoryBySlug._id;
        } else {
          // If not found by slug, try as ObjectId
          // Check if it's a valid ObjectId format
          if (query.category.match(/^[0-9a-fA-F]{24}$/)) {
            const categoryById = await this.categoryModel.findById(query.category);
            if (categoryById) {
              filter.category = categoryById._id;
            } else {
              // Category not found, return empty results by using impossible ObjectId
              filter.category = new Types.ObjectId('000000000000000000000000');
            }
          } else {
            // Invalid format, return empty results by using impossible ObjectId
            filter.category = new Types.ObjectId('000000000000000000000000');
          }
        }
      }

      if (query.minPrice || query.maxPrice) {
        filter.price = {};
        if (query.minPrice) {
          filter.price.$gte = parseFloat(query.minPrice);
        }
        if (query.maxPrice) {
          filter.price.$lte = parseFloat(query.maxPrice);
        }
      }

      if (query.rating) {
        filter.rating = { $gte: parseFloat(query.rating) };
      }

      // Featured filter — homepage "featured products" rail. Accepts
      // ?featured=true (string from query string).
      if (query.featured === 'true' || query.featured === true) {
        filter.featured = true;
      }

      // Escape user input before embedding in $regex to prevent ReDoS.
      // Malicious patterns like "(a+)+" cause exponential backtracking in MongoDB.
      if (query.search) {
        const safeSearch = ProductsService.escapeRegex(String(query.search).slice(0, 200));
        filter.$or = [
          { name: { $regex: safeSearch, $options: 'i' } },
          { description: { $regex: safeSearch, $options: 'i' } },
        ];
      }

      // Map the public `sort` param to a Mongo sort spec. Defaults to newest.
      // Note: 'popular' approximates by numReviews then rating; 'discount'
      // can't be sorted in Mongo without a computed field, so we sort by
      // rating as a reasonable proxy and rely on the discount badge in the UI.
      const sortMap: Record<string, Record<string, 1 | -1>> = {
        price_asc: { price: 1 },
        price_desc: { price: -1 },
        rating: { rating: -1, numReviews: -1 },
        newest: { createdAt: -1 },
        popular: { numReviews: -1, rating: -1 },
        discount: { rating: -1 },
      };
      const sortSpec = sortMap[query.sort as string] || { createdAt: -1 };

      // Brand filter (by id or slug)
      if (query.brand) {
        if (String(query.brand).match(/^[0-9a-fA-F]{24}$/)) {
          filter.brand = query.brand;
        } else {
          // treat as slug — look up Brand model
          // We do a lazy import to avoid circular deps; brands module is independent
          const BrandModel = this.productModel.db.model('Brand');
          const brandDoc = await BrandModel.findOne({ slug: query.brand }).lean();
          filter.brand = brandDoc ? (brandDoc as any)._id : new Types.ObjectId('000000000000000000000000');
        }
      }

      // Use regular populate but handle errors gracefully
      const products = await this.productModel
        .find(filter)
        .populate({
          path: 'category',
          select: 'name slug',
          strictPopulate: false,
        })
        .populate({
          path: 'brand',
          select: 'name slug logo',
          strictPopulate: false,
        })
        .populate({
          path: 'seller',
          select: 'name email',
          strictPopulate: false,
          // Only populate valid sellers
          match: { name: { $exists: true, $ne: null }, email: { $exists: true, $ne: null } },
        })
        .skip(skip)
        .limit(limit)
        .sort(sortSpec)
        .lean();

      const total = await this.productModel.countDocuments(filter);

      // Convert prices based on currency
      const currencyUpper = (currency || 'INR').toUpperCase() as 'USD' | 'EUR' | 'GBP' | 'INR' | 'CAD' | 'AUD' | 'JPY';
      const baseCurrency = this.exchangeRateService.getBaseCurrency();
      
      // Always convert products (even if same currency, to ensure consistency)
      const convertedProducts = this.convertProductPrices(products, currencyUpper);

      return {
        success: true,
        products: convertedProducts,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
        currency: currencyUpper,
      };
    } catch (error) {
      throw new InternalServerErrorException(error.message || 'Failed to fetch products');
    }
  }

  async findOne(id: string, currency: string = 'INR', userRole?: string, userId?: string) {
    const filter: any = { _id: id };

    if (userRole === 'admin') {
      // Admin can view any product regardless of status
    } else if (userRole === 'seller' && userId) {
      // Sellers can view their own products (any status) and others' approved products
      filter.$or = [{ status: 'approved' }, { seller: userId }];
    } else {
      // Customers and unauthenticated users only see approved products
      filter.status = 'approved';
    }

    const product = await this.productModel
      .findOne(filter)
      .populate({
        path: 'category',
        select: 'name slug',
        strictPopulate: false,
      })
      .populate({
        path: 'brand',
        select: 'name slug logo',
        strictPopulate: false,
      })
      .populate({
        path: 'seller',
        select: 'name email',
        strictPopulate: false,
      })
      .lean();

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    // Convert prices based on currency
    const currencyUpper = (currency || 'INR').toUpperCase() as 'USD' | 'EUR' | 'GBP' | 'INR' | 'CAD' | 'AUD' | 'JPY';
    const convertedProduct = this.convertProductPrice(product, currencyUpper);

    return {
      success: true,
      product: convertedProduct,
      currency: currencyUpper,
    };
  }

  /**
   * Convert product prices based on currency
   */
  private convertProductPrice(product: any, currency: 'USD' | 'EUR' | 'GBP' | 'INR' | 'CAD' | 'AUD' | 'JPY'): any {
    if (!product || typeof product.price !== 'number') {
      return product;
    }
    
    const baseCurrency = this.exchangeRateService.getBaseCurrency();
    
    const originalPrice = product.price;
    let convertedPrice = originalPrice;
    
    if (currency !== baseCurrency) {
      convertedPrice = this.exchangeRateService.convertToCurrency(originalPrice, currency);
    }
    
    // Create new object with converted prices
    const convertedProduct = {
      ...product,
      price: convertedPrice,
    };
    
    if (product.compareAtPrice) {
      convertedProduct.compareAtPrice = currency !== baseCurrency
        ? this.exchangeRateService.convertToCurrency(product.compareAtPrice, currency)
        : product.compareAtPrice;
    }
    
    return convertedProduct;
  }

  /**
   * Convert array of product prices based on currency
   */
  private convertProductPrices(products: any[], currency: 'USD' | 'EUR' | 'GBP' | 'INR' | 'CAD' | 'AUD' | 'JPY'): any[] {
    return products.map(product => this.convertProductPrice(product, currency));
  }

  /**
   * Allowed image URL host suffixes. Only images served from these CDNs
   * are accepted. Prevents SSRF attacks where a seller provides a product
   * image URL pointing at an internal network endpoint (e.g. metadata API,
   * private admin panel) that gets fetched by the browser when admins
   * view the product list.
   */
  private static readonly ALLOWED_IMAGE_HOSTS = [
    'res.cloudinary.com',
    'cloudinary.com',
    'images.unsplash.com',
    'cdn.dayam.in',
  ];

  private validateImageUrls(images: unknown[]): void {
    if (!Array.isArray(images)) return;
    for (const img of images) {
      if (typeof img !== 'string') continue;
      try {
        const { hostname, protocol } = new URL(img);
        if (!['https:', 'http:'].includes(protocol)) {
          throw new BadRequestException(`Image URL must use http/https: ${img}`);
        }
        const allowed = ProductsService.ALLOWED_IMAGE_HOSTS.some(
          (h) => hostname === h || hostname.endsWith(`.${h}`),
        );
        if (!allowed) {
          throw new BadRequestException(
            `Image URL host "${hostname}" is not allowed. Use Cloudinary or an approved CDN.`,
          );
        }
      } catch (e: any) {
        if (e instanceof BadRequestException) throw e;
        throw new BadRequestException(`Invalid image URL: ${img}`);
      }
    }
  }

  // ── SP-01: Real Image Upload ──────────────────────────────────────────────────

  /** Upload a product image buffer to Cloudinary. Returns the CDN URL. */
  async uploadProductImage(file: Express.Multer.File): Promise<{ success: boolean; url: string }> {
    if (!file) throw new BadRequestException('Image file is required');
    if (!file.mimetype.startsWith('image/')) throw new BadRequestException('Only image files are accepted');
    if (file.size > 10 * 1024 * 1024) throw new BadRequestException('Image must be smaller than 10 MB');
    const { url } = await uploadBufferToCloudinary(file.buffer, {
      folder: 'honey-ecommerce/products',
      resourceType: 'image',
    });
    return { success: true, url };
  }

  // ── SP-06: CSV Export ─────────────────────────────────────────────────────────

  /** Export the seller's catalog as a CSV string for download. */
  async exportProductsCsv(sellerId: string): Promise<string> {
    const products = await this.productModel
      .find({ seller: sellerId })
      .populate('category', 'name')
      .sort({ createdAt: -1 })
      .lean();

    const header = 'name,description,sku,price,compareAtPrice,category,inventory,status,tags,images';
    const rows = (products as any[]).map((p) => {
      const esc = (v: unknown) => {
        const s = String(v ?? '').replace(/"/g, '""');
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
      };
      return [
        esc(p.name), esc(p.description), esc(p.sku), esc(p.price),
        esc(p.compareAtPrice ?? ''), esc(p.category?.name ?? ''),
        esc(p.inventory), esc(p.status),
        esc((p.tags ?? []).join(',')), esc((p.images ?? []).join(',')),
      ].join(',');
    });

    return [header, ...rows].join('\n');
  }

  async create(createProductDto: any, sellerId: string) {
    // Validate compareAtPrice is not lower than price (would show a fake discount)
    if (
      createProductDto.compareAtPrice !== undefined &&
      createProductDto.price !== undefined &&
      Number(createProductDto.compareAtPrice) < Number(createProductDto.price)
    ) {
      throw new BadRequestException('compareAtPrice must be greater than or equal to price');
    }

    // Validate image URLs to prevent SSRF attacks
    if (createProductDto.images) {
      this.validateImageUrls(createProductDto.images);
    }

    const product = await this.productModel.create({
      ...createProductDto,
      seller: sellerId,
    });

    await product.populate('category', 'name slug');
    await product.populate('seller', 'name email');

    // Confirm submission to the seller — product is pending admin review. Best-effort.
    const submittedSeller: any = (product as any).seller;
    if (submittedSeller?.email) {
      this.emailService
        .sendProductSubmittedEmail(submittedSeller.email, product.name)
        .catch(() => undefined);
    }

    return {
      success: true,
      product,
    };
  }

  async update(id: string, updateProductDto: any, userId: string, userRole: string) {
    const product = await this.productModel.findById(id);
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    // Check if user owns the product or is admin
    if (userRole !== 'admin' && product.seller.toString() !== userId) {
      throw new BadRequestException('Not authorized to update this product');
    }

    // SECURITY: Whitelist only safe product fields. Block Mass Assignment.
    // Sellers must not be able to mark their products as 'approved' automatically,
    // change the product's seller ID, or override reviews/ratings fields.
    let allowedFields = [
      'name', 'description', 'sku', 'price', 'compareAtPrice',
      'category', 'images', 'inventory', 'variants', 'weight',
      'dimensions', 'featured', 'tags', 'specifications', 'qna',
    ];

    // SP-08: sellers may request status changes (approved↔inactive).
    if (userRole === 'seller') {
      allowedFields = [...allowedFields, 'status'];
    }

    // Admins can also update status and rejection fields
    if (userRole === 'admin') {
      allowedFields = [...allowedFields, 'status', 'rejectionReason', 'seller', 'rating', 'numReviews'];
    }

    const filteredUpdateData: any = {};
    for (const key of Object.keys(updateProductDto)) {
      if (allowedFields.includes(key)) {
        filteredUpdateData[key] = updateProductDto[key];
      }
    }

    // SP-08: enforce controlled seller status transitions.
    // Sellers may only transition approved→inactive (pause) or inactive→approved (resume)
    // or rejected→pending (resubmit). They cannot self-approve pending products.
    if (userRole === 'seller' && filteredUpdateData.status !== undefined) {
      const currentStatus = product.status as string;
      const requestedStatus = filteredUpdateData.status as string;
      const sellerAllowedTransitions: Record<string, string[]> = {
        approved: ['inactive'],
        inactive: ['approved'],
        rejected: ['pending'],
      };
      const allowed = sellerAllowedTransitions[currentStatus] ?? [];
      if (!allowed.includes(requestedStatus)) {
        // Strip the disallowed status change — don't throw; other fields still save.
        delete filteredUpdateData.status;
      } else if (currentStatus === 'rejected' && requestedStatus === 'pending') {
        // SP-12: clear the stale rejection note when the seller resubmits.
        filteredUpdateData.rejectionReason = '';
      }
    }

    // SP-12: editing a rejected product without explicitly setting status
    // auto-transitions it to 'pending' so it re-enters admin review.
    if (
      userRole === 'seller' &&
      filteredUpdateData.status === undefined &&
      (product.status as string) === 'rejected'
    ) {
      filteredUpdateData.status = 'pending';
      filteredUpdateData.rejectionReason = '';
    }

    // Validate image URLs before persisting to prevent SSRF
    if (filteredUpdateData.images) {
      this.validateImageUrls(filteredUpdateData.images);
    }

    const oldPrice = product.price;
    const oldInventory = product.inventory;

    const updatedProduct = await this.productModel.findByIdAndUpdate(
      id,
      filteredUpdateData,
      { new: true, runValidators: true }
    ).populate('category', 'name slug').populate('seller', 'name email');

    // Fire alert notifications asynchronously — don't block the response.
    if (updatedProduct) {
      const newPrice = updatedProduct.price;
      const newInventory = updatedProduct.inventory;
      if (newPrice < oldPrice) {
        this.triggerPriceDropAlerts(id, oldPrice, newPrice, updatedProduct.name).catch(() => {});
      }
      if (oldInventory === 0 && newInventory > 0) {
        this.triggerBackInStockAlerts(id, updatedProduct.name).catch(() => {});
      }
    }

    return {
      success: true,
      product: updatedProduct,
    };
  }

  async bulkUpload(file: Express.Multer.File, sellerId: string) {
    if (!file) {
      throw new BadRequestException('CSV file is required');
    }

    const csv = require('csv-parser');
    const fs = require('fs');
    const path = require('path');
    const results: any[] = [];

    return new Promise((resolve, reject) => {
      const filePath = file.path;
      const stream = fs.createReadStream(filePath);

      stream
        .pipe(csv())
        .on('data', (data: any) => results.push(data))
        .on('end', async () => {
          try {
            // Batch-fetch all categories once to avoid N+1 queries in the loop.
            // For each unique category name in the CSV, look it up in one pass.
            const uniqueCategoryNames: string[] = [
              ...new Set(
                results
                  .map((r: any) => r.category)
                  .filter(Boolean)
                  .map((c: string) => c.trim())
              ),
            ];
            const allCategories = uniqueCategoryNames.length > 0
              ? await this.categoryModel
                  .find({
                    $or: uniqueCategoryNames.flatMap((name) => [
                      { name: new RegExp(`^${ProductsService.escapeRegex(name)}$`, 'i') },
                      { slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') },
                    ]),
                  })
                  .select('_id name slug')
                  .lean()
              : [];
            // Build an O(1) lookup: normalized name → category _id
            const categoryMap = new Map<string, any>();
            for (const cat of allCategories) {
              categoryMap.set(cat.name.toLowerCase(), cat._id);
              categoryMap.set(cat.slug, cat._id);
            }

            // SP-06: UPSERT by SKU — batch-check existing SKUs and fetch their
            // owner so we can update seller-owned rows instead of rejecting them.
            const allRowSkus = results
              .map((r: any) => {
                const rawSku = r.sku || r.SKU;
                return rawSku ? rawSku.toUpperCase() : null;
              })
              .filter(Boolean) as string[];
            const existingSkuDocs = allRowSkus.length
              ? await this.productModel
                  .find({ sku: { $in: allRowSkus } })
                  .select('sku seller')
                  .lean()
              : [];
            // Map: normalized SKU → { owned: boolean, _id }
            const existingSkuMap = new Map<string, { owned: boolean; _id: any }>();
            for (const doc of existingSkuDocs as any[]) {
              existingSkuMap.set(doc.sku as string, {
                owned: String(doc.seller) === String(sellerId),
                _id: doc._id,
              });
            }

            const toInsert: any[] = [];
            const toUpdate: Array<{ _id: any; data: any }> = [];
            const errors: string[] = [];

            for (let i = 0; i < results.length; i++) {
              const row = results[i];
              try {
                // Validate required fields
                if (!row.name || !row.price || !row.category) {
                  errors.push(`Row ${i + 2}: Missing required fields (name, price, category)`);
                  continue;
                }

                // Resolve category from the pre-fetched map (no extra DB query)
                let categoryId = null;
                if (row.category) {
                  const nameKey = String(row.category).trim().toLowerCase();
                  const slugKey = nameKey.replace(/[^a-z0-9]+/g, '-');
                  categoryId = categoryMap.get(nameKey) ?? categoryMap.get(slugKey) ?? null;
                  if (!categoryId) {
                    errors.push(`Row ${i + 2}: Category "${row.category}" not found`);
                    continue;
                  }
                }

                // Generate SKU if not provided
                let sku = row.sku || row.SKU;
                if (!sku) {
                  const skuPrefix = row.name.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, '');
                  sku = `${skuPrefix}-${Date.now()}-${i}`;
                }
                const skuUpper = sku.toUpperCase();

                const parsedPrice = parseFloat(row.price);
                if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
                  errors.push(`Row ${i + 2}: Invalid price "${row.price}"`);
                  continue;
                }
                const parsedCompareAt = row.compareAtPrice ? parseFloat(row.compareAtPrice) : undefined;
                if (parsedCompareAt !== undefined && (!Number.isFinite(parsedCompareAt) || parsedCompareAt < parsedPrice)) {
                  errors.push(`Row ${i + 2}: compareAtPrice must be a valid number >= price`);
                  continue;
                }

                const parsedInventory = parseInt(row.inventory || row.stock || '0') || 0;
                const parsedImages = row.images
                  ? row.images.split(',').map((img: string) => img.trim()).filter(Boolean)
                  : [];
                const parsedTags = row.tags
                  ? row.tags.split(',').map((tag: string) => tag.trim()).filter(Boolean)
                  : [];

                // SP-06: UPSERT — if SKU already exists and this seller owns it, update
                const existing = existingSkuMap.get(skuUpper);
                if (existing) {
                  if (!existing.owned) {
                    errors.push(`Row ${i + 2}: SKU "${skuUpper}" belongs to another seller`);
                    continue;
                  }
                  // Update mutable fields; never touch status/seller/rating
                  const updateData: any = {
                    name: row.name,
                    price: parsedPrice,
                    inventory: parsedInventory,
                    category: categoryId,
                  };
                  if (row.description) updateData.description = row.description;
                  if (parsedCompareAt !== undefined) updateData.compareAtPrice = parsedCompareAt;
                  if (parsedImages.length > 0) updateData.images = parsedImages;
                  if (parsedTags.length > 0) updateData.tags = parsedTags;
                  toUpdate.push({ _id: existing._id, data: updateData });
                } else {
                  toInsert.push({
                    name: row.name,
                    description: row.description || row.name,
                    sku: skuUpper,
                    price: parsedPrice,
                    compareAtPrice: parsedCompareAt,
                    category: categoryId,
                    seller: sellerId,
                    inventory: parsedInventory,
                    images: parsedImages,
                    status: 'pending',
                    featured: row.featured === 'true' || row.featured === '1',
                    tags: parsedTags,
                  });
                }
              } catch (error: any) {
                errors.push(`Row ${i + 2}: ${error.message}`);
              }
            }

            // Insert new products in bulk
            let createdCount = 0;
            if (toInsert.length > 0) {
              const created = await this.productModel.insertMany(toInsert);
              createdCount = created.length;
            }

            // Update existing products in parallel (bounded by batch size)
            let updatedCount = 0;
            if (toUpdate.length > 0) {
              await Promise.all(
                toUpdate.map(({ _id, data }) =>
                  this.productModel.findByIdAndUpdate(_id, data, { runValidators: false }),
                ),
              );
              updatedCount = toUpdate.length;
            }

            // Clean up uploaded file
            try {
              fs.unlinkSync(filePath);
            } catch (error) {
              // Error deleting temp file
            }

            resolve({
              success: true,
              message: `Created ${createdCount}, updated ${updatedCount} product(s)`,
              created: createdCount,
              updated: updatedCount,
              errors: errors.length > 0 ? errors : undefined,
              totalRows: results.length,
            });
          } catch (error: any) {
            reject(new BadRequestException(`Bulk upload failed: ${error.message}`));
          }
        })
        .on('error', (error: any) => {
          reject(new BadRequestException(`CSV parsing failed: ${error.message}`));
        });
    });
  }

  async updateInventory(id: string, inventory: number, userId: string, userRole: string) {
    const product = await this.productModel.findById(id);
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    // Check if user owns the product or is admin
    if (userRole !== 'admin' && product.seller.toString() !== userId) {
      throw new BadRequestException('Not authorized to update this product');
    }

    if (inventory < 0) {
      throw new BadRequestException('Inventory cannot be negative');
    }

    const oldInventory = product.inventory;
    product.inventory = inventory;
    await product.save();

    if (oldInventory === 0 && inventory > 0) {
      this.triggerBackInStockAlerts(id, product.name).catch(() => {});
    }

    return {
      success: true,
      product,
    };
  }

  async remove(id: string, userId: string, userRole: string) {
    const product = await this.productModel.findById(id);
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    // Check if user owns the product or is admin
    if (userRole !== 'admin' && product.seller.toString() !== userId) {
      throw new BadRequestException('Not authorized to delete this product');
    }

    await this.productModel.findByIdAndDelete(id);

    return {
      success: true,
      message: 'Product deleted successfully',
    };
  }

  // ── Product Q&A ─────────────────────────────────────────────────────────

  async askQuestion(id: string, question: string, customerEmail?: string) {
    const trimmed = question?.trim();
    if (!trimmed) throw new BadRequestException('Question text is required');

    const product = await this.productModel
      .findById(id)
      .populate({ path: 'seller', select: 'name email', strictPopulate: false })
      .lean();
    if (!product) throw new NotFoundException('Product not found');

    // Append the question (unanswered) to the product's qna array
    await this.productModel.findByIdAndUpdate(id, {
      $push: { qna: { q: trimmed, a: '' } },
    });

    // Fire email notification to seller asynchronously — don't block response
    const seller = product.seller as any;
    if (seller?.email) {
      this.emailService.sendProductQuestionEmail({
        sellerEmail: seller.email,
        sellerName: seller.name || 'Seller',
        productName: product.name,
        productId: id,
        question: trimmed,
        customerEmail,
      }).catch(() => {});
    }

    return { success: true, message: 'Your question has been submitted.' };
  }

  // ── Product Alerts ────────────────────────────────────────────────────────

  async subscribeAlert(productId: string, userId: string, type: 'price_drop' | 'back_in_stock', targetPrice?: number) {
    const product = await this.productModel.findById(productId);
    if (!product) throw new NotFoundException('Product not found');

    await this.productAlertModel.findOneAndUpdate(
      { user: userId, product: productId, type },
      { active: true, targetPrice: targetPrice ?? undefined, notifiedAt: undefined },
      { upsert: true, new: true },
    );

    return { success: true, message: 'Alert subscription saved' };
  }

  async unsubscribeAlert(productId: string, userId: string, type: 'price_drop' | 'back_in_stock') {
    await this.productAlertModel.findOneAndDelete({ user: userId, product: productId, type });
    return { success: true, message: 'Alert removed' };
  }

  async getMyAlerts(userId: string) {
    const alerts = await this.productAlertModel
      .find({ user: userId, active: true })
      .populate('product', 'name price images inventory')
      .sort({ createdAt: -1 })
      .limit(100);
    return { success: true, alerts };
  }

  async getAlertStatus(productId: string, userId: string) {
    const alerts = await this.productAlertModel.find({ user: userId, product: productId, active: true });
    return {
      success: true,
      priceDrop: alerts.some(a => a.type === 'price_drop'),
      backInStock: alerts.some(a => a.type === 'back_in_stock'),
    };
  }

  private async triggerPriceDropAlerts(productId: string, oldPrice: number, newPrice: number, productName: string) {
    const alerts = await this.productAlertModel.find({
      product: productId,
      type: 'price_drop',
      active: true,
      $or: [{ targetPrice: { $exists: false } }, { targetPrice: null }, { targetPrice: { $gte: newPrice } }],
    });

    await Promise.all(
      alerts.map(async alert => {
        try {
          await this.mobileService.sendPushNotification(
            alert.user.toString(),
            '💰 Price Drop Alert!',
            `${productName} dropped from ₹${oldPrice.toLocaleString('en-IN')} to ₹${newPrice.toLocaleString('en-IN')}`,
            'promotion',
            { type: 'price_drop', productId },
          );
          await this.productAlertModel.findByIdAndUpdate(alert._id, { notifiedAt: new Date() });
        } catch {}
      }),
    );
  }

  private async triggerBackInStockAlerts(productId: string, productName: string) {
    const alerts = await this.productAlertModel.find({
      product: productId,
      type: 'back_in_stock',
      active: true,
    });

    await Promise.all(
      alerts.map(async alert => {
        try {
          await this.mobileService.sendPushNotification(
            alert.user.toString(),
            '🎉 Back in Stock!',
            `${productName} is now available again. Grab it before it sells out!`,
            'promotion',
            { type: 'back_in_stock', productId },
          );
          await this.productAlertModel.findByIdAndUpdate(alert._id, { active: false, notifiedAt: new Date() });
        } catch {}
      }),
    );
  }
}
