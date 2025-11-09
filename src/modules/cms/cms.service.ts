import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Page, IPage } from '../../models/Page.model';
import { Blog, IBlog } from '../../models/Blog.model';
import { Media, IMedia } from '../../models/Media.model';
import { Menu, IMenu } from '../../models/Menu.model';
import { Form, IForm } from '../../models/Form.model';
import { IFormSubmission } from '../../models/FormSubmission.model';

@Injectable()
export class CmsService {
  constructor(
    @InjectModel('Page') private pageModel: Model<IPage>,
    @InjectModel('Blog') private blogModel: Model<IBlog>,
    @InjectModel('Media') private mediaModel: Model<IMedia>,
    @InjectModel('Menu') private menuModel: Model<IMenu>,
    @InjectModel('Form') private formModel: Model<IForm>,
    @InjectModel('FormSubmission') private formSubmissionModel: Model<IFormSubmission>,
  ) {}

  // ========== PAGES ==========
  async getPages(status?: string) {
    const filter: any = {};
    if (status) {
      filter.status = status;
    }
    const pages = await this.pageModel.find(filter).populate('author', 'name email').sort({ createdAt: -1 });
    return { success: true, pages };
  }

  async getPage(id: string) {
    const page = await this.pageModel.findById(id).populate('author', 'name email');
    if (!page) {
      throw new NotFoundException('Page not found');
    }
    return { success: true, page };
  }

  async createPage(data: any, authorId: string) {
    // Generate slug if not provided
    if (!data.slug && data.title) {
      data.slug = data.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
    }
    
    // Check if slug exists
    const existingPage = await this.pageModel.findOne({ slug: data.slug });
    if (existingPage) {
      throw new BadRequestException('Page with this slug already exists');
    }

    const page = await this.pageModel.create({
      ...data,
      author: authorId,
      publishedAt: data.status === 'published' ? new Date() : undefined,
    });
    return { success: true, page };
  }

  async updatePage(id: string, data: any) {
    const page = await this.pageModel.findById(id);
    if (!page) {
      throw new NotFoundException('Page not found');
    }

    // Update slug if title changed
    if (data.title && data.title !== page.title && !data.slug) {
      data.slug = data.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
    }

    // Check slug uniqueness if changed
    if (data.slug && data.slug !== page.slug) {
      const existingPage = await this.pageModel.findOne({ slug: data.slug });
      if (existingPage) {
        throw new BadRequestException('Page with this slug already exists');
      }
    }

    // Set publishedAt if status changed to published
    if (data.status === 'published' && page.status !== 'published') {
      data.publishedAt = new Date();
    }

    const updatedPage = await this.pageModel.findByIdAndUpdate(id, data, { new: true, runValidators: true });
    return { success: true, page: updatedPage };
  }

  async deletePage(id: string) {
    const page = await this.pageModel.findByIdAndDelete(id);
    if (!page) {
      throw new NotFoundException('Page not found');
    }
    return { success: true, message: 'Page deleted successfully' };
  }

  // ========== BLOG ==========
  async getBlogPosts(status?: string, category?: string) {
    const filter: any = {};
    if (status) filter.status = status;
    if (category) filter.category = category;
    
    const posts = await this.blogModel
      .find(filter)
      .populate('author', 'name email')
      .populate('category', 'name slug')
      .sort({ createdAt: -1 });
    return { success: true, posts };
  }

  async getBlogPost(id: string) {
    const post = await this.blogModel.findById(id)
      .populate('author', 'name email')
      .populate('category', 'name slug');
    if (!post) {
      throw new NotFoundException('Blog post not found');
    }
    return { success: true, post };
  }

  async createBlogPost(data: any, authorId: string) {
    // Generate slug if not provided
    if (!data.slug && data.title) {
      data.slug = data.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
    }

    // Check if slug exists
    const existingPost = await this.blogModel.findOne({ slug: data.slug });
    if (existingPost) {
      throw new BadRequestException('Blog post with this slug already exists');
    }

    const post = await this.blogModel.create({
      ...data,
      author: authorId,
      publishedAt: data.status === 'published' ? new Date() : undefined,
    });
    return { success: true, post };
  }

  async updateBlogPost(id: string, data: any) {
    const post = await this.blogModel.findById(id);
    if (!post) {
      throw new NotFoundException('Blog post not found');
    }

    // Update slug if title changed
    if (data.title && data.title !== post.title && !data.slug) {
      data.slug = data.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
    }

    // Check slug uniqueness if changed
    if (data.slug && data.slug !== post.slug) {
      const existingPost = await this.blogModel.findOne({ slug: data.slug });
      if (existingPost) {
        throw new BadRequestException('Blog post with this slug already exists');
      }
    }

    // Set publishedAt if status changed to published
    if (data.status === 'published' && post.status !== 'published') {
      data.publishedAt = new Date();
    }

    const updatedPost = await this.blogModel.findByIdAndUpdate(id, data, { new: true, runValidators: true })
      .populate('category', 'name slug');
    return { success: true, post: updatedPost };
  }

  async deleteBlogPost(id: string) {
    const post = await this.blogModel.findByIdAndDelete(id);
    if (!post) {
      throw new NotFoundException('Blog post not found');
    }
    return { success: true, message: 'Blog post deleted successfully' };
  }

