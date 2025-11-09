import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { createWriteStream } from 'fs';
import { join } from 'path';

@Injectable()
export class PdfService {
  private readonly uploadsPath = join(process.cwd(), 'uploads', 'pdfs');

  async generateInvoice(invoiceData: any): Promise<string> {
    const fileName = `invoice-${invoiceData.invoiceNumber || Date.now()}.pdf`;
    const filePath = join(this.uploadsPath, fileName);

    // Ensure directory exists
    const fs = require('fs');
    if (!fs.existsSync(this.uploadsPath)) {
      fs.mkdirSync(this.uploadsPath, { recursive: true });
    }

    const doc = new PDFDocument({ margin: 50 });
    const stream = createWriteStream(filePath);
    doc.pipe(stream);

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

    // Table Header
    const tableTop = doc.y;
    doc.fontSize(10);
    doc.text('Item', 50, tableTop);
    doc.text('Quantity', 250, tableTop);
    doc.text('Price', 350, tableTop, { width: 100, align: 'right' });
    doc.text('Total', 450, tableTop, { width: 100, align: 'right' });

    let yPos = tableTop + 20;

    // Items
    invoiceData.items?.forEach((item: any) => {
      doc.text(item.name || 'N/A', 50, yPos, { width: 200 });
      doc.text(String(item.quantity || 0), 250, yPos);
      doc.text(`$${(item.price || 0).toFixed(2)}`, 350, yPos, { width: 100, align: 'right' });
      doc.text(`$${((item.price || 0) * (item.quantity || 0)).toFixed(2)}`, 450, yPos, { width: 100, align: 'right' });
      yPos += 20;
    });

    // Totals
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

    // Payment Info
    yPos += 40;
    doc.font('Helvetica').fontSize(10);
    doc.text(`Payment Method: ${invoiceData.paymentMethod || 'N/A'}`, 50, yPos);
    doc.text(`Payment Status: ${invoiceData.paymentStatus || 'N/A'}`, 50, yPos + 15);

    doc.end();

    await new Promise<void>((resolve) => {
      stream.on('finish', () => resolve());
    });

    return `/uploads/pdfs/${fileName}`;
  }

  async generateShippingLabel(orderData: any, trackingNumber?: string): Promise<string> {
    const fileName = `shipping-label-${orderData.orderNumber || Date.now()}.pdf`;
    const filePath = join(this.uploadsPath, fileName);

    const fs = require('fs');
    if (!fs.existsSync(this.uploadsPath)) {
      fs.mkdirSync(this.uploadsPath, { recursive: true });
    }

    const doc = new PDFDocument({ size: [400, 600], margin: 20 });
    const stream = createWriteStream(filePath);
    doc.pipe(stream);

    // Header
    doc.fontSize(16).text('SHIPPING LABEL', { align: 'center' });
    doc.moveDown();

    // Tracking Number
    if (trackingNumber) {
      doc.fontSize(12).text(`Tracking: ${trackingNumber}`, { align: 'center' });
      doc.moveDown();
    }

    // Order Info
    doc.fontSize(10);
    doc.text(`Order: ${orderData.orderNumber || 'N/A'}`);
    doc.moveDown();

    // Ship To
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

    // Items
    doc.fontSize(12).text('ITEMS:', { underline: true });
    doc.fontSize(10);
    orderData.items?.forEach((item: any, index: number) => {
      doc.text(`${index + 1}. ${item.name || 'N/A'} x${item.quantity || 0}`);
    });

    doc.end();
    await new Promise<void>((resolve) => {
      stream.on('finish', () => resolve());
    });

    return `/uploads/pdfs/${fileName}`;
  }
}

