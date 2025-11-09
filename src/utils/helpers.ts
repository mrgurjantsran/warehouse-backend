import bcrypt from 'bcryptjs';

export const hashPassword = async (password: string): Promise<string> => {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
};

export const comparePasswords = async (
  password: string,
  hash: string
): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};

export const generateBatchId = (type: 'BULK' | 'MULTI' | 'SINGLE'): string => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7).toUpperCase();
  return `${type}_${timestamp}_${random}`;
};
