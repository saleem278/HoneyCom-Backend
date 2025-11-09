import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SeedModule } from './modules/seed/seed.module';
import { SeedService } from './modules/seed/seed.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(SeedModule);
  const seedService = app.get(SeedService);

  try {
    await seedService.seed();
    // Seeding completed successfully
    process.exit(0);
  } catch (error) {
    // Seeding failed
    process.exit(1);
  }
}

bootstrap();

