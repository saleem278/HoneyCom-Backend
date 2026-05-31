import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Product, IProduct } from '../../models/Product.model';
import { Category, ICategory } from '../../models/Category.model';
import { ExchangeRateService } from '../../services/exchange-rate.service';

@Injectable()
export class ProductsService {
  constructor(
    @InjectModel('Product') private productModel: Model<IProduct>,
    @InjectModel('Category') private categoryModel: Model<ICategory>,
    private exchangeRateService: ExchangeRateService,
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

      // Use regular populate but handle errors gracefully
      const products = await this.productModel
        .find(filter)
        .populate({
          path: 'category',
          select: 'name slug',
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

  async findOne(id: string, currency: string = 'INR') {
    const product = await this.productModel
      .findById(id)
      .populate({
        path: 'category',
        select: 'name slug',
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
      'dimensions', 'featured', 'tags'
    ];
    
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

    // Validate image URLs before persisting to prevent SSRF
    if (filteredUpdateData.images) {
      this.validateImageUrls(filteredUpdateData.images);
    }

    const updatedProduct = await this.productModel.findByIdAndUpdate(
      id,
      filteredUpdateData,
      { new: true, runValidators: true }
    ).populate('category', 'name slug').populate('seller', 'name email');

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
            const products = [];
            const errors: string[] = [];

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

            // Batch-check all existing SKUs once to avoid N+1 (1 query per row).
            const allRowSkus = results
              .map((r: any) => {
                const rawSku = r.sku || r.SKU;
                return rawSku ? rawSku.toUpperCase() : null;
              })
              .filter(Boolean) as string[];
            const existingSkuDocs = allRowSkus.length
              ? await this.productModel.find({ sku: { $in: allRowSkus } }).select('sku').lean()
              : [];
            const existingSkus = new Set(existingSkuDocs.map((p: any) => p.sku));

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

                // Check against pre-fetched set — O(1), no extra DB query per row
                if (existingSkus.has(sku.toUpperCase())) {
                  errors.push(`Row ${i + 2}: SKU "${sku}" already exists`);
                  continue;
                }

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

                const productData = {
                  name: row.name,
                  description: row.description || row.name,
                  sku: sku.toUpperCase(),
                  price: parsedPrice,
                  compareAtPrice: parsedCompareAt,
                  category: categoryId,
                  seller: sellerId,
                  inventory: parseInt(row.inventory || row.stock || '0') || 0,
                  images: row.images ? row.images.split(',').map((img: string) => img.trim()) : [],
                  status: 'pending',
                  featured: row.featured === 'true' || row.featured === '1',
                  tags: row.tags ? row.tags.split(',').map((tag: string) => tag.trim()) : [],
                };

                products.push(productData);
              } catch (error: any) {
                errors.push(`Row ${i + 2}: ${error.message}`);
              }
            }

            // Insert products in bulk
            let createdCount = 0;
            if (products.length > 0) {
              const created = await this.productModel.insertMany(products);
              createdCount = created.length;
            }

            // Clean up uploaded file
            try {
              fs.unlinkSync(filePath);
            } catch (error) {
              // Error deleting temp file
            }

            resolve({
              success: true,
              message: `Successfully uploaded ${createdCount} products`,
              created: createdCount,
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

    product.inventory = inventory;
    await product.save();

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
}

