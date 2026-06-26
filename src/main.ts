import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
  }));
  app.use((req: any, res: any, next: any) => {
    if (req.headers.authorization) {
      console.log('Authorization header received length:', req.headers.authorization.length);
      
      try {
        const token = req.headers.authorization.split(' ')[1];
        const secret = process.env.SUPABASE_JWT_SECRET || 'secret';
        const decoded = jwt.verify(token, secret);
        console.log('Middleware JWT Verification SUCCESS');
      } catch (err: any) {
        console.log('Middleware JWT Verification ERROR:', err.message);
      }
    } else {
      console.log('NO Authorization header for', req.url);
    }
    next();
  });

  await app.listen(process.env.PORT || 3000, '0.0.0.0');
}
bootstrap();
