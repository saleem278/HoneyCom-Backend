import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CmsService } from './cms.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';

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
  async getPages(@Query('status') status?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;
    return this.cmsService.getPages(status, pageNum, limitNum);
  }

  @Get('pages/:id')
  @ApiOperation({ summary: 'Get page by ID' })
  async getPage(@Param('id') id: string) {
    return this.cmsService.getPage(id);
  }

  @Post('pages')
  @ApiOperation({ summary: 'Create page' })
  async createPage(@Body() data: any, @Request() req) {
    return this.cmsService.createPage(data, req.user.id);
  }

  @Put('pages/:id')
  @ApiOperation({ summary: 'Update page' })
  async updatePage(@Param('id') id: string, @Body() data: any) {
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
  async getBlogPosts(@Query('status') status?: string, @Query('category') category?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;
    return this.cmsService.getBlogPosts(status, category, pageNum, limitNum);
  }

  @Get('blog/:id')
  @ApiOperation({ summary: 'Get blog post by ID' })
  async getBlogPost(@Param('id') id: string) {
    return this.cmsService.getBlogPost(id);
  }

  @Post('blog')
  @ApiOperation({ summary: 'Create blog post' })
  async createBlogPost(@Body() data: any, @Request() req) {
    return this.cmsService.createBlogPost(data, req.user.id);
  }

  @Put('blog/:id')
  @ApiOperation({ summary: 'Update blog post' })
  async updateBlogPost(@Param('id') id: string, @Body() data: any) {
    return this.cmsService.updateBlogPost(id, data);
  }

  @Delete('blog/:id')
  @ApiOperation({ summary: 'Delete blog post' })
  async deleteBlogPost(@Param('id') id: string) {
    return this.cmsService.deleteBlogPost(id);
  }

  // ========== MEDIA ==========
  @Get('media')
  @ApiOperation({ summary: 'Get all media' })
  async getMedia(@Query('type') type?: string, @Query('folder') folder?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;
    return this.cmsService.getMedia(type, folder, pageNum, limitNum);
  }

  @Get('media/:id')
  @ApiOperation({ summary: 'Get media by ID' })
  async getMediaById(@Param('id') id: string) {
    return this.cmsService.getMediaById(id);
  }

  @Post('media')
  @ApiOperation({ summary: 'Upload media' })
  async uploadMedia(@Body() data: any, @Request() req) {
    return this.cmsService.uploadMedia(data, req.user.id);
  }

  @Put('media/:id')
  @ApiOperation({ summary: 'Update media metadata' })
  async updateMedia(@Param('id') id: string, @Body() data: any) {
    return this.cmsService.updateMedia(id, data);
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
  @ApiOperation({ summary: 'Get all forms' })
  async getForms() {
    return this.cmsService.getForms();
  }

  @Get('forms/:id')
  @ApiOperation({ summary: 'Get form by ID' })
  async getForm(@Param('id') id: string) {
    return this.cmsService.getForm(id);
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
  @ApiOperation({ summary: 'Get form submissions' })
  async getFormSubmissions(@Param('id') id: string) {
    return this.cmsService.getFormSubmissions(id);
  }

  @Post('forms/:id/submit')
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

  @Get('blog-categories/:id')
  @ApiOperation({ summary: 'Get blog category by ID' })
  async getBlogCategory(@Param('id') id: string) {
    return this.cmsService.getBlogCategory(id);
  }

  @Post('blog-categories')
  @ApiOperation({ summary: 'Create blog category' })
  async createBlogCategory(@Body() data: any) {
    return this.cmsService.createBlogCategory(data);
  }

  @Put('blog-categories/:id')
  @ApiOperation({ summary: 'Update blog category' })
  async updateBlogCategory(@Param('id') id: string, @Body() data: any) {
    return this.cmsService.updateBlogCategory(id, data);
  }

  @Delete('blog-categories/:id')
  @ApiOperation({ summary: 'Delete blog category' })
  async deleteBlogCategory(@Param('id') id: string) {
    return this.cmsService.deleteBlogCategory(id);
  }

  // ========== SITEMAP ==========
  @Get('sitemap')
  @UseGuards(OptionalJwtAuthGuard) // Public endpoint for SEO
  @ApiOperation({ summary: 'Generate sitemap.xml (public)' })
  @ApiResponse({ status: 200, description: 'Sitemap XML' })
  async generateSitemap() {
    return this.cmsService.generateSitemap();
  }

  // ========== ROBOTS.TXT ==========
  @Get('robots-txt')
  @UseGuards(OptionalJwtAuthGuard) // Public endpoint for SEO
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
    @Request() req,
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
  async restoreVersion(@Param('id') id: string, @Request() req) {
    return this.cmsService.restoreVersion(id, req.user.id);
  }

  // ========== WIDGETS ==========
  @Get('widgets')
  @ApiOperation({ summary: 'Get all widgets' })
  async getWidgets(@Query('location') location?: string) {
    return this.cmsService.getWidgets(location);
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
}

