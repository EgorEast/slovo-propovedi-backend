import { ChangePasswordDto } from './change-password.dto';
import { CreateUserDto } from './create-user.dto';
import { SignInRequestDto } from '../../auth/dto/sign-in-request.dto';

const validCreateUser = {
  name: 'Test User',
  email: 'test@example.com',
  username: 'testuser',
  password: 'password123',
};

describe('User DTO password policy', () => {
  describe('CreateUserDto', () => {
    it('rejects an empty password', () => {
      const result = CreateUserDto.schema.safeParse({
        ...validCreateUser,
        password: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects a password shorter than 8 characters', () => {
      const result = CreateUserDto.schema.safeParse({
        ...validCreateUser,
        password: 'short',
      });
      expect(result.success).toBe(false);
    });

    it('accepts a password of exactly 8 characters', () => {
      const result = CreateUserDto.schema.safeParse({
        ...validCreateUser,
        password: '12345678',
      });
      expect(result.success).toBe(true);
    });

    it('rejects a password above the schema maximum', () => {
      const result = CreateUserDto.schema.safeParse({
        ...validCreateUser,
        password: 'a'.repeat(201),
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ChangePasswordDto', () => {
    it('rejects an empty password', () => {
      const result = ChangePasswordDto.schema.safeParse({ password: '' });
      expect(result.success).toBe(false);
    });

    it('accepts a password of exactly 8 characters', () => {
      const result = ChangePasswordDto.schema.safeParse({
        password: '12345678',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('SignInRequestDto', () => {
    it('accepts a short legacy password (no minimum on sign-in)', () => {
      const result = SignInRequestDto.schema.safeParse({
        username: 'admin',
        password: 'old',
      });
      expect(result.success).toBe(true);
    });

    it('rejects a password above the schema maximum', () => {
      const result = SignInRequestDto.schema.safeParse({
        username: 'admin',
        password: 'a'.repeat(201),
      });
      expect(result.success).toBe(false);
    });
  });
});
