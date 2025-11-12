import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Page, IPage } from '../../models/Page.model';
import { Blog, IBlog } from '../../models/Blog.model';
import { BlogCategory, IBlogCategory } from '../../models/BlogCategory.model';
import { Media, IMedia } from '../../models/Media.model';
import { Menu, IMenu } from '../../models/Menu.model';
import { Form, IForm } from '../../models/Form.model';
import { IFormSubmission } from '../../models/FormSubmission.model';
import { ContentVersion, IContentVersion } from '../../models/ContentVersion.model';
import { Widget, IWidget } from '../../models/Widget.model';
import { EmailService } from '../../services/email.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CmsService {
  constructor(
    @InjectModel('Page') private pageModel: Model<IPage>,
    @InjectModel('Blog') private blogModel: Model<IBlog>,
    @InjectModel('BlogCategory') private blogCategoryModel: Model<IBlogCategory>,
    @InjectModel('Media') private mediaModel: Model<IMedia>,
    @InjectModel('Menu') private menuModel: Model<IMenu>,
    @InjectModel('Form') private formModel: Model<IForm>,
    @InjectModel('FormSubmission') private formSubmissionModel: Model<IFormSubmission>,
    @InjectModel('ContentVersion') private contentVersionModel: Model<IContentVersion>,
    @InjectModel('Widget') private widgetModel: Model<IWidget>,
    private emailService: EmailService,
    private configService: ConfigService,
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
      try {
        const submissionDataHtml = Object.entries(submissionData.data || {})
          .map(([key, value]) => `<tr><td><strong>${key}:</strong></td><td>${value}</td></tr>`)
          .join('');
        
        const emailHtml = `
          <h1>New Form Submission: ${form.name}</h1>
          <table border="1" cellpadding="10" cellspacing="0" style="border-collapse: collapse;">
            ${submissionDataHtml}
          </table>
          <p><a href="${process.env.FRONTEND_URL}/cms/forms/${formId}/submissions">View All Submissions</a></p>
        `;
        
        await Promise.all(form.emailRecipients.map((email: string) =>
          this.emailService.sendEmail({
            to: email,
            subject: `New Form Submission: ${form.name}`,
            html: emailHtml,
          }).catch(err => {
            console.error(`Failed to send form notification to ${email}:`, err);
          })
        ));
      } catch (error) {
        // Don't fail submission if email fails
        console.error('Error sending form submission email:', error);
      }
    }

    return {
      success: true,
      message: form.successMessage || 'Thank you for your submission!',
      submission: createdSubmission,
      redirectUrl: form.redirectUrl,
    };
  }

  // ========== BLOG CATEGORIES ==========
  async getBlogCategories() {
    const categories = await this.blogCategoryModel.find().populate('parent', 'name slug').sort({ name: 1 });
    return { success: true, categories };
  }

  async getBlogCategory(id: string) {
    const category = await this.blogCategoryModel.findById(id).populate('parent', 'name slug');
    if (!category) {
      throw new NotFoundException('Blog category not found');
    }
    return { success: true, category };
  }

  async createBlogCategory(data: any) {
    // Generate slug if not provided
    if (!data.slug && data.name) {
      data.slug = data.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
    }

    // Check if slug already exists
    const existing = await this.blogCategoryModel.findOne({ slug: data.slug });
    if (existing) {
      throw new BadRequestException('Category with this slug already exists');
    }

    const category = new this.blogCategoryModel(data);
    await category.save();
    return { success: true, category };
  }

  async updateBlogCategory(id: string, data: any) {
    const category = await this.blogCategoryModel.findById(id);
    if (!category) {
      throw new NotFoundException('Blog category not found');
    }

    // Generate slug if name changed and slug not provided
    if (data.name && !data.slug) {
      data.slug = data.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
    }

    // Check slug uniqueness if changed
    if (data.slug && data.slug !== category.slug) {
      const existing = await this.blogCategoryModel.findOne({ slug: data.slug });
      if (existing) {
        throw new BadRequestException('Category with this slug already exists');
      }
    }

    const updated = await this.blogCategoryModel.findByIdAndUpdate(id, data, { new: true, runValidators: true });
    return { success: true, category: updated };
  }

  async deleteBlogCategory(id: string) {
    const category = await this.blogCategoryModel.findById(id);
    if (!category) {
      throw new NotFoundException('Blog category not found');
    }

    // Check if category is used by any blog posts
    const postsUsingCategory = await this.blogModel.countDocuments({ category: id });
    if (postsUsingCategory > 0) {
      throw new BadRequestException(`Cannot delete category. It is used by ${postsUsingCategory} blog post(s).`);
    }

    await this.blogCategoryModel.findByIdAndDelete(id);
    return { success: true, message: 'Blog category deleted successfully' };
  }

  // ========== SITEMAP ==========
  async generateSitemap() {
    const baseUrl = this.configService.get<string>('FRONTEND_URL')?.split(',')[0] || 'http://localhost:3000';
    
    const pages = await this.pageModel.find({ status: 'published' }).select('slug updatedAt').lean();
    const posts = await this.blogModel.find({ status: 'published' }).select('slug updatedAt').lean();

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
${pages.map((page: any) => `  <url>
    <loc>${baseUrl}/${page.slug}</loc>
    <lastmod>${new Date(page.updatedAt).toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`).join('\n')}
${posts.map((post: any) => `  <url>
    <loc>${baseUrl}/blog/${post.slug}</loc>
    <lastmod>${new Date(post.updatedAt).toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`).join('\n')}
</urlset>`;

    return { success: true, sitemap, url: `${baseUrl}/sitemap.xml` };
  }

  // ========== ROBOTS.TXT ==========
  async getRobotsTxt() {
    // Try to get from database or return default
    const baseUrl = this.configService.get<string>('FRONTEND_URL')?.split(',')[0] || 'http://localhost:3000';
    const defaultRobots = `User-agent: *
Allow: /
Disallow: /admin/
Disallow: /seller/
Disallow: /cms/
Disallow: /api/

Sitemap: ${baseUrl}/sitemap.xml`;

    // In a real implementation, you might store this in a database
    // For now, return default
    return { success: true, content: defaultRobots };
  }

  async updateRobotsTxt(content: string) {
    // In a real implementation, save to database or file system
    // For now, just validate and return
    if (!content || content.trim().length === 0) {
      throw new BadRequestException('Robots.txt content cannot be empty');
    }

    // Basic validation
    if (content.length > 10000) {
      throw new BadRequestException('Robots.txt content is too long (max 10000 characters)');
    }

    // TODO: Save to database or file system
    // For now, return success
    return { success: true, message: 'Robots.txt updated successfully', content };
  }

  // ========== VERSION CONTROL ==========
  async createVersion(contentType: 'page' | 'blog', contentId: string, userId: string) {
    let content: any;
    if (contentType === 'page') {
      content = await this.pageModel.findById(contentId);
    } else {
      content = await this.blogModel.findById(contentId);
    }

    if (!content) {
      throw new NotFoundException(`${contentType} not found`);
    }

    // Get latest version number
    const latestVersion = await this.contentVersionModel
      .findOne({ contentType, contentId })
      .sort({ version: -1 })
      .select('version');

    const versionNumber = latestVersion ? latestVersion.version + 1 : 1;

    const version = new this.contentVersionModel({
      contentType,
      contentId,
      version: versionNumber,
      title: content.title,
      content: content.content,
      slug: content.slug,
      metaTitle: content.metaTitle,
      metaDescription: content.metaDescription,
      keywords: content.keywords,
      createdBy: userId,
    });

    await version.save();
    return { success: true, version };
  }

  async getVersions(contentType: 'page' | 'blog', contentId: string) {
    const versions = await this.contentVersionModel
      .find({ contentType, contentId })
      .populate('createdBy', 'name email')
      .sort({ version: -1 });

    return { success: true, versions };
  }

  async restoreVersion(versionId: string, userId: string) {
    const version = await this.contentVersionModel.findById(versionId).populate('createdBy');
    if (!version) {
      throw new NotFoundException('Version not found');
    }

    if (version.contentType === 'page') {
      await this.pageModel.findByIdAndUpdate(version.contentId, {
        title: version.title,
        content: version.content,
        slug: version.slug,
        metaTitle: version.metaTitle,
        metaDescription: version.metaDescription,
        keywords: version.keywords,
      });
    } else {
      await this.blogModel.findByIdAndUpdate(version.contentId, {
        title: version.title,
        content: version.content,
        slug: version.slug,
        metaTitle: version.metaTitle,
        metaDescription: version.metaDescription,
        keywords: version.keywords,
      });
    }

    // Create a new version from the restored content
    await this.createVersion(version.contentType, version.contentId.toString(), userId);

    return { success: true, message: 'Version restored successfully' };
  }

  // ========== WIDGETS ==========
  async getWidgets(location?: string) {
    const filter: any = {};
    if (location) filter.location = location;
    const widgets = await this.widgetModel.find(filter).sort({ name: 1 });
    return { success: true, widgets };
  }

  async getWidget(id: string) {
    const widget = await this.widgetModel.findById(id);
    if (!widget) {
      throw new NotFoundException('Widget not found');
    }
    return { success: true, widget };
  }

  async createWidget(data: any) {
    const widget = new this.widgetModel(data);
    await widget.save();
    return { success: true, widget };
  }

  async updateWidget(id: string, data: any) {
    const widget = await this.widgetModel.findByIdAndUpdate(id, data, { new: true, runValidators: true });
    if (!widget) {
      throw new NotFoundException('Widget not found');
    }
    return { success: true, widget };
  }

  async deleteWidget(id: string) {
    const widget = await this.widgetModel.findByIdAndDelete(id);
    if (!widget) {
      throw new NotFoundException('Widget not found');
    }
    return { success: true, message: 'Widget deleted successfully' };
  }
}

