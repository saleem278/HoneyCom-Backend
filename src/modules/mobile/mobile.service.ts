import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IDevice } from '../../models/Device.model';
import { INotification } from '../../models/Notification.model';

@Injectable()
export class MobileService {
  constructor(
    @InjectModel('Device') private deviceModel: Model<IDevice>,
    @InjectModel('Notification') private notificationModel: Model<INotification>,
  ) {}

  // ========== DEVICES ==========
  async registerDevice(userId: string, deviceData: { deviceToken: string; platform: 'ios' | 'android'; appVersion: string }) {
    // Check if device already exists
    let device = await this.deviceModel.findOne({ deviceToken: deviceData.deviceToken });

    if (device) {
      // Update existing device
      device.user = userId as any;
      device.platform = deviceData.platform;
      device.appVersion = deviceData.appVersion;
      device.lastActive = new Date();
      await device.save();
    } else {
      // Create new device
      device = await this.deviceModel.create({
        user: userId,
        deviceToken: deviceData.deviceToken,
        platform: deviceData.platform,
        appVersion: deviceData.appVersion,
        lastActive: new Date(),
      });
    }

    return {
      success: true,
      device,
      message: 'Device registered successfully',
    };
  }

  async getUserDevices(userId: string) {
    const devices = await this.deviceModel.find({ user: userId }).sort({ lastActive: -1 });
    return {
      success: true,
      devices,
    };
  }

  async unregisterDevice(deviceId: string, userId: string) {
    const device = await this.deviceModel.findOneAndDelete({ _id: deviceId, user: userId });
    if (!device) {
      throw new NotFoundException('Device not found');
    }
    return {
      success: true,
      message: 'Device unregistered successfully',
    };
  }

  // ========== NOTIFICATIONS ==========
  async getNotifications(userId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;
    
    const [notifications, total] = await Promise.all([
      this.notificationModel
        .find({ user: userId })
        .populate('device', 'platform appVersion')
        .sort({ sentAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.notificationModel.countDocuments({ user: userId }),
    ]);

    const unreadCount = await this.notificationModel.countDocuments({ user: userId, read: false });

    return {
      success: true,
      notifications,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      unreadCount,
    };
  }

  async markAsRead(notificationId: string, userId: string) {
    const notification = await this.notificationModel.findOneAndUpdate(
      { _id: notificationId, user: userId },
      { read: true },
      { new: true }
    );

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    return {
      success: true,
      notification,
    };
  }

  async markAllAsRead(userId: string) {
    const result = await this.notificationModel.updateMany(
      { user: userId, read: false },
      { read: true }
    );

    return {
      success: true,
      message: `${result.modifiedCount} notifications marked as read`,
      count: result.modifiedCount,
    };
  }

  async deleteNotification(notificationId: string, userId: string) {
    const notification = await this.notificationModel.findOneAndDelete({ _id: notificationId, user: userId });
    if (!notification) {
      throw new NotFoundException('Notification not found');
    }
    return {
      success: true,
      message: 'Notification deleted successfully',
    };
  }

  // Internal method to send push notification (called by other services)
  async sendPushNotification(userId: string, title: string, message: string, type: 'order' | 'promotion' | 'system' | 'other', data?: any) {
    // Get user devices
    const devices = await this.deviceModel.find({ user: userId });

    if (devices.length === 0) {
      // No devices registered, just create notification record
      const notification = await this.notificationModel.create({
        user: userId,
        title,
        message,
        type,
        data,
        read: false,
        sentAt: new Date(),
      });
      return { success: true, notification };
    }

    // Create notification records for each device
    const notifications = await Promise.all(
      devices.map(device =>
        this.notificationModel.create({
          user: userId,
          device: device._id,
          title,
          message,
          type,
          data,
          read: false,
          sentAt: new Date(),
        })
      )
    );

    // TODO: Send actual push notifications via FCM/APNS
    // For now, just create notification records
    // await this.sendToFCM(devices, title, message, data);
    // await this.sendToAPNS(devices, title, message, data);

    return {
      success: true,
      notifications,
      message: 'Push notifications queued',
    };
  }
}

