import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { EmailService } from '../../services/email.service';

@ApiTags('Contact')
@Controller('contact')
export class ContactController {
  constructor(private readonly emailService: EmailService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // max 5 submissions per minute per IP
  @ApiOperation({ summary: 'Submit a contact-form message' })
  @ApiResponse({ status: 200, description: 'Message dispatched to support inbox' })
  async submit(
    @Body() body: { name: string; email: string; subject: string; message: string },
  ) {
    const { name, email, subject, message } = body;
    if (!name?.trim() || !email?.trim() || !subject?.trim() || !message?.trim()) {
      return { success: false, message: 'All fields are required' };
    }
    try {
      await this.emailService.sendContactEmail({
        fromName: name.trim(),
        fromEmail: email.trim(),
        subject: subject.trim(),
        message: message.trim(),
      });
      return { success: true, message: 'Your message has been sent. We\'ll be in touch shortly!' };
    } catch (err: any) {
      // Log but don't expose SMTP internals to the caller
      return { success: false, message: 'Unable to send message right now. Please try again later.' };
    }
  }
}
