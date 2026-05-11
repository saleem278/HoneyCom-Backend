import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { uploadBufferToCloudinary } from './fileUpload.service';

/**
 * PDF generation (invoices, shipping labels).
 *
 * Files are streamed to a Buffer in memory and uploaded to Cloudinary
 * rather than written to local disk. The earlier disk-write version
 * broke on Render — the filesystem there is ephemeral, so PDFs
 * vanished on every deploy/restart, and frontend links 404'd against
 * honeycom.vercel.app/uploads/pdfs/... because the relative URL was
 * resolved against the frontend origin.
 *
 * Cloudinary URLs are fully-qualified HTTPS, cached by their CDN, and
 * survive backend redeploys. The `resource_type: 'raw'` upload (set
 * in fileUpload.service.uploadBufferToCloudinary) is required for
 * non-image binaries.
 */
@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  /**
   * Render the PDFKit document into a Buffer. Resolves once the doc
   * end event fires. Errors during write surface as rejections.
   */
  private renderToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
  }

  async generateInvoice(invoiceData: any): Promise<string> {
    const doc = new PDFDocument({ margin: 50 });
    const bufferPromise = this.renderToBuffer(doc);

    // Header
    doc.fontSize(20).text('INVOICE', { align: 'center' });
    doc.moveDown();

    // Invoice Details
    doc.fontSize(12);
    doc.text(`Invoice Number: ${invoiceData.invoiceNumber || 'N/A'}`);
    doc.text(`Order Number: ${invoiceData.orderNumber || 'N/A'}`);
    doc.text(`Date: ${new Date(invoiceData.date).toLocaleDateString()}`);
    doc.moveDown();

    // Customer Information
    doc.fontSize(14).text('Bill To:', { underline: true });
    doc.fontSize(12);
    doc.text(invoiceData.customer?.name || 'N/A');
    doc.text(invoiceData.customer?.email || 'N/A');
    doc.text(invoiceData.customer?.phone || 'N/A');
    doc.moveDown();

    // Shipping Address
    if (invoiceData.shippingAddress) {
      doc.fontSize(14).text('Ship To:', { underline: true });
      doc.fontSize(12);
      const addr = invoiceData.shippingAddress;
      if (typeof addr === 'object') {
        doc.text(`${addr.firstName || ''} ${addr.lastName || ''}`.trim() || 'N/A');
        doc.text(addr.addressLine1 || 'N/A');
        if (addr.addressLine2) doc.text(addr.addressLine2);
        doc.text(`${addr.city || ''}, ${addr.state || ''} ${addr.zipCode || ''}`.trim());
        doc.text(addr.country || 'N/A');
      }
      doc.moveDown();
    }

    // Items Table
    doc.fontSize(14).text('Items:', { underline: true });
    doc.moveDown(0.5);

    const tableTop = doc.y;
    doc.fontSize(10);
    doc.text('Item', 50, tableTop);
    doc.text('Quantity', 250, tableTop);
    doc.text('Price', 350, tableTop, { width: 100, align: 'right' });
    doc.text('Total', 450, tableTop, { width: 100, align: 'right' });

    let yPos = tableTop + 20;

    invoiceData.items?.forEach((item: any) => {
      doc.text(item.name || 'N/A', 50, yPos, { width: 200 });
      doc.text(String(item.quantity || 0), 250, yPos);
      doc.text(`$${(item.price || 0).toFixed(2)}`, 350, yPos, { width: 100, align: 'right' });
      doc.text(`$${((item.price || 0) * (item.quantity || 0)).toFixed(2)}`, 450, yPos, {
        width: 100,
        align: 'right',
      });
      yPos += 20;
    });

    yPos += 10;
    doc.moveTo(50, yPos).lineTo(550, yPos).stroke();
    yPos += 10;

    doc.text('Subtotal:', 350, yPos, { width: 100, align: 'right' });
    doc.text(`$${(invoiceData.subtotal || 0).toFixed(2)}`, 450, yPos, { width: 100, align: 'right' });
    yPos += 20;

    doc.text('Tax:', 350, yPos, { width: 100, align: 'right' });
    doc.text(`$${(invoiceData.tax || 0).toFixed(2)}`, 450, yPos, { width: 100, align: 'right' });
    yPos += 20;

    doc.text('Shipping:', 350, yPos, { width: 100, align: 'right' });
    doc.text(`$${(invoiceData.shipping || 0).toFixed(2)}`, 450, yPos, { width: 100, align: 'right' });
    yPos += 20;

    if (invoiceData.discount && invoiceData.discount > 0) {
      doc.text('Discount:', 350, yPos, { width: 100, align: 'right' });
      doc.text(`-$${(invoiceData.discount || 0).toFixed(2)}`, 450, yPos, { width: 100, align: 'right' });
      yPos += 20;
    }

    doc.moveTo(50, yPos).lineTo(550, yPos).stroke();
    yPos += 10;

    doc.fontSize(12).font('Helvetica-Bold');
    doc.text('Total:', 350, yPos, { width: 100, align: 'right' });
    doc.text(`$${(invoiceData.total || 0).toFixed(2)}`, 450, yPos, { width: 100, align: 'right' });

    yPos += 40;
    doc.font('Helvetica').fontSize(10);
    doc.text(`Payment Method: ${invoiceData.paymentMethod || 'N/A'}`, 50, yPos);
    doc.text(`Payment Status: ${invoiceData.paymentStatus || 'N/A'}`, 50, yPos + 15);

    doc.end();

    const buffer = await bufferPromise;
    const publicId = `invoice-${invoiceData.invoiceNumber || invoiceData.orderNumber || Date.now()}`;
    try {
      const { url } = await uploadBufferToCloudinary(buffer, {
        folder: 'honey-ecommerce/invoices',
        publicId,
      });
      return url;
    } catch (err) {
      this.logger.error(
        `Invoice PDF upload failed for ${publicId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }
  }

  async generateShippingLabel(orderData: any, trackingNumber?: string): Promise<string> {
    const doc = new PDFDocument({ size: [400, 600], margin: 20 });
    const bufferPromise = this.renderToBuffer(doc);

    doc.fontSize(16).text('SHIPPING LABEL', { align: 'center' });
    doc.moveDown();

    if (trackingNumber) {
      doc.fontSize(12).text(`Tracking: ${trackingNumber}`, { align: 'center' });
      doc.moveDown();
    }

    doc.fontSize(10);
    doc.text(`Order: ${orderData.orderNumber || 'N/A'}`);
    doc.moveDown();

    doc.fontSize(12).text('SHIP TO:', { underline: true });
    doc.fontSize(10);
    const addr = orderData.shippingAddress;
    if (addr && typeof addr === 'object') {
      doc.text(`${addr.firstName || ''} ${addr.lastName || ''}`.trim() || 'N/A');
      doc.text(addr.addressLine1 || 'N/A');
      if (addr.addressLine2) doc.text(addr.addressLine2);
      doc.text(`${addr.city || ''}, ${addr.state || ''} ${addr.zipCode || ''}`.trim());
      doc.text(addr.country || 'N/A');
      if (addr.phone) doc.text(`Phone: ${addr.phone}`);
    }
    doc.moveDown();

    doc.fontSize(12).text('ITEMS:', { underline: true });
    doc.fontSize(10);
    orderData.items?.forEach((item: any, index: number) => {
      doc.text(`${index + 1}. ${item.name || 'N/A'} x${item.quantity || 0}`);
    });

    doc.end();

    const buffer = await bufferPromise;
    const publicId = `shipping-label-${orderData.orderNumber || Date.now()}`;
    try {
      const { url } = await uploadBufferToCloudinary(buffer, {
        folder: 'honey-ecommerce/shipping-labels',
        publicId,
      });
      return url;
    } catch (err) {
      this.logger.error(
        `Shipping label PDF upload failed for ${publicId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }
  }
}
