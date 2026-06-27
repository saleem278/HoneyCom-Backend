import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { CmsService } from './cms.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';
import type { AuthedRequest } from '../../common/types/request.types';
import { CreatePageDto } from './dto/create-page.dto';
import { UpdatePageDto } from './dto/update-page.dto';
import { CreateBlogDto } from './dto/create-blog.dto';
import { UpdateBlogDto } from './dto/update-blog.dto';
import { CreateBlogCategoryDto, UpdateBlogCategoryDto } from './dto/create-blog-category.dto';

@ApiTags('CMS')
@Controller('cms')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'contentEditor')
@ApiBearerAuth('JWT-auth')
export class CmsController {
  constructor(private readonly cmsService: CmsService) {}

  // ========== DASHBOARD ==========
  @Get('dashboard')
  @ApiOperation({ summary: 'Get CMS dashboard statistics' })
  async getDashboard() {
    return this.cmsService.getDashboard();
  }

  // ========== PAGES ==========
  @Get('pages')
  @ApiOperation({ summary: 'Get all pages' })
  async getPages(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    const pageNum = parseInt(page || '', 10) || 1;
    const limitNum = parseInt(limit || '', 10) || 20;
    return this.cmsService.getPages(status, pageNum, limitNum, search);
  }

  @Get('pages/by-slug/:slug')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Get published page by slug (public)' })
  async getPageBySlug(@Param('slug') slug: string) {
    return this.cmsService.getPageBySlug(slug);
  }

  @Get('pages/:id')
  @ApiOperation({ summary: 'Get page by ID' })
  async getPage(@Param('id') id: string) {
    return this.cmsService.getPage(id);
  }

  @Post('pages')
  @ApiOperation({ summary: 'Create page' })
  async createPage(@Body() data: CreatePageDto, @Request() req: AuthedRequest) {
    return this.cmsService.createPage(data, req.user.id);
  }

  @Put('pages/:id')
  @ApiOperation({ summary: 'Update page' })
  async updatePage(@Param('id') id: string, @Body() data: UpdatePageDto) {
    return this.cmsService.updatePage(id, data);
  }

  @Delete('pages/:id')
  @ApiOperation({ summary: 'Delete page' })
  async deletePage(@Param('id') id: string) {
    return this.cmsService.deletePage(id);
  }

  // ========== BLOG ==========
  @Get('blog')
  @ApiOperation({ summary: 'Get all blog posts' })
  async getBlogPosts(
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    const pageNum = parseInt(page || '', 10) || 1;
    const limitNum = parseInt(limit || '', 10) || 20;
    return this.cmsService.getBlogPosts(status, category, pageNum, limitNum, search);
  }

