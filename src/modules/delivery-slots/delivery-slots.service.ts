import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IDeliverySlot } from '../../models/DeliverySlot.model';
import { CreateDeliverySlotDto } from './dto/create-delivery-slot.dto';
import { UpdateDeliverySlotDto } from './dto/update-delivery-slot.dto';

@Injectable()
export class DeliverySlotsService {
  constructor(
    @InjectModel('DeliverySlot') private deliverySlotModel: Model<IDeliverySlot>,
  ) {}

  /**
   * Returns available slots for today and tomorrow based on the current time.
   * A slot is "available today" if current time is before its cutoffTime.
   * A slot is "available tomorrow" if it is active and runs on tomorrow's day-of-week.
   */
  async findAvailable() {
    const now = new Date();
    const currentDay = now.getDay(); // 0=Sun..6=Sat
    const tomorrowDay = (currentDay + 1) % 7;

    // Current time as HH:MM string for comparison
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const currentTime = `${hh}:${mm}`;

    const allActive = await this.deliverySlotModel
      .find({ isActive: true })
      .sort({ startTime: 1 })
      .lean();

    const today: IDeliverySlot[] = [];
    const tomorrow: IDeliverySlot[] = [];

    for (const slot of allActive) {
      const availableToday = slot.daysAvailable.includes(currentDay) && currentTime < slot.cutoffTime;
      const availableTomorrow = slot.daysAvailable.includes(tomorrowDay);

      if (availableToday) today.push(slot);
      if (availableTomorrow) tomorrow.push(slot);
    }

    return { success: true, today, tomorrow };
  }

  async create(dto: CreateDeliverySlotDto) {
    const slot = await this.deliverySlotModel.create(dto);
    return { success: true, slot };
  }

  async update(id: string, dto: UpdateDeliverySlotDto) {
    const slot = await this.deliverySlotModel.findByIdAndUpdate(
      id,
      dto,
      { new: true, runValidators: true },
    ).lean();

    if (!slot) throw new NotFoundException('Delivery slot not found');

    return { success: true, slot };
  }

  async remove(id: string) {
    const slot = await this.deliverySlotModel.findByIdAndDelete(id);
    if (!slot) throw new NotFoundException('Delivery slot not found');
    return { success: true, message: 'Delivery slot deleted' };
  }

  async findById(id: string): Promise<IDeliverySlot | null> {
    return this.deliverySlotModel.findById(id).lean();
  }
}
