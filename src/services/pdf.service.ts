import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { uploadBufferToCloudinary } from './fileUpload.service';

type InvoiceRenderResult = { buffer: Buffer; publicId: string };

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  private static readonly MAX_PDF_BYTES = 10 * 1024 * 1024;
  private static readonly MAX_INVOICE_ITEMS = 500;

  private static readonly C = {
    ink: '#111827',
    muted: '#64748b',
    subtle: '#94a3b8',
    line: '#e2e8f0',
    surface: '#f8fafc',
    accent: '#f97316',
    accentSoft: '#fff7ed',
    success: '#16a34a',
  };

  private renderToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      let aborted = false;

      doc.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > PdfService.MAX_PDF_BYTES) {
          aborted = true;
          doc.end();
          reject(new Error(`PDF exceeded maximum size of ${PdfService.MAX_PDF_BYTES} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      doc.on('end', () => {
        if (!aborted) resolve(Buffer.concat(chunks));
      });
      doc.on('error', reject);
    });
  }

  async generateInvoice(invoiceData: any): Promise<string> {
    const { buffer, publicId } = await this.renderInvoice(invoiceData);
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

  async generateInvoiceWithBuffer(
    invoiceData: any,
  ): Promise<{ url: string | null; buffer: Buffer }> {
    const { buffer, publicId } = await this.renderInvoice(invoiceData);
    try {
      const { url } = await uploadBufferToCloudinary(buffer, {
        folder: 'honey-ecommerce/invoices',
        publicId,
      });
      return { url, buffer };
    } catch (err) {
      this.logger.warn(
        `Cloudinary upload skipped for ${publicId} - streaming buffer directly. Reason: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { url: null, buffer };
    }
  }

  async generateShippingLabel(orderData: any, trackingNumber?: string): Promise<string> {
    const doc = new PDFDocument({ size: [420, 620], margin: 24 });
    const bufferPromise = this.renderToBuffer(doc);
    const C = PdfService.C;
    const pageWidth = doc.page.width;
    const contentWidth = pageWidth - 48;
    const addr = this.normalizeAddress(orderData.shippingAddress);

    this.roundedRect(doc, 24, 24, contentWidth, 74, 14, C.ink, C.ink);
    doc
      .fillColor('#ffffff')
      .font('Helvetica-Bold')
      .fontSize(18)
      .text('SHIPPING LABEL', 42, 43);
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#cbd5e1')
      .text(`Order ${orderData.orderNumber || 'N/A'}`, 42, 67);

    doc
      .roundedRect(290, 42, 86, 28, 10)
      .fillAndStroke('#ffffff', '#ffffff')
      .fillColor(C.ink)
      .font('Helvetica-Bold')
      .fontSize(9)
      .text('PARCEL', 290, 51, { width: 86, align: 'center' });

    const tracking = trackingNumber || orderData.trackingNumber || 'Pending';
    this.sectionTitle(doc, 'TRACKING', 24, 122);
    this.roundedRect(doc, 24, 142, contentWidth, 58, 12, C.surface, C.line);
    doc
      .fillColor(C.ink)
      .font('Helvetica-Bold')
      .fontSize(16)
      .text(tracking, 42, 160, { width: contentWidth - 36, align: 'center' });

    this.sectionTitle(doc, 'SHIP TO', 24, 226);
    this.roundedRect(doc, 24, 246, contentWidth, 154, 12, '#ffffff', C.line);
    doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(18).text(addr.name, 42, 268);
    doc
      .fillColor(C.muted)
      .font('Helvetica')
      .fontSize(12)
      .text(addr.lines.join('\n'), 42, 296, { width: contentWidth - 36, lineGap: 5 });
    if (addr.phone) {
      doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(10).text(`Phone: ${addr.phone}`, 42, 366);
    }

    this.sectionTitle(doc, 'ITEMS', 24, 426);
    const items = (orderData.items || []).slice(0, 8);
    let y = 448;
    items.forEach((item: any, index: number) => {
      doc
        .fillColor(C.ink)
        .font('Helvetica-Bold')
        .fontSize(10)
        .text(`${index + 1}. ${item.name || item.product?.name || 'Item'}`, 42, y, {
          width: 250,
          ellipsis: true,
        });
      doc
        .fillColor(C.muted)
        .font('Helvetica')
        .fontSize(10)
        .text(`x${item.quantity || 1}`, 324, y, { width: 44, align: 'right' });
      y += 18;
    });
    if ((orderData.items || []).length > items.length) {
      doc.fillColor(C.muted).fontSize(9).text(`+ ${(orderData.items || []).length - items.length} more items`, 42, y + 4);
    }

    doc
      .moveTo(24, 578)
      .lineTo(pageWidth - 24, 578)
      .strokeColor(C.line)
      .stroke();
    doc
      .fillColor(C.subtle)
      .font('Helvetica')
      .fontSize(8)
      .text('Generated by HoneyCom fulfilment', 24, 588, { width: contentWidth, align: 'center' });

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

  private async renderInvoice(invoiceData: any): Promise<InvoiceRenderResult> {
    if (invoiceData?.items?.length > PdfService.MAX_INVOICE_ITEMS) {
      throw new Error(
        `Invoice cannot contain more than ${PdfService.MAX_INVOICE_ITEMS} line items`,
      );
    }

    const doc = new PDFDocument({ size: 'A4', margin: 42, bufferPages: true });
    const bufferPromise = this.renderToBuffer(doc);
    const C = PdfService.C;
    const publicId = `invoice-${invoiceData.invoiceNumber || invoiceData.orderNumber || Date.now()}`;
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const left = 42;
    const right = pageWidth - 42;
    const contentWidth = right - left;
    const currency = invoiceData.currency || 'INR';
    const billTo = invoiceData.customer || {};
    const shipTo = this.normalizeAddress(invoiceData.shippingAddress);

    this.drawInvoiceHeader(doc, invoiceData, left, contentWidth);

    let y = 170;
    this.infoCard(doc, left, y, 245, 118, 'BILL TO', [
      billTo.name || 'N/A',
      billTo.email || 'N/A',
      billTo.phone || 'N/A',
    ]);
    this.infoCard(doc, left + 265, y, 246, 118, 'SHIP TO', [
      shipTo.name,
      ...shipTo.lines,
      ...(shipTo.phone ? [`Phone: ${shipTo.phone}`] : []),
    ]);

    y = 324;
    y = this.drawItemsTable(doc, invoiceData.items || [], y, currency);

    if (y > pageHeight - 250) {
      doc.addPage();
      y = 64;
    }

    y += 20;
    this.drawTotals(doc, invoiceData, y, currency);

    const noteY = Math.max(y + 162, pageHeight - 132);
    this.roundedRect(doc, left, noteY, contentWidth, 64, 14, C.accentSoft, '#fed7aa');
    doc
      .fillColor('#9a3412')
      .font('Helvetica-Bold')
      .fontSize(10)
      .text('THANK YOU', left + 18, noteY + 16);
    doc
      .fillColor('#9a3412')
      .font('Helvetica')
      .fontSize(9)
      .text(
        'We appreciate your order. Keep this invoice for your records. For support, reference the invoice or order number above.',
        left + 18,
        noteY + 32,
        { width: contentWidth - 36, lineGap: 2 },
      );

    this.drawPageFooters(doc);
    doc.end();

    return { buffer: await bufferPromise, publicId };
  }

  private drawInvoiceHeader(doc: PDFKit.PDFDocument, invoiceData: any, left: number, width: number) {
    const C = PdfService.C;
    this.roundedRect(doc, left, 42, width, 94, 18, C.ink, C.ink);

    doc
      .fillColor('#ffffff')
      .font('Helvetica-Bold')
      .fontSize(26)
      .text('INVOICE', left + 22, 62);
    doc
      .fillColor('#cbd5e1')
      .font('Helvetica')
      .fontSize(9)
      .text('HoneyCom Marketplace', left + 24, 96);

    doc
      .roundedRect(left + width - 168, 60, 138, 44, 14)
      .fillAndStroke('#ffffff', '#ffffff');
    doc
      .fillColor(C.accent)
      .font('Helvetica-Bold')
      .fontSize(9)
      .text('TOTAL DUE', left + width - 154, 71);
    doc
      .fillColor(C.ink)
      .fontSize(16)
      .text(this.money(invoiceData.total || 0, invoiceData.currency || 'INR'), left + width - 154, 86, {
        width: 110,
        align: 'right',
      });

    const metaX = left + 318;
    this.metaLine(doc, 'Invoice', invoiceData.invoiceNumber || 'N/A', metaX, 145);
    this.metaLine(doc, 'Order', invoiceData.orderNumber || 'N/A', metaX, 162);
    this.metaLine(doc, 'Date', this.formatDate(invoiceData.date), metaX, 179);
  }

  private drawItemsTable(
    doc: PDFKit.PDFDocument,
    items: any[],
    startY: number,
    currency: string,
  ): number {
    const C = PdfService.C;
    const left = 42;
    const widths = { item: 252, qty: 52, price: 86, total: 88 };
    let y = startY;

    this.sectionTitle(doc, 'ITEMS', left, y - 28);
    this.roundedRect(doc, left, y - 8, 511, 34, 12, C.surface, C.line);
    doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(8);
    doc.text('PRODUCT', left + 14, y + 4, { width: widths.item });
    doc.text('QTY', left + 276, y + 4, { width: widths.qty, align: 'center' });
    doc.text('PRICE', left + 330, y + 4, { width: widths.price, align: 'right' });
    doc.text('TOTAL', left + 420, y + 4, { width: widths.total, align: 'right' });
    y += 38;

    items.forEach((item: any) => {
      if (y > doc.page.height - 115) {
        doc.addPage();
        y = 64;
        this.roundedRect(doc, left, y - 8, 511, 34, 12, C.surface, C.line);
        doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(8);
        doc.text('PRODUCT', left + 14, y + 4, { width: widths.item });
        doc.text('QTY', left + 276, y + 4, { width: widths.qty, align: 'center' });
        doc.text('PRICE', left + 330, y + 4, { width: widths.price, align: 'right' });
        doc.text('TOTAL', left + 420, y + 4, { width: widths.total, align: 'right' });
        y += 38;
      }

      const name = item.name || item.product?.name || 'Item';
      const qty = Number(item.quantity || 0);
      const price = Number(item.price || 0);
      const rowHeight = 34;

      doc
        .moveTo(left, y + rowHeight)
        .lineTo(left + 511, y + rowHeight)
        .strokeColor(C.line)
        .stroke();
      doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(10).text(name, left + 14, y + 4, {
        width: widths.item,
        ellipsis: true,
      });
      doc.fillColor(C.muted).font('Helvetica').fontSize(9).text(item.sku ? `SKU ${item.sku}` : '', left + 14, y + 20, {
        width: widths.item,
        ellipsis: true,
      });
      doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(10).text(String(qty), left + 276, y + 8, {
        width: widths.qty,
        align: 'center',
      });
      doc.font('Helvetica').text(this.money(price, currency), left + 330, y + 8, {
        width: widths.price,
        align: 'right',
      });
      doc.font('Helvetica-Bold').text(this.money(price * qty, currency), left + 420, y + 8, {
        width: widths.total,
        align: 'right',
      });
      y += rowHeight + 1;
    });

    return y;
  }

  private drawTotals(doc: PDFKit.PDFDocument, invoiceData: any, y: number, currency: string) {
    const C = PdfService.C;
    const x = 344;
    const w = 209;
    this.roundedRect(doc, x, y, w, 134, 14, C.surface, C.line);

    let rowY = y + 16;
    rowY = this.totalRow(doc, 'Subtotal', invoiceData.subtotal || 0, currency, x, rowY);
    rowY = this.totalRow(doc, 'Tax', invoiceData.tax || 0, currency, x, rowY);
    rowY = this.totalRow(doc, 'Shipping', invoiceData.shipping || 0, currency, x, rowY);
    if (invoiceData.discount && invoiceData.discount > 0) {
      rowY = this.totalRow(doc, 'Discount', -Number(invoiceData.discount || 0), currency, x, rowY, C.success);
    }
    doc.moveTo(x + 16, rowY + 4).lineTo(x + w - 16, rowY + 4).strokeColor(C.line).stroke();
    rowY += 14;
    doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(13).text('Total', x + 16, rowY);
    doc.fillColor(C.accent).fontSize(14).text(this.money(invoiceData.total || 0, currency), x + 96, rowY, {
      width: 94,
      align: 'right',
    });

    doc
      .fillColor(C.muted)
      .font('Helvetica')
      .fontSize(9)
      .text(`Payment method: ${invoiceData.paymentMethod || 'N/A'}`, 42, y + 12);
    doc.text(`Payment status: ${invoiceData.paymentStatus || 'N/A'}`, 42, y + 30);
  }

  private totalRow(
    doc: PDFKit.PDFDocument,
    label: string,
    amount: number,
    currency: string,
    x: number,
    y: number,
    color = PdfService.C.ink,
  ): number {
    doc.fillColor(PdfService.C.muted).font('Helvetica').fontSize(10).text(label, x + 16, y);
    doc.fillColor(color).font('Helvetica-Bold').fontSize(10).text(this.money(amount, currency), x + 96, y, {
      width: 94,
      align: 'right',
    });
    return y + 19;
  }

  private infoCard(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    w: number,
    h: number,
    title: string,
    lines: string[],
  ) {
    this.roundedRect(doc, x, y, w, h, 14, '#ffffff', PdfService.C.line);
    doc.fillColor(PdfService.C.accent).font('Helvetica-Bold').fontSize(8).text(title, x + 16, y + 16);
    doc
      .fillColor(PdfService.C.ink)
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(lines[0] || 'N/A', x + 16, y + 34, { width: w - 32, ellipsis: true });
    doc
      .fillColor(PdfService.C.muted)
      .font('Helvetica')
      .fontSize(9)
      .text(lines.slice(1).filter(Boolean).join('\n'), x + 16, y + 52, {
        width: w - 32,
        height: h - 62,
        lineGap: 3,
      });
  }

  private metaLine(doc: PDFKit.PDFDocument, label: string, value: string, x: number, y: number) {
    doc.fillColor(PdfService.C.muted).font('Helvetica').fontSize(8).text(label.toUpperCase(), x, y, {
      width: 70,
    });
    doc.fillColor(PdfService.C.ink).font('Helvetica-Bold').fontSize(9).text(value, x + 72, y, {
      width: 150,
      align: 'right',
    });
  }

  private sectionTitle(doc: PDFKit.PDFDocument, title: string, x: number, y: number) {
    doc.fillColor(PdfService.C.accent).font('Helvetica-Bold').fontSize(9).text(title, x, y, {
      characterSpacing: 1.2,
    });
  }

  private roundedRect(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    fill: string,
    stroke: string,
  ) {
    doc.roundedRect(x, y, w, h, r).fillAndStroke(fill, stroke);
  }

  private drawPageFooters(doc: PDFKit.PDFDocument) {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      doc
        .fillColor(PdfService.C.subtle)
        .font('Helvetica')
        .fontSize(8)
        .text(`Page ${i + 1} of ${range.count}`, 42, doc.page.height - 36, {
          width: doc.page.width - 84,
          align: 'right',
        });
    }
  }

  private normalizeAddress(addr: any): { name: string; lines: string[]; phone?: string } {
    if (!addr || typeof addr !== 'object') {
      return { name: 'N/A', lines: ['N/A'] };
    }
    const name =
      addr.fullName ||
      `${addr.firstName || ''} ${addr.lastName || ''}`.trim() ||
      addr.name ||
      'N/A';
    const street = addr.addressLine1 || addr.address || 'N/A';
    const street2 = addr.addressLine2;
    const cityLine = [addr.city, addr.state, addr.zipCode || addr.postalCode]
      .filter(Boolean)
      .join(', ');
    const lines = [street, street2, cityLine, addr.country].filter(Boolean);
    return { name, lines: lines.length ? lines : ['N/A'], phone: addr.phone };
  }

  private money(value: number, currency: string): string {
    try {
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency,
        maximumFractionDigits: 2,
      }).format(Number(value || 0));
    } catch {
      return `${this.currencySymbol(currency)}${Number(value || 0).toFixed(2)}`;
    }
  }

  private currencySymbol(currency: string): string {
    const symbols: Record<string, string> = {
      USD: '$',
      EUR: 'EUR ',
      GBP: 'GBP ',
      INR: 'Rs. ',
      CAD: 'C$',
      AUD: 'A$',
      JPY: 'JPY ',
    };
    return symbols[String(currency || '').toUpperCase()] || 'Rs. ';
  }

  private formatDate(raw: unknown): string {
    const date = raw ? new Date(raw as string) : new Date();
    if (Number.isNaN(date.getTime())) return 'N/A';
    return date.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }
}