  // Public routes MUST be declared before blog/:id, otherwise Express matches
  // ":id" with id="public" first and the public endpoints are unreachable.
  @Get('blog/public')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'List published blog posts (public storefront)' })
  async getPublicBlogPosts(
    @Query('category') category?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    const pageNum = parseInt(page || '', 10) || 1;
    const limitNum = parseInt(limit || '', 10) || 20;
    return this.cmsService.getPublicBlogPosts(category, pageNum, limitNum, search);
  }

  @Get('blog/public/:id')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Get published blog post by ID (public storefront)' })
  async getPublicBlogPost(@Param('id') id: string) {
    return this.cmsService.getPublicBlogPost(id);
  }

  @Get('blog/by-slug/:slug')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Get published blog post by slug (public)' })
  async getBlogPostBySlug(@Param('slug') slug: string) {
    return this.cmsService.getBlogPostBySlug(slug);
  }

  @Get('blog/:id')
  @ApiOperation({ summary: 'Get blog post by ID' })
  async getBlogPost(@Param('id') id: string) {
    return this.cmsService.getBlogPost(id);
  }

  @Post('blog')
  @ApiOperation({ summary: 'Create blog post' })
  async createBlogPost(@Body() data: CreateBlogDto, @Request() req: AuthedRequest) {
    return this.cmsService.createBlogPost(data, req.user.id);
  }

  @Put('blog/:id')
  @ApiOperation({ summary: 'Update blog post' })
  async updateBlogPost(@Param('id') id: string, @Body() data: UpdateBlogDto) {
    return this.cmsService.updateBlogPost(id, data);
  }

  @Delete('blog/:id')
  @ApiOperation({ summary: 'Delete blog post' })
  async deleteBlogPost(@Param('id') id: string) {
    return this.cmsService.deleteBlogPost(id);
  }

  // ========== MEDIA ==========
  @Get('media')
  @ApiOperation({ summary: 'Get all media with optional server-side search' })
  async getMedia(
    @Query('type') type?: string,
    @Query('folder') folder?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = parseInt(page || '', 10) || 1;
    const limitNum = parseInt(limit || '', 10) || 20;
    return this.cmsService.getMedia(type, folder, pageNum, limitNum, search);
  }

  @Get('media/folders')
  @ApiOperation({ summary: 'Get distinct media folder paths' })
  async getMediaFolders() {
    return this.cmsService.getMediaFolders();
  }

  @Get('media/:id')
  @ApiOperation({ summary: 'Get media by ID' })
  async getMediaById(@Param('id') id: string) {
    return this.cmsService.getMediaById(id);
  }

  @Get('media/:id/usage')
  @ApiOperation({ summary: 'Count where a media asset is referenced (pages/posts/widgets/SEO)' })
  async getMediaUsage(@Param('id') id: string) {
    return this.cmsService.getMediaUsage(id);
  }

  @Post('media')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const allowed = /^(image\/|video\/|application\/pdf$)/;
        if (allowed.test(file.mimetype)) {
          cb(null, true);
        } else {
          cb(
            new Error(
              `File type ${file.mimetype} is not allowed. Only images, videos, and PDFs are accepted.`,
            ),
            false,
          );
        }
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload media (max 5 MB; images, videos, PDF only)' })
  async uploadMedia(
    @UploadedFile() file: Express.Multer.File,
    @Body() data: any,
    @Request() req: AuthedRequest,
  ) {
    return this.cmsService.uploadMedia(file, data, req.user.id);
  }

  @Put('media/:id')
  @ApiOperation({ summary: 'Update media metadata' })
  async updateMedia(@Param('id') id: string, @Body() data: any) {
    return this.cmsService.updateMedia(id, data);
  }

  @Delete('media')
  @ApiOperation({ summary: 'Bulk delete media by IDs' })
  async deleteMediaBulk(@Body() body: { ids: string[] }) {
    return this.cmsService.deleteMediaBulk(body.ids);
  }

  @Delete('media/:id')
  @ApiOperation({ summary: 'Delete media' })
  async deleteMedia(@Param('id') id: string) {
    return this.cmsService.deleteMedia(id);
  }

  // ========== MENUS ==========
  @Get('menus')
  @ApiOperation({ summary: 'Get all menus' })
  async getMenus(@Query('location') location?: string) {
    return this.cmsService.getMenus(location);
  }

  // Public route MUST be declared before menus/:id, otherwise Express matches
  // ":id" with id="public" first and the public endpoint is unreachable.
  @Get('menus/public')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Get active menu for a storefront location (public)' })
  async getPublicMenu(@Query('location') location: string) {
    return this.cmsService.getPublicMenu(location);
  }

  @Get('menus/:id')
  @ApiOperation({ summary: 'Get menu by ID' })
  async getMenu(@Param('id') id: string) {
    return this.cmsService.getMenu(id);
  }

  @Post('menus')
  @ApiOperation({ summary: 'Create menu' })
  async createMenu(@Body() data: any) {
    return this.cmsService.createMenu(data);
  }

  @Put('menus/:id')
  @ApiOperation({ summary: 'Update menu' })
  async updateMenu(@Param('id') id: string, @Body() data: any) {
    return this.cmsService.updateMenu(id, data);
  }

  @Delete('menus/:id')
  @ApiOperation({ summary: 'Delete menu' })
  async deleteMenu(@Param('id') id: string) {
    return this.cmsService.deleteMenu(id);
  }

  // ========== FORMS ==========
  @Get('forms')
  @ApiOperation({ summary: 'Get all forms with submission counts and unread badge' })
  async getForms() {
    return this.cmsService.getFormsWithUnread();
  }

  @Get('forms/:id')
  @ApiOperation({ summary: 'Get form by ID' })
  async getForm(@Param('id') id: string) {
    return this.cmsService.getForm(id);
  }

  // Public form definition for the storefront <CmsForm> renderer. Returns only
  // fields/labels/messages (never emailRecipients) so a storefront page can
  // fetch a form's shape and POST to /cms/forms/:id/submit (already @Public()).
  @Get('forms/:id/public')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Get form definition for storefront rendering (public)' })
  async getPublicForm(@Param('id') id: string) {
    return this.cmsService.getPublicForm(id);
  }

  @Post('forms')
  @ApiOperation({ summary: 'Create form' })
  async createForm(@Body() data: any) {
    return this.cmsService.createForm(data);
  }

  @Put('forms/:id')
  @ApiOperation({ summary: 'Update form' })
  async updateForm(@Param('id') id: string, @Body() data: any) {
    return this.cmsService.updateForm(id, data);
  }

  @Delete('forms/:id')
  @ApiOperation({ summary: 'Delete form' })
  async deleteForm(@Param('id') id: string) {
    return this.cmsService.deleteForm(id);
  }

  // ========== FORM SUBMISSIONS ==========
  @Get('forms/:id/submissions')
  @ApiOperation({ summary: 'Get form submissions (optionally filter by status)' })
  async getFormSubmissions(@Param('id') id: string, @Query('status') status?: string) {
    return this.cmsService.getFormSubmissionsFiltered(id, status);
  }

  @Patch('forms/:formId/submissions/:submissionId')
  @ApiOperation({ summary: 'Update submission status (new|read|archived)' })
  async updateSubmissionStatus(
    @Param('formId') formId: string,
    @Param('submissionId') submissionId: string,
    @Body() body: { status: 'new' | 'read' | 'archived' },
  ) {
    return this.cmsService.updateSubmissionStatus(formId, submissionId, body.status);
  }

  @Delete('forms/:formId/submissions/:submissionId')
  @ApiOperation({ summary: 'Delete a single submission' })
  async deleteSubmission(
    @Param('formId') formId: string,
    @Param('submissionId') submissionId: string,
  ) {
    return this.cmsService.deleteSubmission(formId, submissionId);
  }

  @Post('forms/:id/submit')
  @Public()
  @ApiOperation({ summary: 'Submit form data' })
  async submitForm(@Param('id') id: string, @Body() data: any) {
    return this.cmsService.submitForm(id, data);
  }

  // ========== BLOG CATEGORIES ==========
  @Get('blog-categories')
  @ApiOperation({ summary: 'Get all blog categories' })
  async getBlogCategories() {
    return this.cmsService.getBlogCategories();
  }

  // Public route MUST precede blog-categories/:id (same :id-shadowing reason).
  @Get('blog-categories/public')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Get blog categories for storefront filter pills (public)' })
  async getPublicBlogCategories() {
    return this.cmsService.getPublicBlogCategories();
  }

  @Get('blog-categories/:id')
  @ApiOperation({ summary: 'Get blog category by ID' })
  async getBlogCategory(@Param('id') id: string) {
    return this.cmsService.getBlogCategory(id);
  }

  @Post('blog-categories')
  @ApiOperation({ summary: 'Create blog category' })
  async createBlogCategory(@Body() data: CreateBlogCategoryDto) {
    return this.cmsService.createBlogCategory(data);
  }

  @Put('blog-categories/:id')
  @ApiOperation({ summary: 'Update blog category' })
  async updateBlogCategory(@Param('id') id: string, @Body() data: UpdateBlogCategoryDto) {
    return this.cmsService.updateBlogCategory(id, data);
  }

  @Delete('blog-categories/:id')
  @ApiOperation({ summary: 'Delete blog category' })
  async deleteBlogCategory(@Param('id') id: string) {
    return this.cmsService.deleteBlogCategory(id);
  }

  // ========== SITEMAP ==========
  @Get('sitemap')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Generate sitemap.xml (public)' })
  @ApiResponse({ status: 200, description: 'Sitemap XML' })
  async generateSitemap() {
    return this.cmsService.generateSitemap();
  }

  // ========== ROBOTS.TXT ==========
  @Get('robots-txt')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Get robots.txt content (public)' })
  @ApiResponse({ status: 200, description: 'Robots.txt content' })
  async getRobotsTxt() {
    return this.cmsService.getRobotsTxt();
  }

  @Put('robots-txt')
  @ApiOperation({ summary: 'Update robots.txt content' })
  async updateRobotsTxt(@Body() body: { content: string }) {
    return this.cmsService.updateRobotsTxt(body.content);
  }

  // ========== VERSION CONTROL ==========
  @Post('versions/:contentType/:contentId')
  @ApiOperation({ summary: 'Create version snapshot' })
  async createVersion(
    @Param('contentType') contentType: 'page' | 'blog',
    @Param('contentId') contentId: string,
    @Request() req: AuthedRequest,
  ) {
    return this.cmsService.createVersion(contentType, contentId, req.user.id);
  }

  @Get('versions/:contentType/:contentId')
  @ApiOperation({ summary: 'Get all versions for content' })
  async getVersions(
    @Param('contentType') contentType: 'page' | 'blog',
    @Param('contentId') contentId: string,
  ) {
    return this.cmsService.getVersions(contentType, contentId);
  }

  @Post('versions/:id/restore')
  @ApiOperation({ summary: 'Restore a version' })
  async restoreVersion(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.cmsService.restoreVersion(id, req.user.id);
  }

  // ========== WIDGETS ==========
  @Get('widgets')
  @ApiOperation({ summary: 'Get all widgets' })
  async getWidgets(@Query('location') location?: string) {
    return this.cmsService.getWidgets(location);
  }

  // Public route MUST precede widgets/:id (same :id-shadowing reason as menus).
  @Get('widgets/public')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Get active widgets for a storefront slot (public)' })
  async getPublicWidgets(@Query('location') location?: string) {
    return this.cmsService.getPublicWidgets(location);
  }

  @Get('widgets/:id')
  @ApiOperation({ summary: 'Get widget by ID' })
  async getWidget(@Param('id') id: string) {
    return this.cmsService.getWidget(id);
  }

  @Post('widgets')
  @ApiOperation({ summary: 'Create widget' })
  async createWidget(@Body() data: any) {
    return this.cmsService.createWidget(data);
  }

  @Put('widgets/:id')
  @ApiOperation({ summary: 'Update widget' })
  async updateWidget(@Param('id') id: string, @Body() data: any) {
    return this.cmsService.updateWidget(id, data);
  }

  @Delete('widgets/:id')
  @ApiOperation({ summary: 'Delete widget' })
  async deleteWidget(@Param('id') id: string) {
    return this.cmsService.deleteWidget(id);
  }

  // ========== SEO AUDIT ==========

  @Get('seo/audit')
  @ApiOperation({ summary: 'SEO audit — pages/posts with meta status' })
  async getSeoAudit() {
    return this.cmsService.getSeoAudit();
  }

  @Get('seo/defaults')
  @ApiOperation({ summary: 'Get global SEO defaults' })
  async getSeoDefaults() {
    return this.cmsService.getSeoDefaults();
  }

  // Public read of the global SEO defaults so the storefront root layout can
  // merge CMS-managed siteName/metaTitle/metaDescription/keywords/ogImage/
  // twitterHandle into the <head>. The defaults payload contains only
  // non-sensitive presentation fields (no recipients/secrets), so it is safe to
  // expose unauthenticated. Without this, editing SEO defaults in the CMS
  // changed nothing a crawler or social card ever saw.
  @Get('seo/public')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Get global SEO defaults for storefront <head> (public)' })
  async getPublicSeoDefaults() {
    return this.cmsService.getSeoDefaults();
  }

  @Put('seo/defaults')
  @ApiOperation({ summary: 'Update global SEO defaults' })
  async updateSeoDefaults(@Body() body: Record<string, any>) {
    return this.cmsService.updateSeoDefaults(body);
  }
}