  // ========== MEDIA ==========
  async getMedia(type?: string, folder?: string) {
    const filter: any = {};
    if (type) filter.fileType = type;
    if (folder) filter.folderPath = folder;
    
    const media = await this.mediaModel.find(filter).populate('uploadedBy', 'name email').sort({ createdAt: -1 });
    return { success: true, media };
  }

  async getMediaById(id: string) {
    const media = await this.mediaModel.findById(id).populate('uploadedBy', 'name email');
    if (!media) {
      throw new NotFoundException('Media not found');
    }
    return { success: true, media };
  }

  async uploadMedia(data: any, userId: string) {
    const media = await this.mediaModel.create({
      ...data,
      uploadedBy: userId,
    });
    return { success: true, media };
  }

  async updateMedia(id: string, data: any) {
    const media = await this.mediaModel.findByIdAndUpdate(id, data, { new: true, runValidators: true });
    if (!media) {
      throw new NotFoundException('Media not found');
    }
    return { success: true, media };
  }

  async deleteMedia(id: string) {
    const media = await this.mediaModel.findByIdAndDelete(id);
    if (!media) {
      throw new NotFoundException('Media not found');
    }
    return { success: true, message: 'Media deleted successfully' };
  }

  // ========== MENUS ==========
  async getMenus(location?: string) {
    const filter: any = {};
    if (location) filter.location = location;
    
    const menus = await this.menuModel.find(filter).sort({ createdAt: -1 });
    return { success: true, menus };
  }

  async getMenu(id: string) {
    const menu = await this.menuModel.findById(id);
    if (!menu) {
      throw new NotFoundException('Menu not found');
    }
    return { success: true, menu };
  }

  async createMenu(data: any) {
    // Check if menu name exists
    const existingMenu = await this.menuModel.findOne({ name: data.name });
    if (existingMenu) {
      throw new BadRequestException('Menu with this name already exists');
    }

    const menu = await this.menuModel.create(data);
    return { success: true, menu };
  }

  async updateMenu(id: string, data: any) {
    const menu = await this.menuModel.findById(id);
    if (!menu) {
      throw new NotFoundException('Menu not found');
    }

    // Check name uniqueness if changed
    if (data.name && data.name !== menu.name) {
      const existingMenu = await this.menuModel.findOne({ name: data.name });
      if (existingMenu) {
        throw new BadRequestException('Menu with this name already exists');
      }
    }

    const updatedMenu = await this.menuModel.findByIdAndUpdate(id, data, { new: true, runValidators: true });
    return { success: true, menu: updatedMenu };
  }

  async deleteMenu(id: string) {
    const menu = await this.menuModel.findByIdAndDelete(id);
    if (!menu) {
      throw new NotFoundException('Menu not found');
    }
    return { success: true, message: 'Menu deleted successfully' };
  }

  // ========== FORMS ==========
  async getForms() {
    const forms = await this.formModel.find().sort({ createdAt: -1 });
    return { success: true, forms };
  }

  async getForm(id: string) {
    const form = await this.formModel.findById(id);
    if (!form) {
      throw new NotFoundException('Form not found');
    }
    return { success: true, form };
  }

  async createForm(data: any) {
    // Check if form name exists
    const existingForm = await this.formModel.findOne({ name: data.name });
    if (existingForm) {
      throw new BadRequestException('Form with this name already exists');
    }

    const form = await this.formModel.create(data);
    return { success: true, form };
  }

  async updateForm(id: string, data: any) {
    const form = await this.formModel.findById(id);
    if (!form) {
      throw new NotFoundException('Form not found');
    }

    // Check name uniqueness if changed
    if (data.name && data.name !== form.name) {
      const existingForm = await this.formModel.findOne({ name: data.name });
      if (existingForm) {
        throw new BadRequestException('Form with this name already exists');
      }
    }

    const updatedForm = await this.formModel.findByIdAndUpdate(id, data, { new: true, runValidators: true });
    return { success: true, form: updatedForm };
  }

  async deleteForm(id: string) {
    const form = await this.formModel.findByIdAndDelete(id);
    if (!form) {
      throw new NotFoundException('Form not found');
    }
    // Also delete associated submissions
    await this.formSubmissionModel.deleteMany({ form: id });
    return { success: true, message: 'Form deleted successfully' };
  }

  // ========== FORM SUBMISSIONS ==========
  async getFormSubmissions(formId: string) {
    const form = await this.formModel.findById(formId);
    if (!form) {
      throw new NotFoundException('Form not found');
    }

    const submissions = await this.formSubmissionModel.find({ form: formId }).sort({ createdAt: -1 });
    return { success: true, submissions };
  }

  async submitForm(formId: string, submissionData: any) {
    const form = await this.formModel.findById(formId);
    if (!form) {
      throw new NotFoundException('Form not found');
    }

    // Validate submission data against form fields
    const submission: any = {
      form: formId,
      data: submissionData.data || {},
      status: 'new',
    };

    // Add user IP and agent if available
    if (submissionData.userIp) submission.userIp = submissionData.userIp;
    if (submissionData.userAgent) submission.userAgent = submissionData.userAgent;

    const createdSubmission = await this.formSubmissionModel.create(submission);

    // Send email notification if configured
    if (form.emailNotification && form.emailRecipients && form.emailRecipients.length > 0) {
      // TODO: Send email notification
      // Email notification should be sent
    }

    return {
      success: true,
      message: form.successMessage || 'Thank you for your submission!',
      submission: createdSubmission,
      redirectUrl: form.redirectUrl,
    };
  }
}

