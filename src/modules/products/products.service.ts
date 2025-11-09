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

  async findAll(query: any, userRole?: string, userId?: string, currency: string = 'INR') {
    try {
      const page = parseInt(query.page) || 1;
      const limit = parseInt(query.limit) || 12;
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

      // Use regex search instead of $text search (which requires text index)
      if (query.search) {
        filter.$or = [
          { name: { $regex: query.search, $options: 'i' } },
          { description: { $regex: query.search, $options: 'i' } },
        ];
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
          path: 'seller',
          select: 'name email',
          strictPopulate: false,
          // Only populate valid sellers
          match: { name: { $exists: true, $ne: null }, email: { $exists: true, $ne: null } },
        })
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
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

  async create(createProductDto: any, sellerId: string) {
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

    const updatedProduct = await this.productModel.findByIdAndUpdate(
      id,
      updateProductDto,
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

            for (let i = 0; i < results.length; i++) {
              const row = results[i];
              try {
                // Validate required fields
                if (!row.name || !row.price || !row.category) {
                  errors.push(`Row ${i + 2}: Missing required fields (name, price, category)`);
                  continue;
                }

                // Find category by name or slug
                let categoryId = null;
                if (row.category) {
                  const category = await this.categoryModel.findOne({
                    $or: [
                      { name: new RegExp(row.category, 'i') },
                      { slug: row.category.toLowerCase().replace(/[^a-z0-9]+/g, '-') },
                    ],
                  });
                  if (category) {
                    categoryId = category._id;
                  } else {
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

                // Check if SKU already exists
                const existingProduct = await this.productModel.findOne({ sku: sku.toUpperCase() });
                if (existingProduct) {
                  errors.push(`Row ${i + 2}: SKU "${sku}" already exists`);
                  continue;
                }

                const productData = {
                  name: row.name,
                  description: row.description || row.name,
                  sku: sku.toUpperCase(),
                  price: parseFloat(row.price) || 0,
                  compareAtPrice: row.compareAtPrice ? parseFloat(row.compareAtPrice) : undefined,
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

